// M11: 3D viewer — GLB (embedded texture, two animations), FBX (two
// animation stacks), Draco glTF, PBR with the baked environment, OBJ+MTL with a texture from the folder, STL, PLY point
// cloud, Collada (main-thread loader); animation list playback, wireframe
// and lighting toggles, rendering.
import * as THREE from 'three';
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ModelViewer, ModelStats, AnimState } from '../modules/model3d/viewer';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  viewer: () => ModelViewer | null;
  stats: () => ModelStats | null;
  anims: () => { name: string; duration: number }[];
  anim: () => AnimState;
  loading: () => boolean;
  error: () => string;
  loadInfo: () => { millis: number; worker: boolean };
  toggle: (w: 'wireframe' | 'lighting' | 'grid') => void;
}
const hooks = (t: Tab) => (t as unknown as { modelTest?: Hooks }).modelTest;

async function open(p: string): Promise<{ tab: Tab; h: Hooks; ms: number; jank: number }> {
  const t0 = performance.now();
  let tab!: Tab;
  const jank = await measureJank(async () => {
    tab = (await workspace.openPath(p))!;
    await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), `${p} loaded`, 20000);
  });
  const h = hooks(tab)!;
  assertEq(h.error(), '', `no error for ${p}`);
  assertEq(tab.moduleId, 'model3d', '3D module');
  return { tab, h, ms: Math.round(performance.now() - t0), jank: Math.round(jank.maxGap) };
}

function meshes(v: ModelViewer): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  v.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** Does the centre of the rendered view differ from the background? */
function drawsSomething(v: ModelViewer): boolean {
  v.renderer.render(v.scene, v.camera);
  const src = v.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const mid = g.getImageData(src.width / 2 - 2, src.height / 2 - 2, 4, 4).data;
  const bg = (v.scene.background as THREE.Color).clone().convertLinearToSRGB();
  return Math.abs(mid[0] - bg.r * 255) + Math.abs(mid[1] - bg.g * 255) + Math.abs(mid[2] - bg.b * 255) > 30;
}

export default async function m11(dir: string) {
  const M = join(dir, 'models');

  // GLB: texture + two clips.
  const glb = await open(join(M, 'animated.glb'));
  log(`glb opened in ${glb.ms} ms (worker ${glb.h.loadInfo().worker}, parse ${glb.h.loadInfo().millis} ms), longest UI frame ${glb.jank} ms`);
  const s = glb.h.stats()!;
  assertEq(`${s.meshes}/${s.vertices}/${s.triangles}/${s.textures}`, '1/24/12/1', 'glb stats');
  assertEq(glb.h.anims().map((a) => a.name).join(','), 'Spin,Bounce', 'animation list');
  const v = glb.h.viewer()!;
  assert(drawsSomething(v), 'model rendered');
  {
    // "Save view as PNG" captures the model (the canvas doesn't keep its buffer between frames).
    await sleep(100);
    const bmp = await createImageBitmap(await v.screenshot());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const mid = g.getImageData(bmp.width / 2, bmp.height / 2, 1, 1).data;
    const bg = (v.scene.background as THREE.Color).clone().convertLinearToSRGB();
    assert(Math.abs(mid[0] - bg.r * 255) + Math.abs(mid[1] - bg.g * 255) + Math.abs(mid[2] - bg.b * 255) > 30, `screenshot shows the model (${mid.slice(0, 3).join(',')})`);
  }
  const cube = meshes(v)[0];
  const tex = (cube.material as THREE.MeshStandardMaterial).map;
  assert(tex?.image, 'embedded texture decoded');
  {
    // The 64×64 checker: red (220,90,60) in the 16 px square at the top left,
    // read in the worker and uploaded as pixels (not an ImageBitmap).
    const img = tex!.image as { data: Uint8Array; width: number; height: number };
    assert(img.data instanceof Uint8Array, 'texture arrives as pixels');
    const px = (x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)).join(',');
    assertEq(`${img.width}×${img.height} ${px(8, 8)} ${px(24, 8)}`, '64×64 220,90,60 245,235,220', 'texture pixels');
  }
  // Click the second clip in the list.
  const clips = document.querySelectorAll<HTMLButtonElement>('.anims .clip');
  assertEq(clips.length, 2, 'clips listed');
  clips[1].click();
  await waitFor(() => (glb.h.anim().index === 1 && glb.h.anim().playing ? true : null), 'Bounce playing');
  const y0 = cube.position.y;
  await sleep(400);
  assert(glb.h.anim().time > 0.1 && Math.abs(cube.position.y - y0) > 0.01, `Bounce moves the cube (t=${glb.h.anim().time.toFixed(2)}, y=${cube.position.y.toFixed(2)})`);
  clips[1].click(); // clicking the playing clip pauses it
  await waitFor(() => (!glb.h.anim().playing ? true : null), 'paused');
  clips[0].click();
  await waitFor(() => (glb.h.anim().index === 0 && glb.h.anim().playing ? true : null), 'Spin playing');
  await sleep(300);
  assert(Math.abs(cube.quaternion.y) > 0.05, 'Spin rotates the cube');
  {
    // Orbit the camera while the animation plays, the way a mouse drag does
    // (rotate + update per pointer move): one render per frame, no more.
    const render = v.renderer.render.bind(v.renderer);
    let renders = 0;
    v.renderer.render = (s, c) => (renders++, render(s, c));
    const controls = v.controls as unknown as { _rotateLeft(a: number): void; update(): boolean };
    let frames = 0;
    let on = true;
    const count = () => {
      frames++;
      if (on) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    const orbit = await measureJank(async () => {
      for (let i = 0; i < 60; i++) {
        controls._rotateLeft(0.03);
        controls.update();
        await sleep(16);
      }
      await sleep(300); // damping settles
    });
    on = false;
    v.renderer.render = render;
    log(`orbit while animating: ${renders} renders in ${frames} frames, longest frame ${Math.round(orbit.maxGap)} ms`);
    assert(renders <= frames + 2, `one render per frame while orbiting (${renders} renders, ${frames} frames)`);
  }
  v.stopAnimation();
  // Wireframe and lighting toggles.
  glb.h.toggle('wireframe');
  assert((meshes(v)[0].material as THREE.MeshStandardMaterial).wireframe, 'wireframe on');
  glb.h.toggle('wireframe');
  glb.h.toggle('lighting');
  assert(meshes(v)[0].material instanceof THREE.MeshBasicMaterial && !v.scene.environment, 'lighting off = unlit material, no environment');
  assert((meshes(v)[0].material as THREE.MeshBasicMaterial).map === tex, 'unlit keeps the texture');
  glb.h.toggle('lighting');
  assert(meshes(v)[0].material instanceof THREE.MeshStandardMaterial && !!v.scene.environment, 'lighting back on');
  await workspace.close(glb.tab, { force: true });

  // FBX with two animation stacks.
  const fbx = await open(join(M, 'waving.fbx'));
  assertEq(fbx.h.anims().map((a) => a.name).join(','), 'Wave,Nod', 'fbx animations');
  fbx.h.viewer()!.play(0);
  await sleep(300);
  assert(fbx.h.anim().playing && fbx.h.anim().time > 0.05, 'fbx animation plays');
  assert(drawsSomething(fbx.h.viewer()!), 'fbx rendered');
  log(`fbx opened in ${fbx.ms} ms, longest UI frame ${fbx.jank} ms`);
  await workspace.close(fbx.tab, { force: true });

  // OBJ + MTL + texture from the folder (through the page route).
  await api.TestServedPages();
  const obj = await open(join(M, 'textured.obj'));
  const served: string[] = await api.TestServedPages();
  assert(served.includes('textured.mtl') && served.includes('tex/checker.png'), `mtl and texture fetched (${served.join(', ')})`);
  const om = meshes(obj.h.viewer()!)[0];
  const omap = (Array.isArray(om.material) ? om.material[0] : om.material) as THREE.MeshPhongMaterial;
  assert(omap.map?.image, 'obj texture applied');
  assertEq(obj.h.stats()!.triangles, 12, 'obj triangles');
  await workspace.close(obj.tab, { force: true });

  // Draco-compressed glTF: the decoder runs in a worker nested in the load worker.
  const knot = await open(join(M, 'knot-draco.glb'));
  // (Draco merges the knot's duplicated seam vertices, so only triangles are exact.)
  assert(knot.h.stats()!.triangles === 2304 && knot.h.stats()!.vertices > 1000, 'draco mesh decoded');
  assert(drawsSomething(knot.h.viewer()!), 'draco model rendered');
  log(`draco glb opened in ${knot.ms} ms, longest UI frame ${knot.jank} ms`);
  await workspace.close(knot.tab, { force: true });

  // PBR materials get the baked reflection environment.
  const sph = await open(join(M, 'spheres.glb'));
  const env = sph.h.viewer()!.scene.environment as THREE.DataTexture | null;
  assert(env?.mapping === THREE.CubeUVReflectionMapping && env.image.width === 336, 'baked environment loaded');
  assert(drawsSomething(sph.h.viewer()!), 'spheres rendered');
  log(`spheres opened in ${sph.ms} ms, longest UI frame ${sph.jank} ms`);

  // Two 3D tabs share one renderer; its canvas follows the visible tab.
  const cube2 = await open(join(M, 'cube.stl'));
  assert(cube2.h.viewer()!.renderer === sph.h.viewer()!.renderer, 'one renderer for all 3D tabs');
  log(`second 3D tab opened in ${cube2.ms} ms, longest UI frame ${cube2.jank} ms`);
  workspace.activate(sph.tab);
  await waitFor(() => (sph.h.viewer()!.renderer.domElement.offsetParent ? true : null), 'canvas moved to the shown tab');
  assert(drawsSomething(sph.h.viewer()!), 'shown tab renders');
  await workspace.close(sph.tab, { force: true });
  await waitFor(() => (workspace.activeId === cube2.tab.id && cube2.h.viewer()!.renderer.domElement.offsetParent ? true : null), 'canvas back on the remaining tab');
  assert(drawsSomething(cube2.h.viewer()!), 'remaining tab renders');
  await workspace.close(cube2.tab, { force: true });

  // STL, PLY points, Collada (main-thread loader).
  const stl = await open(join(M, 'cube.stl'));
  assertEq(stl.h.stats()!.triangles, 12, 'stl triangles');
  assert(drawsSomething(stl.h.viewer()!), 'stl rendered');
  await workspace.close(stl.tab, { force: true });
  const ply = await open(join(M, 'spiral.ply'));
  assertEq(ply.h.stats()!.points, 1000, 'ply points');
  await workspace.close(ply.tab, { force: true });
  const dae = await open(join(M, 'triangle.dae'));
  assertEq(dae.h.loadInfo().worker, false, 'collada parsed on the main thread');
  assertEq(dae.h.stats()!.triangles, 1, 'dae triangle');
  await workspace.close(dae.tab, { force: true });
}
