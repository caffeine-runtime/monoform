// M57: STEP CAD models. models/assembly.step (scripts/stepfixture.py): a
// bracket with a hole placed twice (once turned) and a pin through the first
// one. It opens in the 3D viewer, read in the worker; the product structure
// is kept (two Bracket groups sharing their meshes, a Pin), the parts carry
// their colours (blue bracket, red hole face, orange pin), edges are drawn,
// and it stands Z up. The same file as .stp opens too.
import * as THREE from 'three';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { FloorGrid } from '../modules/model3d/grid';
import type { ModelViewer, ModelStats } from '../modules/model3d/viewer';
import { assert, assertEq, log, measureJank, waitFor } from './harness';

interface Hooks {
  viewer: () => ModelViewer | null;
  stats: () => ModelStats | null;
  loading: () => boolean;
  error: () => string;
  loadInfo: () => { millis: number; worker: boolean };
}
const hooks = (t: Tab) => (t as unknown as { modelTest?: Hooks }).modelTest;

async function open(p: string) {
  let tab!: Tab;
  const jank = await measureJank(async () => {
    tab = (await workspace.openPath(p))!;
    await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), `${p} loaded`, 30000);
  });
  const h = hooks(tab)!;
  assertEq(h.error(), '', `no error for ${p}`);
  assertEq(tab.moduleId, 'model3d', '3D module');
  return { tab, h, jank: Math.round(jank.maxGap) };
}

function drawnPixels(v: ModelViewer): number {
  v.renderer.render(v.scene, v.camera);
  const src = v.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const bg = (v.scene.background as THREE.Color).clone().convertLinearToSRGB();
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - bg.r * 255) + Math.abs(px[i + 1] - bg.g * 255) + Math.abs(px[i + 2] - bg.b * 255) > 6) n++;
  return n;
}

export default async function m57(dir: string) {
  const path = join(dir, 'models', 'assembly.step');
  const { tab, h, jank } = await open(path);
  assert(h.loadInfo().worker, 'read in the worker');
  const v = h.viewer()!;
  const stats = h.stats()!;
  assert(stats.triangles > 2000, `triangles (${stats.triangles})`);
  const named = (n: string) => {
    const out: THREE.Object3D[] = [];
    v.scene.traverse((o) => o.name === n && out.push(o));
    return out;
  };
  assertEq(`${named('Bracket').length} ${named('Pin').length}`, '2 1', 'two brackets and a pin');
  const meshes: THREE.Mesh[] = [];
  v.scene.traverse((o) => (o as THREE.Mesh).isMesh && !(o instanceof FloorGrid) && meshes.push(o as THREE.Mesh));
  const colours = new Set(meshes.map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString()));
  for (const c of ['4d80cc', 'e61a1a', 'ff8c00']) assert(colours.has(c), `colour #${c} (${[...colours]})`);
  const [a, b] = named('Bracket').map((o) => o.children.find((x) => (x as THREE.Mesh).isMesh) as THREE.Mesh);
  assert(a.geometry === b.geometry, 'instances share their geometry');
  let edges = 0;
  v.scene.traverse((o) => (o as THREE.LineSegments).isLineSegments && o.name === 'edges' && edges++);
  assertEq(edges, 3, 'edges drawn for each part instance');
  // Z up in the file: the 10 mm tall bracket is 10 high, Y up on screen.
  const box = new THREE.Box3().setFromObject(named('Bracket')[0]);
  const size = box.getSize(new THREE.Vector3());
  assert(Math.abs(size.y - 10) < 0.01 && Math.abs(size.x - 20) < 0.01, `stands upright (${size.toArray().map((x) => x.toFixed(2))})`);
  assert(drawnPixels(v) > 2000, 'rendered');
  assert(jank < 200, `no long main-thread task while loading (${jank} ms)`);
  log(`assembly.step: ${stats.triangles} triangles, 3 parts placed, colours and edges`);
  await workspace.close(tab, { force: true });

  // .stp is the same format.
  const second = await open(join(dir, 'models', 'assembly.stp'));
  assertEq(second.h.stats()!.triangles, stats.triangles, '.stp opens the same');
  await workspace.close(second.tab, { force: true });
  log('.stp too');
}
