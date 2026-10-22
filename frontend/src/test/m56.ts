// M56: drawing style on the board. In drawings/sketch.excalidraw: Thin / Extra
// change the selected rectangle's line (in the file and the drawing), Sharp
// takes its rounded corners away. With nothing selected and the rectangle tool
// on, the style bar shows the style new shapes get; picking red there and
// drawing a rectangle gives a thin, sharp, red one — the choice is kept in the
// settings, so a drawing opened later starts with it too. While a text is
// edited its drawn copy is hidden (no text on text), and shows again after.
// draw.io: Sharp / Round set the cell's rounded style.
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H = Record<string, any>;
const hooks = (t: Tab) => (t as unknown as { boardTest?: H }).boardTest;

function fire(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 1, isPrimary: true }));
}

async function dragWorld(h: H, from: { x: number; y: number }, to: { x: number; y: number }) {
  const stage: HTMLElement = h.stage();
  const a = h.toScreen(from);
  const b = h.toScreen(to);
  fire(document.elementFromPoint(a.x, a.y) ?? stage, 'pointerdown', a.x, a.y);
  for (let i = 1; i <= 6; i++) {
    fire(stage, 'pointermove', a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
    await sleep(16);
  }
  fire(stage, 'pointerup', b.x, b.y);
  await sleep(40);
}

async function open(path: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(path))!;
  const h = await waitFor(() => (hooks(tab)?.board() ? hooks(tab)! : null), 'board');
  await sleep(100);
  return { tab, h };
}

const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.stylebar button')).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
const els = (h: H) => (h.board().doc.elements as Record<string, any>[]).filter((e) => !e.isDeleted);
const widthsDrawn = (h: H, id: string) => Array.from(h.content().querySelectorAll(`[data-id="${id}"] path`)).map((p) => Number((p as Element).getAttribute('stroke-width')));

export default async function m56(dir: string) {
  settings.update((s) => (s.boardStyle = undefined));
  let { h } = await open(join(dir, 'drawings', 'sketch.excalidraw'));
  const box = els(h).find((e) => e.id === 'box')!;

  // ---- the selected shape ----
  h.setSel(['box']);
  await sleep(50);
  button('Thin')!.click();
  assertEq(box.strokeWidth, 1, 'Thin: width 1 in the file');
  await waitFor(() => (Math.max(...widthsDrawn(h, 'box')) <= 1 ? true : null), 'Thin: drawn thin');
  button('Extra')!.click();
  await waitFor(() => (Math.max(...widthsDrawn(h, 'box')) >= 4 ? true : null), 'Extra: drawn thick');
  button('Thin')!.click();
  assert(box.roundness, 'the box starts rounded');
  button('Sharp')!.click();
  await sleep(30);
  assertEq(box.roundness, null, 'Sharp: no roundness');
  assert(!Array.from(h.content().querySelectorAll('[data-id="box"] path')).some((p) => / Q /.test((p as Element).getAttribute('d') ?? '')), 'drawn without rounded corners');
  assert(button('Sharp')!.classList.contains('on'), 'Sharp shown as chosen');

  // ---- nothing selected, a drawing tool on: the style for new shapes ----
  h.setSel([]);
  h.setTool('rect');
  await waitFor(() => button('Thin'), 'the style bar while drawing');
  assert(button('Thin')!.classList.contains('on') && button('Sharp')!.classList.contains('on'), 'it shows the last choices (thin, sharp)');
  button('Stroke #e03131')!.click();
  await sleep(30);
  // (Other tests may have saved shapes into this drawing: the new one is the one that wasn't there.)
  const before = new Set(els(h).map((e) => e.id));
  await dragWorld(h, { x: 120, y: 420 }, { x: 260, y: 500 });
  const made = els(h).find((e) => e.type === 'rectangle' && !before.has(e.id))!;
  assert(made, 'a rectangle drawn');
  assertEq(`${made.strokeWidth} ${made.roundness} ${made.strokeColor}`, '1 null #e03131', 'drawn thin, sharp and red');
  assertEq(JSON.stringify(settings.value.boardStyle), JSON.stringify({ width: 1, edges: 'sharp', stroke: '#e03131' }), 'the choice is kept in the settings');
  log('width, corners and colour: on the selection and for new shapes');

  // ---- text being edited is not drawn twice ----
  const c = h.toScreen({ x: 520 + 60, y: 300 + 25 });
  h.stage().dispatchEvent(new MouseEvent('dblclick', { clientX: c.x - 100, clientY: c.y, bubbles: true }));
  await waitFor(() => h.editing(), 'editing the note');
  await sleep(30);
  const noteText = h.content().querySelector('[data-id="note"] text') as SVGTextElement;
  assertEq(getComputedStyle(noteText).visibility, 'hidden', 'the drawn text is hidden while editing');
  h.setEditValue('Edited note');
  h.commitText();
  await sleep(50);
  const after = h.content().querySelector('[data-id="note"] text') as SVGTextElement;
  assertEq(getComputedStyle(after).visibility, 'visible', 'and shown again afterwards');
  assert(after.textContent?.includes('Edited note'), 'with the new text');
  log('edited text not drawn under the edit box');

  // ---- a drawing opened later starts with the same style ----
  ({ h } = await open(join(dir, 'drawings', 'photo.excalidraw')));
  h.setTool('ellipse');
  const had = new Set(els(h).map((e) => e.id));
  await dragWorld(h, { x: 50, y: 50 }, { x: 150, y: 120 });
  const ell = els(h).find((e) => e.type === 'ellipse' && !had.has(e.id));
  assertEq(`${ell?.strokeWidth} ${ell?.strokeColor}`, '1 #e03131', 'the new drawing uses the kept style');

  // ---- draw.io corners ----
  ({ h } = await open(join(dir, 'drawings', 'flow.drawio')));
  const cell = [...h.board().cells.values()].find((x: H) => x.vertex && !x.edge);
  h.setSel([cell.id]);
  await sleep(50);
  button('Round')!.click();
  assertEq(cell.style.get('rounded'), '1', 'draw.io: rounded');
  button('Sharp')!.click();
  assertEq(cell.style.get('rounded'), '0', 'draw.io: sharp');
  log('draw.io corners');
  settings.update((s) => (s.boardStyle = undefined));
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
