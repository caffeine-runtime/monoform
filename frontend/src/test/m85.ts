// M85: the parts of a CAD model. models/assembly.step: the Parts panel lists
// the assembly with two brackets and a pin. With the brackets hidden from
// their rows' eyes, clicking the pin in the view selects it (tinted, its row
// selected, its name and size in the status bar); H hides it and Show all
// brings everything back; Show only (I) leaves one bracket and Reset view
// frames just it; See-through (X) draws the others as faint glass; Esc
// deselects; a right-click on a part selects it and offers the actions; what
// is hidden comes back with the session. models/two-blocks.stl, one mesh, is
// split into its two bodies.
import * as THREE from 'three';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { menu } from '../core/ui.svelte';
import { boundsOf, type PartNode } from '../modules/model3d/parts';
import type { ModelViewer } from '../modules/model3d/viewer';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  viewer: () => ModelViewer | null;
  loading: () => boolean;
  error: () => string;
  parts: () => PartNode | null;
  hidden: () => Set<string>;
  ghost: () => Set<string>;
  selected: () => Set<string>;
  select: (n: PartNode | null, add?: boolean) => void;
}
const hooks = (t: Tab) => (t as unknown as { modelTest?: Hooks }).modelTest;

async function open(p: string, state?: unknown): Promise<{ tab: Tab; h: Hooks; v: ModelViewer; root: PartNode }> {
  const tab = (await workspace.openPath(p, state ? { state } : {}))!;
  await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() && hooks(tab)!.parts() ? true : null), `${p} loaded`, 30000);
  const h = hooks(tab)!;
  assertEq(h.error(), '', `no error for ${p}`);
  await sleep(100);
  return { tab, h, v: h.viewer()!, root: h.parts()! };
}

const pane = () => document.querySelector<HTMLElement>('.tabview.active')!;
const row = (n: PartNode) => pane().querySelector<HTMLElement>(`[data-part="${CSS.escape(n.id)}"]`);
const shown = (n: PartNode) => n.own.every((o) => o.visible);
const overlays = (v: ModelViewer) => {
  let k = 0;
  v.scene.traverse((o) => (o.userData.mfOverlay ? k++ : 0));
  return k;
};

/** Where a part's middle is on screen. */
function screenOf(v: ModelViewer, n: PartNode): { x: number; y: number } {
  const r = v.renderer.domElement.getBoundingClientRect();
  const p = boundsOf(n.own, true).getCenter(new THREE.Vector3()).project(v.camera);
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}

/** A click (or right-click) that doesn't move, on the stage (the canvas's own controls aren't involved). */
function click(at: { x: number; y: number }, button = 0) {
  const stage = pane().querySelector<HTMLElement>('.stage')!;
  for (const type of ['pointerdown', 'pointerup']) stage.dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y, button, bubbles: true }));
}

export default async function m85(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const path = join(dir, 'models', 'assembly.step');
  let { tab, h, v, root } = await open(path);

  // The panel: the assembly and its three parts.
  assertEq(root.name, 'Assembly', 'the assembly at the top');
  assertEq(root.children.map((c) => c.name).sort().join(','), 'Bracket,Bracket,Pin', 'two brackets and a pin');
  const heading = await waitFor(() => pane().querySelector('.side .parts h4'), 'the Parts panel');
  assertEq(heading.textContent?.trim(), 'Parts (3)', 'counts the parts');
  assertEq(pane().querySelectorAll('.side .part').length, 4, 'a row each (the assembly open)');
  const [b1, b2] = root.children.filter((c) => c.name === 'Bracket');
  const pin = root.children.find((c) => c.name === 'Pin')!;
  assert(row(b2)?.textContent?.includes('#2'), 'the second bracket numbered');

  // Brackets hidden from their eyes; the pin, clicked in the view, is selected.
  for (const b of [b1, b2]) row(b)!.querySelector<HTMLButtonElement>('.eye')!.click();
  await sleep(50);
  assert(!shown(b1) && !shown(b2) && shown(pin), 'the eyes hide the brackets');
  assert(row(root)!.querySelector('.eye.mixed'), 'the assembly shows it is partly hidden');
  click(screenOf(v, pin));
  await waitFor(() => (h.selected().has(pin.id) ? true : null), 'the pin selected by a click');
  assertEq(h.selected().size, 1, 'only the pin');
  assert(row(pin)!.classList.contains('sel'), 'its row selected');
  assertEq(overlays(v), pin.own.filter((o) => (o as THREE.Mesh).isMesh).length, 'tinted');
  assert(tab.status.info?.startsWith('Pin · '), `its name and size in the status bar (${tab.status.info})`);
  log('the panel lists the parts; a click in the view selects one');

  // H hides it; Show all brings everything back.
  commands.execute('model.hide');
  await sleep(50);
  assert(!shown(pin) && !h.selected().size && !overlays(v), 'H hides the selection');
  commands.execute('model.showAll');
  await sleep(50);
  assert(shown(b1) && shown(b2) && shown(pin) && !h.hidden().size, 'Show all');

  // Show only (I): one bracket alone, and Reset view frames it.
  h.select(b1);
  await sleep(20);
  commands.execute('model.only');
  await sleep(50);
  assert(shown(b1) && !shown(b2) && !shown(pin), 'I leaves the bracket alone');
  commands.execute('model.reset');
  await sleep(50);
  const centre = boundsOf(b1.own, true).getCenter(new THREE.Vector3());
  assert(v.controls.target.distanceTo(centre) < 0.01, `Reset view frames what is shown (${v.controls.target.toArray()} vs ${centre.toArray()})`);
  log('H hides, Show only leaves the selection, Reset view frames it');

  // See-through (X): the others as faint glass, the bracket as it is.
  commands.execute('model.seeThrough');
  await sleep(50);
  assert(shown(b2) && shown(pin) && h.ghost().has(pin.id) && !h.hidden().size, 'X shows the others…');
  const glass = (pin.own.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.Material;
  assert(glass.transparent && glass.opacity < 0.3, `…as glass (opacity ${glass.opacity})`);
  const solid = (b1.own.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).material as THREE.Material;
  assert(solid.opacity === 1, 'the selection stays solid');
  commands.execute('model.deselect');
  await sleep(20);
  assert(!h.selected().size && !overlays(v), 'Esc deselects');
  commands.execute('model.showAll');
  await sleep(50);
  assert(!h.ghost().size && solid.opacity === 1, 'Show all ends see-through');
  log('See-through draws the others as glass');

  // A right-click on a part (whichever is in front there): selected, with the actions.
  commands.execute('model.reset');
  await sleep(50);
  const at = screenOf(v, pin);
  const hit = v.pick(at.x, at.y);
  const under = [b1, b2, pin].find((n) => hit && n.own.includes(hit));
  assert(under, 'a part under the pointer');
  click(at, 2);
  const open1 = await waitFor(() => menu.open, 'the menu');
  assert(h.selected().has(under.id) && h.selected().size === 1, `the part under the pointer selected (${under.name})`);
  const labels = open1.items.map((i) => i.label).filter(Boolean);
  for (const l of ['Hide', 'Show only this', 'See-through others', 'Zoom to selection', 'Show all']) assert(labels.includes(l), `menu has ${l} (${labels.join(', ')})`);
  menu.close();

  // Hidden parts come back with the session.
  commands.execute('model.hide');
  await sleep(50);
  const state = tab.handlers.getState?.();
  assertEq(JSON.stringify(state), JSON.stringify({ hidden: [under.id], ghost: [] }), 'the session keeps what is hidden');
  await workspace.close(tab, { force: true });
  ({ tab, h, v, root } = await open(path, state));
  const again = root.children.find((c) => c.id === under.id)!;
  await waitFor(() => (!shown(again) ? true : null), 'hidden again');
  assert(h.hidden().has(again.id) && root.children.filter((c) => c !== again).every(shown), 'and only that part');

  // The parts list: each part once, with how many; a row selects every copy.
  [...pane().querySelectorAll<HTMLButtonElement>('.side .phead .btn')].find((b) => b.textContent?.trim() === 'List')!.click();
  const bom = await waitFor(() => {
    const r = [...pane().querySelectorAll<HTMLButtonElement>('.side .bom')];
    return r.length ? r : null;
  }, 'the parts list');
  const text = (b: HTMLElement) => `${b.querySelector('.nm')?.textContent} ${b.querySelector('.qty')?.textContent}`;
  assertEq(bom.map(text).sort().join(' | '), 'Bracket ×2 | Pin ×1', 'each part once, with how many');
  assert(/^\d+(\.\d+)? × \d+(\.\d+)? × \d+(\.\d+)?$/.test(bom[0].querySelector('.dims')!.textContent!), 'with its size');
  bom.find((b) => b.textContent?.includes('Bracket'))!.click();
  await sleep(30);
  const brackets = root.children.filter((c) => c.name === 'Bracket');
  assert(brackets.every((b) => h.selected().has(b.id)) && h.selected().size === 2, 'a row selects every copy');
  assertEq(JSON.stringify((tab.handlers.getState?.() as { partsView?: string }).partsView), '"list"', 'the session keeps the list view');
  await workspace.close(tab, { force: true });
  log('a right-click offers the actions; hidden parts come back with the session; the parts list counts copies');

  // One STL mesh with two separate blocks: two bodies.
  const stl = await open(join(dir, 'models', 'two-blocks.stl'));
  assertEq(stl.root.children.map((c) => c.body).join(','), '1,2', 'split into two bodies');
  const rows = await waitFor(() => (pane().querySelectorAll('.side .part').length === 3 ? [...pane().querySelectorAll('.side .part .name')].map((e) => e.textContent?.trim()) : null), 'the bodies listed');
  assertEq(rows.slice(1).join(','), 'Body 1,Body 2', 'named Body 1 and 2');
  const big = boundsOf(stl.root.children[0].own, true).getSize(new THREE.Vector3());
  assert(Math.abs(big.x - 20) < 0.01, `body 1 is the 20 mm block (${big.x})`);
  await workspace.close(stl.tab, { force: true });
  log('an STL’s separate bodies become parts');
}
