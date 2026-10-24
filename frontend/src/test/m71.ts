// M71: layer styles. A black 40×40 square on its own layer over white: the
// Layers panel's style button shows Drop shadow, Stroke and Outer glow;
// ticking Stroke and picking red rings the square in red, worked out in the
// worker (the layer gets an "fx" mark); dragging the size slider previews
// without a history step, letting go makes one. A drop shadow with the light
// from above falls below the square only; an outer glow fades out. Undo
// takes a style off again. Saved as .ora and reopened, the style comes back
// (the layer's own PNG stays without it, the merged image has it). Merge down
// keeps the look and burns the style into the pixels.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { api, endpoint } from '../core/backend';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const W = 120;
const H = 100;

export default async function m71(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const white = document.createElement('canvas');
  white.width = W;
  white.height = H;
  white.getContext('2d')!.fillStyle = '#fff';
  white.getContext('2d')!.fillRect(0, 0, W, H);
  ed.load(white);
  const sq = document.createElement('canvas');
  sq.width = W;
  sq.height = H;
  sq.getContext('2d')!.fillRect(40, 30, 40, 40); // black, x 40…79, y 30…69
  const id = ed.addLayer('Square', sq);
  await sleep(50);
  const px = (x: number, y: number) => Array.from(ed.composite().getContext('2d')!.getImageData(x, y, 1, 1).data) as number[];
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;
  const L = () => ed.layers.find((l: { id: string }) => l.id === id);
  const drawn = () => waitFor(() => (L().fxDone === L().fxRev && L().fx.image() ? true : null), 'the worker drew the effects', 5000);

  // ---- the panel ----
  h.setPanel('layers');
  const btn = await waitFor(() => root().querySelector<HTMLButtonElement>('.layers .actions button[aria-pressed]'), 'the layer style button');
  btn.click();
  await waitFor(() => root().querySelector('.layers .styles'), 'the styles');
  assertEq(root().querySelectorAll('.layers .styles .fx').length, 3, 'shadow, stroke, glow');
  const fx = (k: string) => root().querySelector(`.layers .styles .fx[data-fx="${k}"]`)!;
  const box = fx('stroke').querySelector<HTMLInputElement>('input[type=checkbox]')!;
  box.click();
  await sleep(20);
  const colour = await waitFor(() => fx('stroke').querySelector<HTMLInputElement>('input[type=color]'), 'the stroke colour');
  colour.value = '#ff0000';
  colour.dispatchEvent(new Event('input', { bubbles: true }));
  colour.dispatchEvent(new Event('change', { bubbles: true }));
  await drawn();
  assertEq(ed.state().layers[1].style.stroke.color, '#ff0000', 'red stroke');
  assert(root().querySelector('.layers .layer .fxmark'), 'the layer shows fx');
  assertEq(px(38, 50).join(), '255,0,0,255', 'stroke 2 px left of the square');
  assertEq(px(35, 50).join(), '255,255,255,255', 'not 5 px out (size 3)');
  assertEq(px(60, 50).join(), '0,0,0,255', 'the square on top');

  // The size slider: dragging previews, letting go is one step.
  const steps = ed.history.length;
  const size = fx('stroke').querySelector<HTMLInputElement>('[data-knob="size"] input[type=range]')!;
  size.value = '6';
  size.dispatchEvent(new Event('input', { bubbles: true }));
  await drawn();
  assertEq(ed.history.length, steps, 'no step while dragging');
  assertEq(px(35, 50).join(), '255,0,0,255', 'the preview: 6 px wide');
  size.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(20);
  assertEq(ed.history.length, steps + 1, 'one step on letting go');
  log('stroke from the panel, worked out in the worker, previewed while dragging');

  // ---- drop shadow and glow ----
  ed.setLayerStyle(id, { shadow: { color: '#000000', opacity: 1, angle: 90, distance: 10, size: 0 } });
  await drawn();
  assertEq(px(60, 75).join(), '0,0,0,255', 'light from above: the shadow below');
  assertEq(px(60, 25).join(), '255,255,255,255', 'and not above');
  assert(!fx('stroke').querySelector('input[type=checkbox]:checked') && fx('shadow').querySelector('input[type=checkbox]:checked'), 'the panel follows');
  ed.setLayerStyle(id, { glow: { color: '#ffff00', opacity: 1, size: 12 } });
  const g1 = px(82, 50);
  const g2 = px(88, 50);
  assert(g1[2] < g2[2] && g2[2] < 255 && g1[0] === 255 && g1[1] === 255, `a yellow glow fading out (${g1} → ${g2})`);
  assertEq(px(95, 50).join(), '255,255,255,255', 'gone after its size');
  ed.undo();
  assertEq(ed.state().layers[1].style.shadow?.distance, 10, 'undo: the shadow again');
  log('drop shadow below, glow fading, undo');

  // ---- .ora keeps it; merge burns it in ----
  ed.setLayerStyle(id, { stroke: { color: '#0000ff', opacity: 1, size: 4 } });
  const look = [px(37, 50), px(60, 50), px(30, 50)];
  const ora = join(dir, 'img', 'out', 'styled.ora');
  await api.CreateFolder(join(dir, 'img', 'out')).catch(() => {});
  assert(await h.writeImage(ora), 'saved as .ora');
  const own = await createImageBitmap(await (await fetch(endpoint('zip', { path: ora, entry: 'data/layer1.png' }))).blob());
  const oc = document.createElement('canvas');
  oc.width = W;
  oc.height = H;
  oc.getContext('2d')!.drawImage(own, 0, 0);
  assertEq(oc.getContext('2d')!.getImageData(37, 50, 1, 1).data[3], 0, 'the layer PNG is without the style');
  await workspace.close(tab, { force: true });
  const t2 = (await workspace.openPath(ora))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h2: any = await waitFor(() => ((t2 as any).imageTest?.editor() ? (t2 as any).imageTest : null), 'reopened .ora', 10000);
  const E2 = h2.editor();
  await waitFor(() => (E2.state().layers.length === 2 ? true : null), 'two layers', 5000);
  assertEq(E2.state().layers[1].style?.stroke?.color, '#0000ff', 'the style came back');
  const px2 = (x: number, y: number) => Array.from(E2.composite().getContext('2d')!.getImageData(x, y, 1, 1).data).join();
  assertEq([px2(37, 50), px2(60, 50), px2(30, 50)].join(' '), look.map((p) => p.join()).join(' '), 'and looks the same');
  E2.setActive(E2.state().layers[1].id);
  E2.mergeDown();
  assertEq(E2.state().layers.length, 1, 'merged');
  assert(!E2.state().layers[0].style, 'no style left');
  assertEq(px2(37, 50), '0,0,255,255', 'the stroke is in the pixels');
  log('.ora keeps the style; merge down burns it in');
  await workspace.close(t2, { force: true });
}
