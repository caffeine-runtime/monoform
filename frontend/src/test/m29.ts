// M29: Excalidraw and draw.io drawings on the board canvas, driven with
// real pointer events — select, drag (the connected arrow follows), edit a
// label, draw a rectangle and connect it with an arrow, undo/redo, recolour,
// delete, save and reopen; draw.io: a compressed two-page file, move a shape
// (its edges re-route), relabel, switch page, save uncompressed; PNG export.
import { readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const bh = (t: Tab) => (t as unknown as { boardTest?: Record<string, any> }).boardTest;

function fire(target: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 1, isPrimary: true, ...extra }));
}

async function dragWorld(h: Record<string, any>, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6) {
  const stage: HTMLElement = h.stage();
  const a = h.toScreen(from);
  const b = h.toScreen(to);
  const target = document.elementFromPoint(a.x, a.y) ?? stage;
  fire(target, 'pointerdown', a.x, a.y);
  for (let i = 1; i <= steps; i++) {
    fire(stage, 'pointermove', a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(16);
  }
  fire(stage, 'pointerup', b.x, b.y);
  await sleep(40);
}

async function clickWorld(h: Record<string, any>, p: { x: number; y: number }) {
  const s = h.toScreen(p);
  const target = document.elementFromPoint(s.x, s.y) ?? h.stage();
  fire(target, 'pointerdown', s.x, s.y);
  fire(h.stage(), 'pointerup', s.x, s.y);
  await sleep(30);
}

const els = (h: Record<string, any>) => JSON.parse(h.board().serialize()).elements as any[];
const el = (h: Record<string, any>, id: string) => els(h).find((e) => e.id === id);

export default async function m29(dir: string) {
  // ---- Excalidraw ----
  const path = join(dir, 'drawings', 'sketch.excalidraw');
  const t = (await workspace.openPath(path))!;
  assertEq(t.moduleId, 'board', '.excalidraw opens on the board');
  const h = await waitFor(() => (bh(t)?.board() && bh(t)!.content()?.childElementCount === 6 ? bh(t) : null), 'drawn');
  assert(document.fonts.check('20px HiaVirgil'), 'hand-drawn font loaded');
  assert(h.content().querySelector('[data-id="pen"] path'), 'freehand stroke');
  await waitFor(() => t.status?.info?.startsWith('5 objects'), 'status');

  // Select and drag the box: its label and the connected arrow follow.
  await clickWorld(h, { x: 130, y: 120 });
  assertEq(h.sel().join(), 'box', 'clicked box selected');
  const { maxGap } = await measureJank(() => dragWorld(h, { x: 130, y: 120 }, { x: 130, y: 200 }));
  log(`drag: longest frame ${Math.round(maxGap)} ms`);
  assertEq(el(h, 'box').y, 180, 'box moved down 80');
  assertEq(el(h, 'label').y, 222.5, 'label followed');
  assertEq(el(h, 'arr').y, 235, 'arrow start followed');
  assertEq(el(h, 'arr').points[1][1], -80, 'arrow end stayed on the ellipse');

  // Edit the label by double-clicking.
  const c = h.toScreen({ x: 140, y: 200 });
  h.stage().dispatchEvent(new MouseEvent('dblclick', { clientX: c.x, clientY: c.y, bubbles: true }));
  await waitFor(() => h.editing(), 'editing');
  h.setEditValue('Renamed box');
  h.commitText();
  assertEq(el(h, 'label').text, 'Renamed box', 'label edited');

  // Draw a rectangle, then an arrow from it to the ellipse (zoomed out so it all fits).
  const st = h.stage().getBoundingClientRect();
  h.stage().dispatchEvent(new WheelEvent('wheel', { deltaY: 60, ctrlKey: true, clientX: st.left + st.width / 2, clientY: st.top + st.height / 2, bubbles: true, cancelable: true }));
  await sleep(30);
  assert(h.view().zoom < 1, 'zoomed out');
  h.setTool('rect');
  await dragWorld(h, { x: 120, y: 420 }, { x: 260, y: 500 });
  const rect = els(h).find((e) => e.type === 'rectangle' && e.id !== 'box');
  assert(rect && Math.round(rect.width) === 140, 'rectangle drawn');
  h.setTool('arrow');
  await dragWorld(h, { x: 200, y: 460 }, { x: 580, y: 150 });
  const arrow = els(h).find((e) => e.type === 'arrow' && e.id !== 'arr');
  assertEq(arrow?.startBinding?.elementId, rect.id, 'arrow starts on the new rectangle');
  assertEq(arrow?.endBinding?.elementId, 'circ', 'and ends on the ellipse');

  // Undo / redo.
  h.undo();
  assert(!els(h).some((e) => e.id === arrow.id), 'undo removes the arrow');
  h.redo();
  assert(els(h).some((e) => e.id === arrow.id), 'redo brings it back');

  // Recolour via the style bar, then delete with the keyboard.
  h.setSel([rect.id]);
  await waitFor(() => document.querySelector('.tabview.active .stylebar'), 'style bar');
  (document.querySelector<HTMLButtonElement>('.tabview.active .stylebar button[aria-label="Stroke #e03131"]'))!.click();
  assertEq(el(h, rect.id).strokeColor, '#e03131', 'stroke colour set');
  h.setSel(['pen']);
  h.stage().focus();
  h.stage().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert(!els(h).some((e) => e.id === 'pen'), 'deleted');

  assert(await h.save(), 'saved');
  const saved = JSON.parse(new TextDecoder().decode(await readFile(path)));
  assert(saved.elements.some((e: any) => e.text === 'Renamed box') && saved.elements.length === 7, 'saved content');
  const png = join(dir, 'drawings', 'sketch.png');
  assert(await h.pngTo(png, 1), 'PNG export');
  assertEq([...new Uint8Array(await readFile(png)).slice(0, 4)].join(), '137,80,78,71', 'PNG written');
  assert((await h.exportSvgText()).svg.includes('@font-face'), 'SVG export embeds the font');
  await workspace.close(t, { force: true });

  // ---- draw.io ----
  const dpath = join(dir, 'drawings', 'flow.drawio');
  const d = (await workspace.openPath(dpath))!;
  assertEq(d.moduleId, 'board', '.drawio opens on the board');
  const dh = await waitFor(() => (bh(d)?.board() && bh(d)!.content()?.childElementCount === 5 ? bh(d) : null), 'draw.io page drawn');
  assertEq(dh.board().pages().join(','), 'Flow,Notes', 'two pages (compressed in the file)');
  const e2 = () => dh.board().item('e2').box;
  const before = e2();
  await clickWorld(dh, { x: 470, y: 90 });
  assertEq(dh.sel().join(), 'done', 'ellipse selected');
  await dragWorld(dh, { x: 470, y: 90 }, { x: 470, y: 250 });
  assert(before.h === 0 && Math.round(e2().y + e2().h) === 220, `connected edge re-routed down to the ellipse's top (${JSON.stringify(e2())})`);
  const s = dh.toScreen({ x: 100, y: 90 });
  dh.stage().dispatchEvent(new MouseEvent('dblclick', { clientX: s.x, clientY: s.y, bubbles: true }));
  await waitFor(() => dh.editing(), 'editing a draw.io label');
  dh.setEditValue('Begin');
  dh.commitText();
  dh.setPage(1);
  await waitFor(() => (dh.content().textContent.includes('Second page') ? true : null), 'second page');
  assert(await dh.save(), 'saved');
  const xml = new TextDecoder().decode(await readFile(dpath));
  assert(xml.includes('value="Begin"') && xml.includes('<mxGraphModel'), 'saved uncompressed with the new label');
  await workspace.close(d, { force: true });
  const d2 = (await workspace.openPath(dpath))!;
  const dh2 = await waitFor(() => (bh(d2)?.board() && bh(d2)!.content()?.childElementCount === 5 ? bh(d2) : null), 'reopened');
  assertEq(Math.round(dh2.board().item('done').box.y), 220, 'move persisted');
  await workspace.close(d2, { force: true });
}
