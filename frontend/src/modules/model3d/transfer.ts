// Move a parsed scene from the load worker to the main thread without
// copying big data: geometry arrays and texture bitmaps are transferred,
// everything else is a small description that is rebuilt on the main side.
import * as THREE from 'three';

interface AttrDesc {
  array: ArrayBufferView;
  itemSize: number;
  normalized: boolean;
}
interface GeomDesc {
  attributes: Record<string, AttrDesc>;
  morphAttributes: Record<string, AttrDesc[]>;
  morphRelative: boolean;
  index: AttrDesc | null;
  groups: { start: number; count: number; materialIndex?: number }[];
}
interface TexDesc {
  image: ImageBitmap | { data: ArrayBufferView; width: number; height: number } | null;
  wrapS: number;
  wrapT: number;
  repeat: [number, number];
  offset: [number, number];
  rotation: number;
  flipY: boolean;
  srgb: boolean;
  channel: number;
  minFilter: number;
  magFilter: number;
  mipmaps: boolean;
}
interface MatDesc {
  type: string;
  params: Record<string, unknown>;
  maps: Record<string, number>;
}
interface ObjDesc {
  type: string;
  name: string;
  parent: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
  visible: boolean;
  geometry?: number;
  material?: number | number[];
  skin?: { bones: number[]; inverses: Float32Array; bindMatrix: number[]; bindMode: string };
  morph?: { influences: number[]; dictionary: Record<string, number> };
}
interface ClipDesc {
  name: string;
  duration: number;
  blendMode: number;
  tracks: { name: string; type: string; times: ArrayBufferView; values: ArrayBufferView; interpolation?: number }[];
}
export interface Packed {
  objects: ObjDesc[];
  geometries: GeomDesc[];
  materials: MatDesc[];
  textures: TexDesc[];
  animations: ClipDesc[];
}

const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'specularMap', 'lightMap', 'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'transmissionMap'];
const COLOR_KEYS = ['color', 'emissive', 'specular', 'sheenColor', 'attenuationColor'];
const NUM_KEYS = ['roughness', 'metalness', 'opacity', 'alphaTest', 'side', 'shininess', 'emissiveIntensity', 'envMapIntensity', 'size', 'aoMapIntensity', 'bumpScale', 'displacementScale', 'displacementBias', 'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior', 'sheen', 'sheenRoughness', 'lightMapIntensity', 'reflectivity', 'linewidth'];
const BOOL_KEYS = ['transparent', 'vertexColors', 'flatShading', 'wireframe', 'sizeAttenuation', 'depthWrite', 'depthTest', 'fog'];

export function pack(scene: THREE.Object3D, animations: THREE.AnimationClip[]): { packed: Packed; transfer: Transferable[] } {
  const transfer: Transferable[] = [];
  const sent = new Set<ArrayBufferLike | ImageBitmap>();
  const own = (a: ArrayBufferView): ArrayBufferView => {
    // A buffer can be transferred once; views into shared buffers are copied.
    const whole = a.byteOffset === 0 && a.byteLength === a.buffer.byteLength;
    if (whole && !sent.has(a.buffer) && !(typeof SharedArrayBuffer !== 'undefined' && a.buffer instanceof SharedArrayBuffer)) {
      sent.add(a.buffer);
      transfer.push(a.buffer as ArrayBuffer);
      return a;
    }
    const copy = (a as unknown as { slice: () => ArrayBufferView }).slice();
    sent.add(copy.buffer);
    transfer.push(copy.buffer as ArrayBuffer);
    return copy;
  };
  const attr = (x: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): AttrDesc => {
    const a = (x as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (x as THREE.InterleavedBufferAttribute).clone() : (x as THREE.BufferAttribute);
    return { array: own(a.array as unknown as ArrayBufferView), itemSize: a.itemSize, normalized: a.normalized };
  };

  const objIndex = new Map<THREE.Object3D, number>();
  const geomIndex = new Map<THREE.BufferGeometry, number>();
  const matIndex = new Map<THREE.Material, number>();
  const texIndex = new Map<THREE.Texture, number>();
  const packed: Packed = { objects: [], geometries: [], materials: [], textures: [], animations: [] };

  const texture = (t: THREE.Texture): number => {
    let i = texIndex.get(t);
    if (i !== undefined) return i;
    const img = t.image as unknown;
    let image: TexDesc['image'] = null;
    const pixels = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap ? bitmapPixels(img) : null;
    if (pixels) {
      image = { data: own(pixels), width: (img as ImageBitmap).width, height: (img as ImageBitmap).height };
      (img as ImageBitmap).close();
    } else if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      if (!sent.has(img)) {
        sent.add(img);
        transfer.push(img);
      }
      image = img;
    } else if (img && typeof img === 'object' && 'data' in (img as object) && (img as { data: unknown }).data) {
      const d = img as { data: ArrayBufferView; width: number; height: number };
      image = { data: own(d.data), width: d.width, height: d.height };
    }
    i = packed.textures.length;
    texIndex.set(t, i);
    packed.textures.push({ image, wrapS: t.wrapS, wrapT: t.wrapT, repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y], rotation: t.rotation, flipY: t.flipY, srgb: t.colorSpace === THREE.SRGBColorSpace, channel: t.channel, minFilter: t.minFilter, magFilter: t.magFilter, mipmaps: t.generateMipmaps });
    return i;
  };

  const material = (m: THREE.Material): number => {
    let i = matIndex.get(m);
    if (i !== undefined) return i;
    const src = m as unknown as Record<string, unknown>;
    const params: Record<string, unknown> = { name: m.name };
    for (const k of COLOR_KEYS) if (src[k] instanceof THREE.Color) params[k] = (src[k] as THREE.Color).getHex();
    for (const k of NUM_KEYS) if (typeof src[k] === 'number') params[k] = src[k];
    for (const k of BOOL_KEYS) if (typeof src[k] === 'boolean') params[k] = src[k];
    if (src.normalScale instanceof THREE.Vector2) params.normalScale = [src.normalScale.x, src.normalScale.y];
    const maps: Record<string, number> = {};
    for (const k of MAP_SLOTS) if (src[k] instanceof THREE.Texture) maps[k] = texture(src[k] as THREE.Texture);
    i = packed.materials.length;
    matIndex.set(m, i);
    packed.materials.push({ type: m.type, params, maps });
    return i;
  };

  const geometry = (g: THREE.BufferGeometry): number => {
    let i = geomIndex.get(g);
    if (i !== undefined) return i;
    const attributes: Record<string, AttrDesc> = {};
    for (const [name, a] of Object.entries(g.attributes)) attributes[name] = attr(a as THREE.BufferAttribute);
    const morphAttributes: Record<string, AttrDesc[]> = {};
    for (const [name, list] of Object.entries(g.morphAttributes)) morphAttributes[name] = list.map((a) => attr(a as THREE.BufferAttribute));
    i = packed.geometries.length;
    geomIndex.set(g, i);
    packed.geometries.push({ attributes, morphAttributes, morphRelative: g.morphTargetsRelative, index: g.index ? attr(g.index) : null, groups: g.groups.map((x) => ({ ...x })) });
    return i;
  };

  scene.traverse((o) => {
    const d: ObjDesc = {
      type: (o as THREE.Bone).isBone ? 'Bone' : (o as THREE.SkinnedMesh).isSkinnedMesh ? 'SkinnedMesh' : (o as THREE.Mesh).isMesh ? 'Mesh' : (o as THREE.Points).isPoints ? 'Points' : (o as THREE.LineSegments).isLineSegments ? 'LineSegments' : (o as THREE.Line).isLine ? 'Line' : 'Group',
      name: o.name,
      parent: o.parent && objIndex.has(o.parent) ? objIndex.get(o.parent)! : -1,
      position: o.position.toArray() as [number, number, number],
      quaternion: o.quaternion.toArray() as [number, number, number, number],
      scale: o.scale.toArray() as [number, number, number],
      visible: o.visible,
    };
    const m = o as THREE.Mesh;
    if (m.geometry && (m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) {
      d.geometry = geometry(m.geometry);
      d.material = Array.isArray(m.material) ? m.material.map(material) : material(m.material);
      if (m.morphTargetInfluences) d.morph = { influences: [...m.morphTargetInfluences], dictionary: { ...(m.morphTargetDictionary ?? {}) } };
    }
    objIndex.set(o, packed.objects.length);
    packed.objects.push(d);
  });
  // Skins refer to bones anywhere in the tree, so they are resolved after the walk.
  scene.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh || !s.skeleton) return;
    const inverses = new Float32Array(s.skeleton.boneInverses.length * 16);
    s.skeleton.boneInverses.forEach((m, k) => inverses.set(m.elements, k * 16));
    packed.objects[objIndex.get(o)!].skin = { bones: s.skeleton.bones.map((b) => objIndex.get(b) ?? -1), inverses, bindMatrix: [...s.bindMatrix.elements], bindMode: s.bindMode };
  });
  for (const clip of animations) {
    packed.animations.push({
      name: clip.name,
      duration: clip.duration,
      blendMode: clip.blendMode,
      tracks: clip.tracks.map((t) => ({ name: t.name, type: (t as unknown as { ValueTypeName: string }).ValueTypeName, times: own(t.times), values: own(t.values), interpolation: t.getInterpolation() })),
    });
  }
  return { packed, transfer };
}

const MATERIALS: Record<string, new (p?: object) => THREE.Material> = {
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
  MeshPhongMaterial: THREE.MeshPhongMaterial,
  MeshLambertMaterial: THREE.MeshLambertMaterial,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  MeshToonMaterial: THREE.MeshToonMaterial,
  MeshMatcapMaterial: THREE.MeshMatcapMaterial,
  MeshNormalMaterial: THREE.MeshNormalMaterial,
  PointsMaterial: THREE.PointsMaterial,
  LineBasicMaterial: THREE.LineBasicMaterial,
  LineDashedMaterial: THREE.LineDashedMaterial,
};

/**
 * RGBA pixels of a decoded image, read in the worker so the main thread only
 * uploads them. Null where workers have no 2D OffscreenCanvas.
 */
function bitmapPixels(img: ImageBitmap): Uint8Array | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  } catch {
    return null;
  }
}

export async function unpack(p: Packed): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const toAttr = (a: AttrDesc) => new THREE.BufferAttribute(a.array as unknown as THREE.TypedArray, a.itemSize, a.normalized);
  const geometries = p.geometries.map((g) => {
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) geo.setAttribute(name, toAttr(a));
    for (const [name, list] of Object.entries(g.morphAttributes)) (geo.morphAttributes as Record<string, THREE.BufferAttribute[]>)[name] = list.map(toAttr);
    geo.morphTargetsRelative = g.morphRelative;
    if (g.index) geo.setIndex(toAttr(g.index));
    for (const gr of g.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
    return geo;
  });
  const textures = await Promise.all(
    p.textures.map(async (t) => {
      let tex: THREE.Texture;
      if (t.image && 'data' in t.image) {
        tex = new THREE.DataTexture(t.image.data as unknown as THREE.TypedArray, t.image.width, t.image.height);
      } else {
        // Only when the worker could not read the pixels: draw into a canvas,
        // as WebKitGTK's WebGL uploads ImageBitmaps as garbage.
        const img = t.image as ImageBitmap | null;
        let src: HTMLCanvasElement | undefined;
        if (img) {
          src = document.createElement('canvas');
          src.width = img.width;
          src.height = img.height;
          src.getContext('2d')!.drawImage(img, 0, 0);
          img.close();
          await new Promise((r) => setTimeout(r));
        }
        tex = new THREE.Texture(src);
      }
      tex.flipY = t.flipY;
      tex.minFilter = t.minFilter as THREE.MinificationTextureFilter;
      tex.magFilter = t.magFilter as THREE.MagnificationTextureFilter;
      tex.generateMipmaps = t.mipmaps;
      tex.wrapS = t.wrapS as THREE.Wrapping;
      tex.wrapT = t.wrapT as THREE.Wrapping;
      tex.repeat.set(...t.repeat);
      tex.offset.set(...t.offset);
      tex.rotation = t.rotation;
      tex.channel = t.channel;
      if (t.srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = !!t.image;
      return tex;
    }),
  );
  const materials = p.materials.map((m) => {
    const Ctor = MATERIALS[m.type] ?? THREE.MeshStandardMaterial;
    const mat = new Ctor();
    const target = mat as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(m.params)) {
      if (COLOR_KEYS.includes(k) && target[k] instanceof THREE.Color) (target[k] as THREE.Color).setHex(v as number);
      else if (k === 'normalScale' && target[k] instanceof THREE.Vector2) (target[k] as THREE.Vector2).set(...(v as [number, number]));
      else if (k in target) target[k] = v;
    }
    for (const [k, ti] of Object.entries(m.maps)) if (textures[ti]?.image) target[k] = textures[ti];
    mat.needsUpdate = true;
    return mat;
  });
  const objects: THREE.Object3D[] = p.objects.map((d) => {
    const mat = d.material === undefined ? undefined : Array.isArray(d.material) ? d.material.map((i) => materials[i]) : materials[d.material];
    const geo = d.geometry === undefined ? undefined : geometries[d.geometry];
    let o: THREE.Object3D;
    switch (d.type) {
      case 'Bone':
        o = new THREE.Bone();
        break;
      case 'SkinnedMesh':
        o = new THREE.SkinnedMesh(geo, mat as THREE.Material);
        break;
      case 'Mesh':
        o = new THREE.Mesh(geo, mat as THREE.Material);
        break;
      case 'Points':
        o = new THREE.Points(geo, mat as THREE.Material);
        break;
      case 'LineSegments':
        o = new THREE.LineSegments(geo, mat as THREE.Material);
        break;
      case 'Line':
        o = new THREE.Line(geo, mat as THREE.Material);
        break;
      default:
        o = new THREE.Group();
    }
    o.name = d.name;
    o.position.fromArray(d.position);
    o.quaternion.fromArray(d.quaternion);
    o.scale.fromArray(d.scale);
    o.visible = d.visible;
    if (d.morph && (o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).morphTargetInfluences = d.morph.influences;
      (o as THREE.Mesh).morphTargetDictionary = d.morph.dictionary;
    }
    return o;
  });
  let root: THREE.Group | null = null;
  p.objects.forEach((d, i) => {
    if (d.parent >= 0) objects[d.parent].add(objects[i]);
    else if (!root) root = objects[i] instanceof THREE.Group ? (objects[i] as THREE.Group) : new THREE.Group().add(objects[i]);
    else root.add(objects[i]);
  });
  root ??= new THREE.Group();
  root.updateMatrixWorld(true);
  p.objects.forEach((d, i) => {
    if (!d.skin) return;
    const bones = d.skin.bones.map((b) => objects[b]).filter((b): b is THREE.Bone => (b as THREE.Bone)?.isBone === true);
    const inverses = bones.map((_, k) => new THREE.Matrix4().fromArray(d.skin!.inverses, k * 16));
    const skinned = objects[i] as THREE.SkinnedMesh;
    skinned.bindMode = d.skin.bindMode as THREE.BindMode;
    skinned.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4().fromArray(d.skin.bindMatrix));
  });
  // KeyframeTrack accepts typed arrays, though the JSON type says number[].
  const animations = p.animations.map((c) =>
    THREE.AnimationClip.parse({ name: c.name, duration: c.duration, blendMode: c.blendMode, tracks: c.tracks.map((t) => ({ name: t.name, type: t.type, times: t.times, values: t.values, interpolation: t.interpolation })), uuid: THREE.MathUtils.generateUUID() } as unknown as THREE.AnimationClipJSON),
  );
  return { scene: root, animations };
}
