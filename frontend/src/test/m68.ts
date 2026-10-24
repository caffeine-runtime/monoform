// M68: Levels and Curves. On the GPU, on a grey ramp: Levels with the black
// point at 51 and the white point at 204 make 51 black, 204 white and leave
// the middle in place; midtones (gamma 2) brighten 64 to about 128; a red
// curve through (0.5, 0.75) makes mid-grey's red 191 and leaves its green.
// In the editor, on a picture whose greys run from 50 to 200: Adjust ›
// Levels shows the histogram and Auto puts the black and white points at 50
// and 200; applying stretches the picture to 0…255, one undo puts it back.
// Adjust › Curves: a click on the graph adds a point, dragging moves it (the
// preview follows), a double-click removes it; Red, Green and Blue curves are
// separate.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { Adjuster, NEUTRAL } from '../modules/image/adjust';
import { LEVELS_NEUTRAL, CURVES_NEUTRAL } from '../modules/image/tone';
import { assert, assertEq, log, sleep, waitFor } from './harness';

function ramp(from = 0, to = 255): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 256; x++) {
    const v = Math.round(from + ((to - from) * x) / 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 16);
  }
  return c;
}
const at = (c: HTMLCanvasElement, x: number) => Array.from(c.getContext('2d')!.getImageData(x, 8, 1, 1).data.slice(0, 3));

export default async function m68(dir: string) {
  // ---- on the GPU ----
  const adj = new Adjuster(ramp());
  try {
    adj.render({ ...NEUTRAL, levels: { ...LEVELS_NEUTRAL, inBlack: 51 / 255, inWhite: 204 / 255 } });
    let out = adj.snapshot();
    assert(at(out, 51)[0] <= 2 && at(out, 30)[0] <= 2, `black point → black (${at(out, 51)})`);
    assert(at(out, 204)[0] >= 253 && at(out, 230)[0] >= 253, `white point → white (${at(out, 204)})`);
    assert(Math.abs(at(out, 128)[0] - 128) <= 3, `the middle stays (${at(out, 128)})`);
    adj.render({ ...NEUTRAL, levels: { ...LEVELS_NEUTRAL, gamma: 2 } });
    out = adj.snapshot();
    assert(Math.abs(at(out, 64)[0] - 128) <= 3, `midtones 2 brighten 64 to ~128 (${at(out, 64)})`);
    adj.render({ ...NEUTRAL, curves: { ...CURVES_NEUTRAL, r: [[0, 0], [0.5, 0.75], [1, 1]] } });
    out = adj.snapshot();
    const mid = at(out, 128);
    assert(Math.abs(mid[0] - 191) <= 3 && Math.abs(mid[1] - 128) <= 2, `red curve: (${mid})`);
  } finally {
    adj.destroy();
  }
  log('levels, midtones and a channel curve on the GPU');

  // ---- in the editor ----
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  ed.load(ramp(50, 200));
  await sleep(50);
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;
  h.setPanel('adjust');
  (await waitFor(() => root().querySelector<HTMLButtonElement>('.adjust .page[data-page="levels"]'), 'Levels in the list')).click();
  await waitFor(() => root().querySelector('.adjust .histo path'), 'the histogram');
  const auto = Array.from(root().querySelectorAll<HTMLButtonElement>('.adjust .chip')).find((b) => b.textContent === 'Auto')!;
  auto.click();
  await sleep(30);
  const lv = h.adjust().test.get().levels;
  assert(Math.abs(lv.inBlack * 255 - 50) <= 1 && Math.abs(lv.inWhite * 255 - 200) <= 1, `Auto: black ${lv.inBlack * 255}, white ${lv.inWhite * 255}`);
  await waitFor(() => (ed.state().adjusting ? true : null), 'previewed');
  h.adjust().test.apply();
  await sleep(50);
  const c = ed.composite();
  assert(at(c, 0)[0] <= 2 && at(c, 255)[0] >= 253, `applied: stretched to ${at(c, 0)}…${at(c, 255)}`);
  ed.undo();
  assert(Math.abs(at(ed.composite(), 0)[0] - 50) <= 1, 'one undo puts it back');
  log('Levels page: histogram, Auto, apply, undo');

  // ---- Curves: a point added, moved and removed with the pointer ----
  root().querySelector<HTMLButtonElement>('.adjust .back')!.click();
  (await waitFor(() => root().querySelector<HTMLButtonElement>('.adjust .page[data-page="curves"]'), 'Curves in the list')).click();
  const svg = await waitFor(() => root().querySelector<SVGSVGElement>('.adjust svg.curve'), 'the curve');
  const r = svg.getBoundingClientRect();
  const fire = (el: Element, type: string, fx: number, fy: number) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + fx * r.width, clientY: r.top + (1 - fy) * r.height, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  fire(svg, 'pointerdown', 0.5, 0.5);
  fire(svg, 'pointermove', 0.5, 0.7);
  fire(svg, 'pointerup', 0.5, 0.7);
  await sleep(50);
  let rgb = h.adjust().test.get().curves.rgb;
  assertEq(rgb.length, 3, 'a point added');
  const p = rgb.find((q: number[]) => q[0] > 0.1 && q[0] < 0.9);
  assert(Math.abs(p[0] - 0.5) < 0.03 && Math.abs(p[1] - 0.7) < 0.03, `and dragged up to (${p})`);
  await waitFor(() => (ed.state().adjusting ? true : null), 'the preview follows');
  const pts = root().querySelectorAll('.adjust svg.curve circle.pt');
  assertEq(pts.length, 3, 'three points drawn');
  pts[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await sleep(30);
  rgb = h.adjust().test.get().curves.rgb;
  assertEq(rgb.length, 2, 'a double-click removes it');
  const red = Array.from(root().querySelectorAll<HTMLButtonElement>('.adjust .chip')).find((b) => b.textContent === 'Red')!;
  red.click();
  await sleep(30);
  fire(svg, 'pointerdown', 0.25, 0.5);
  fire(svg, 'pointerup', 0.25, 0.5);
  await sleep(30);
  const cv = h.adjust().test.get().curves;
  assert(cv.r.length === 3 && cv.rgb.length === 2 && cv.g.length === 2, 'the red curve is its own');
  h.adjust().test.reset();
  log('Curves page: add, drag, remove points; channels separate');
  await workspace.close(tab, { force: true });
}
