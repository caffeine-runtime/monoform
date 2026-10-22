// Parse a 3D file into a three.js scene. Runs in the load worker for most
// formats (and on the main thread for the few whose loaders need DOMParser).
// Relative resources (.bin, textures, .mtl) are fetched from the file's
// folder through `base` (the read-only page route).
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { XYZLoader } from 'three/examples/jsm/loaders/XYZLoader.js';
import { VTKLoader } from 'three/examples/jsm/loaders/VTKLoader.js';
// Not a dynamic import: in the worker a split-off chunk would import the
// worker's own entry again — a second three.js whose classes don't match.
import { stepToScene } from './step/step';

/** Extensions the viewer opens. */
export const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', '3mf', 'dae', '3ds', 'usdz', 'usd', 'usda', 'usdc', 'wrl', 'vrml', 'amf', 'pcd', 'xyz', 'vtk', 'vtp', 'step', 'stp'];
/** Loaders that need DOMParser, which workers don't have. */
export const MAIN_THREAD_EXTS = ['dae', '3mf', 'amf', 'vtp'];

export interface Loaded {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

const inWorker = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';

/**
 * In a worker there is no <img>: load textures with fetch + createImageBitmap.
 * flipY is kept on the texture and applied when it is rebuilt on the main thread.
 */
function patchTextureLoader() {
  if (!inWorker || (THREE.TextureLoader.prototype as { mfPatched?: boolean }).mfPatched) return;
  const proto = THREE.TextureLoader.prototype as THREE.TextureLoader & { mfPatched?: boolean };
  proto.mfPatched = true;
  proto.load = function (this: THREE.TextureLoader, url: string, onLoad?: (t: THREE.Texture) => void, _p?: unknown, onError?: (e: unknown) => void) {
    const tex = new THREE.Texture();
    const resolved = this.manager.resolveURL((this.path ?? '') + url);
    this.manager.itemStart(resolved);
    fetch(resolved)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((img) => {
        tex.image = img;
        tex.needsUpdate = true;
        onLoad?.(tex);
        this.manager.itemEnd(resolved);
      })
      .catch((e) => {
        tex.userData.missing = url;
        onError?.(e);
        this.manager.itemError(resolved);
        this.manager.itemEnd(resolved);
      });
    return tex;
  } as typeof proto.load;
}

/** Wait until every resource started through the manager has finished. */
function settled(manager: THREE.LoadingManager): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0;
    const prevStart = manager.itemStart.bind(manager);
    const prevEnd = manager.itemEnd.bind(manager);
    manager.itemStart = (u) => {
      pending++;
      prevStart(u);
    };
    manager.itemEnd = (u) => {
      pending--;
      prevEnd(u);
      if (pending <= 0) queueMicrotask(() => pending <= 0 && resolve());
    };
    setTimeout(() => pending <= 0 && resolve(), 0);
  });
}

function meshFor(geometry: THREE.BufferGeometry, points = false): THREE.Object3D {
  const hasColor = !!geometry.getAttribute('color');
  if (points || !geometry.index && !geometry.getAttribute('normal') && geometry.getAttribute('position').count > 0 && (geometry as { isPoints?: boolean }).isPoints) {
    return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0, sizeAttenuation: false, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xcfcfcf }));
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xb9b4ac, vertexColors: hasColor, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide }));
}

export async function loadModel(ext: string, data: ArrayBuffer, base: string, name: string, progress?: (f: number) => void): Promise<Loaded> {
  patchTextureLoader();
  const manager = new THREE.LoadingManager();
  // Resource URLs stay inside the file's folder route.
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith(base)) return `${base}__blocked__/${encodeURIComponent(url)}`;
    return url;
  });
  const done = settled(manager);
  const text = () => new TextDecoder().decode(data);
  let scene: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const loader = new GLTFLoader(manager);
      // The decoder is an app file, not a model resource: keep it out of the
      // folder-scoped manager.
      const draco = new DRACOLoader();
      draco.setDecoderPath(new URL('/three/draco/', location.href).href);
      draco.setWorkerLimit(1);
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(data, base);
      draco.dispose();
      scene = gltf.scene;
      animations = gltf.animations;
      break;
    }
    case 'fbx': {
      const loader = new FBXLoader(manager);
      loader.setResourcePath(base);
      scene = loader.parse(data, base);
      animations = scene.animations ?? [];
      break;
    }
    case 'obj': {
      const src = text();
      const loader = new OBJLoader(manager);
      const lib = /^\s*mtllib\s+(.+?)\s*$/m.exec(src)?.[1];
      if (lib) {
        try {
          const mtl = new MTLLoader(manager);
          mtl.setPath(base);
          const materials = await mtl.loadAsync(lib);
          materials.preload();
          loader.setMaterials(materials);
        } catch {
          /* materials are optional */
        }
      }
      scene = loader.parse(src);
      break;
    }
    case 'stl':
      scene = meshFor(new STLLoader(manager).parse(data));
      break;
    case 'ply': {
      const g = new PLYLoader(manager).parse(data);
      scene = meshFor(g, !g.index);
      break;
    }
    case 'pcd':
      scene = new PCDLoader(manager).parse(data);
      break;
    case 'xyz': {
      const loader = new XYZLoader(manager);
      scene = await new Promise<THREE.Object3D>((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([data]));
        loader.load(url, (g) => (URL.revokeObjectURL(url), resolve(meshFor(g, true))), undefined, reject);
      });
      break;
    }
    case 'vtk':
    case 'vtp':
      scene = meshFor(new VTKLoader(manager).parse(data, base) as THREE.BufferGeometry);
      break;
    case '3mf':
      scene = new ThreeMFLoader(manager).parse(data);
      break;
    case 'dae': {
      const c = new ColladaLoader(manager).parse(text(), base);
      if (!c) throw new Error(t('not a valid Collada file'));
      scene = c.scene;
      animations = c.scene.animations ?? [];
      break;
    }
    case '3ds': {
      const loader = new TDSLoader(manager);
      loader.setResourcePath(base);
      scene = loader.parse(data, base);
      break;
    }
    case 'usdz':
    case 'usd':
    case 'usda':
    case 'usdc': {
      const loader = new USDLoader(manager);
      scene = await new Promise<THREE.Object3D>((resolve, reject) => {
        try {
          const g = loader.parse(data, base, (r: THREE.Group) => resolve(r), reject) as THREE.Group | undefined;
          if (g) resolve(g);
        } catch (e) {
          reject(e);
        }
      });
      break;
    }
    case 'wrl':
    case 'vrml':
      scene = new VRMLLoader(manager).parse(text(), base);
      break;
    case 'amf':
      scene = new AMFLoader(manager).parse(data);
      break;
    case 'step':
    case 'stp':
      scene = stepToScene(text(), progress);
      break;
    default:
      throw new Error(t('.{ext} files are not supported', { ext }));
  }
  await done;
  // STL, 3MF, AMF and STEP come from CAD and 3D printing, where Z is up;
  // three.js has Y up, so stand them upright (a printed boat would lie on its side).
  if (ext === 'stl' || ext === '3mf' || ext === 'amf' || ext === 'step' || ext === 'stp') {
    const upright = new THREE.Group();
    upright.rotation.x = -Math.PI / 2;
    upright.add(scene);
    scene = upright;
  }
  scene.name ||= name;
  return { scene, animations };
}
