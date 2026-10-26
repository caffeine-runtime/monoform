// M83: drawing on a PDF like in a notebook (pdf/three.pdf). The tool bar
// has Marker, Shapes and Eraser next to the pen; a tool shows eight colour
// swatches and thin/medium/thick. The marker draws a freehand highlight
// over text. Shapes: an arrow (two strokes: shaft and head) and a rectangle
// (one closed stroke) become pdf.js ink drawings in the chosen colour. The
// eraser dragged across the arrow removes it and leaves the rectangle; undo
// brings it back. A lined page goes in after page 1 (the old page 2 is page
// 3 now). The pen takes the chosen swatch. Saved, the file has four Ink
// annotations, the marker's green among them (pdf.js saves freehand
// highlights as ink; scripts/verify-pdf.sh checks with qpdf).
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Ed {
  editorType: string;
  deleted?: boolean;
  parent: unknown;
  serialize(copy?: boolean): { color?: number[]; paths?: { points: ArrayLike<number>[] } } | null;
}
interface Hooks {
  doc: () => { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str: string }[] }> }> } | null;
  tool: () => string;
  editors: () => { getEditors(i: number): Iterable<Ed>; undo(): void } | null;
  writeTo: (p: string) => Promise<boolean>;
}
const hooks = (t: Tab) => (t as unknown as { pdfTest: Hooks }).pdfTest;
const pane = () => document.querySelector<HTMLElement>('.tabview.active')!;
const button = (title: string) => waitFor(() => [...pane().querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.title.startsWith(title)), `${title} button`);

function pointer(el: Element, type: string, x: number, y: number, target: Element = el) {
  const r = el.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
}

/** Drag from (x0, y0) to (x1, y1) in a page's coordinates, dispatched to target. */
async function drag(page: Element, target: Element, x0: number, y0: number, x1: number, y1: number) {
  pointer(page, 'pointerdown', x0, y0, target);
  for (let i = 1; i <= 8; i++) pointer(page, 'pointermove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, target);
  pointer(page, 'pointerup', x1, y1, target);
  await sleep(150);
}

const live = (h: Hooks, type: string) => [...(h.editors()?.getEditors(0) ?? [])].filter((e) => e.editorType === type && !e.deleted && e.parent);

export default async function m83(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'pdf', 'three.pdf')))!;
  await waitFor(() => hooks(tab)?.doc(), 'document loaded', 15000);
  const h = hooks(tab);
  const page1 = await waitFor(() => pane().querySelector('.page[data-page-number="1"]'), 'page 1');
  await waitFor(() => page1.querySelector('.textLayer span'), 'text layer');

  // The pen takes the swatch too (pdf.js gets it through its event bus).
  (await button('Draw')).click();
  await waitFor(() => (h.tool() === 'ink' ? true : null), 'pen');
  await sleep(300);
  pane().querySelector<HTMLButtonElement>('.swatch[aria-label="#1e5bd8"]')!.click();
  const layer = await waitFor(() => page1.querySelector('.annotationEditorLayer'), 'editor layer');
  await drag(page1, layer, 320, 420, 420, 470);
  pane().querySelector<HTMLButtonElement>('.toolbar button[title="Select text"]')!.click(); // leaving the pen commits its drawing
  await waitFor(() => (live(h, 'ink').length === 1 ? true : null), 'a pen stroke');
  assertEq(JSON.stringify(live(h, 'ink')[0].serialize(true)!.color), JSON.stringify([30, 91, 216]), 'the pen stroke is blue');
  log('pen: drawn in the chosen colour');

  // The marker, with a colour and a width.
  (await button('Marker')).click();
  await waitFor(() => (h.tool() === 'marker' ? true : null), 'marker tool');
  assertEq(pane().querySelectorAll('.swatches .swatch').length, 8, 'eight swatches');
  assertEq(pane().querySelectorAll('.toolopts [aria-label="Width"] button').length, 3, 'thin, medium, thick');
  assert(pane().querySelector('.swatch[aria-label="#8ce99a"]') && !pane().querySelector('.swatch[aria-label="#1d1d1f"]'), 'light highlighter colours');
  pane().querySelector<HTMLButtonElement>('.swatch[aria-label="#8ce99a"]')!.click();
  pane().querySelector<HTMLButtonElement>('.toolopts [aria-label="Width"] button[title="Thick"]')!.click();
  assert(pane().querySelector('.container.marker'), 'the text layer gives way to the marker');
  await sleep(400); // pdf.js switches modes asynchronously
  const text = page1.querySelector<HTMLElement>('.textLayer')!;
  await drag(page1, text, 60, 50, 300, 60);
  try {
    await waitFor(() => (live(h, 'highlight').length ? true : null), 'a freehand highlight', 5000);
  } catch (e) {
    log(`editors on page 1: ${[...(h.editors()?.getEditors(0) ?? [])].map((x) => x.editorType).join(',')}; text layer classes: ${text.className}`);
    throw e;
  }
  assertEq((live(h, 'highlight')[0] as unknown as { color: string }).color, '#8ce99a', 'in the chosen colour');
  log('marker: a freehand highlight over the text, green');

  // Shapes: an arrow and a rectangle.
  (await button('Shapes')).click();
  await waitFor(() => (h.tool() === 'shape' ? true : null), 'shapes tool');
  pane().querySelector<HTMLButtonElement>('.toolopts [aria-label="Arrow"]')!.click();
  pane().querySelector<HTMLButtonElement>('.swatch[aria-label="#d0021b"]')!.click();
  const catcher = await waitFor(() => pane().querySelector('[data-draw="shape"]'), 'shape overlay');
  await drag(page1, catcher, 80, 200, 280, 260);
  await waitFor(() => (live(h, 'ink').length === 2 ? true : null), 'the arrow');
  const arrow = live(h, 'ink')[1].serialize(true)!;
  assertEq(arrow.paths!.points.length, 2, 'an arrow is a shaft and a head');
  assertEq(JSON.stringify(arrow.color), JSON.stringify([208, 2, 27]), 'in the chosen colour');
  pane().querySelector<HTMLButtonElement>('.toolopts [aria-label="Rectangle"]')!.click();
  await drag(page1, catcher, 100, 400, 260, 500);
  await waitFor(() => (live(h, 'ink').length === 3 ? true : null), 'the rectangle');
  const rect = live(h, 'ink')[2].serialize(true)!;
  const r = rect.paths!.points[0];
  assert(r.length > 40 && Math.abs(r[0] - r[r.length - 2]) < 0.01 && Math.abs(r[1] - r[r.length - 1]) < 0.01, `a rectangle is one closed stroke, dense enough to stay straight (${r.length / 2} points)`);
  log('shapes: an arrow (shaft + head) and a rectangle, as ink drawings');

  // The eraser takes the arrow, not the rectangle; undo brings it back.
  (await button('Eraser')).click();
  await waitFor(() => (h.tool() === 'eraser' ? true : null), 'eraser tool');
  const eraser = await waitFor(() => pane().querySelector('[data-draw="eraser"]'), 'eraser overlay');
  await drag(page1, eraser, 180, 180, 180, 280);
  await waitFor(() => (live(h, 'ink').length === 2 ? true : null), 'the arrow erased');
  assert(live(h, 'ink').every((e) => e.serialize(true)!.paths!.points.length === 1), 'the pen stroke and the rectangle stay');
  h.editors()!.undo();
  await waitFor(() => (live(h, 'ink').length === 3 ? true : null), 'undo brings the arrow back');
  log('eraser: removes what it touches; undo restores it');


  // A lined page after page 1.
  await (tab as unknown as { pdfTest: { insertPaper(p: string): Promise<void> } }).pdfTest.insertPaper('lined');
  await waitFor(() => (h.doc()?.numPages === 4 ? true : null), 'four pages');
  const textOf = async (n: number) => (await (await h.doc()!.getPage(n)).getTextContent()).items.map((i) => i.str).join('');
  assertEq(await textOf(2), '', 'page 2 is the new, empty page');
  assert((await textOf(3)).includes('Page 2'), 'the old page 2 follows it');
  log('a lined page after page 1');

  const out = join(dir, 'pdf', 'out');
  await api.CreateFolder(out).catch(() => {});
  assert(await h.writeTo(join(out, 'drawn.pdf')), 'saved');
  assertEq(await api.PdfPageCount(join(out, 'drawn.pdf')), 4, 'saved with four pages');
  log('saved pdf/out/drawn.pdf');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
