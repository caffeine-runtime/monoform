// M51: image editor — drag a layer row in the Layers panel to restack it
// (undoable), and the paint bucket: a click fills the area of similar colour
// on the active layer, only inside the selection when there is one, with the
// toolbar's Tolerance and Contiguous.
import { join } from '../core/paths';
import { commands } from '../core/commands';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ImageEditor } from '../modules/image/editor';
import * as selection from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  fillAt: (x: number, y: number) => Promise<void>;
  setPanel: (p: 'layers' | 'adjust' | null) => void;
  tool: () => string;
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

function px(c: HTMLCanvasElement, x: number, y: number): number[] {
  return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

/** Press on a row, move past the threshold to y, release (as a mouse would). */
async function dragRow(row: HTMLElement, y: number) {
  const r = row.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const at = (type: string, cy: number, el: EventTarget) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: cy, button: 0, buttons: 1, pointerId: 1, isPrimary: true }));
  at('pointerdown', r.top + r.height / 2, row);
  for (let i = 1; i <= 5; i++) {
    at('pointermove', r.top + r.height / 2 + ((y - r.top - r.height / 2) * i) / 5, window);
    await sleep(16);
  }
  at('pointerup', y, window);
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  await sleep(50);
}

export default async function m51(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'subject.png')))!;
  const h = await waitFor(() => (hooks(tab)?.editor() ? hooks(tab) : null), 'image editor');
  const ed = h.editor()!;
  h.setPanel('layers');
  const names = () => ed.state().layers.map((l) => l.name).join(',');

  // ---- drag layers ----
  const bg = names();
  ed.addLayer('A');
  ed.addLayer('B');
  assertEq(names(), `${bg},A,B`, 'stack, bottom first');
  const rows = () => [...document.querySelectorAll<HTMLElement>('.layers .list .layer')];
  await waitFor(() => (rows().length === 3 ? true : null), 'three rows in the panel');
  assert(rows()[0].textContent!.includes('B'), 'top row is the top layer');
  // B (top) to below the background: the bottom of the stack.
  const last = rows()[2].getBoundingClientRect();
  await dragRow(rows()[0], last.bottom - 2);
  assertEq(names(), `B,${bg},A`, 'dragged to the bottom');
  assertEq(ed.state().layers.find((l) => l.id === ed.state().activeId)?.name, 'B', 'the dragged layer is active');
  // A (now top) one step down, between the background and B.
  const mid = rows()[2].getBoundingClientRect();
  await dragRow(rows()[0], mid.top + 3);
  assertEq(names(), `B,A,${bg}`, 'dropped in the gap above the bottom row');
  // A short wiggle is a click, not a drag.
  const before = names();
  const r0 = rows()[1].getBoundingClientRect();
  await dragRow(rows()[1], r0.top + r0.height / 2 + 2);
  assertEq(names(), before, 'a tiny move does not restack');
  ed.undo();
  assertEq(names(), `B,${bg},A`, 'undo the last move');
  ed.undo();
  assertEq(names(), `${bg},A,B`, 'undo the first move');
  log('layers dragged up and down, undone');

  // ---- paint bucket ----
  commands.execute('image.toolFill');
  await sleep(50);
  assertEq(h.tool(), 'fill', 'G / the command picks the bucket');
  assert([...document.querySelectorAll('.opt')].some((o) => o.textContent?.includes('Tolerance')), 'Tolerance in the toolbar');
  assert([...document.querySelectorAll<HTMLButtonElement>('button.icon-btn')].some((b) => b.getAttribute('aria-label') === 'Paint bucket' && b.classList.contains('on')), 'bucket button on');
  // On the empty top layer B: a green bar, then fill around it with blue.
  ed.setOptions({ color: '#00ff00', brushSize: 10, brushOpacity: 1 });
  ed.paint([{ x: 0, y: 150 }, { x: 400, y: 150 }]);
  const id = ed.state().activeId;
  ed.setOptions({ color: '#0000ff' });
  await h.fillAt(20, 20);
  let c = ed.layerCanvas(id)!;
  assertEq(px(c, 20, 20).join(','), '0,0,255,255', 'clicked area filled');
  assertEq(px(c, 390, 100).join(','), '0,0,255,255', 'the whole connected area');
  assert(px(c, 200, 150)[1] > 200 && px(c, 200, 150)[2] < 50, 'the bar is a border: kept');
  assertEq(px(c, 200, 280)[3], 0, 'the other side of the bar is not connected');
  // Not contiguous: every pixel of that colour.
  ed.undo();
  ed.setOptions({ wandContiguous: false });
  await h.fillAt(20, 20);
  assertEq(px(ed.layerCanvas(id)!, 200, 280).join(','), '0,0,255,255', 'not contiguous: both sides');
  ed.setOptions({ wandContiguous: true });
  // Inside a selection only.
  ed.setOptions({ color: '#ff0000' });
  ed.setPixelSelection(selection.fromPath(selection.rectPath({ x: 0, y: 0, width: 100, height: 100 }), { x: 0, y: 0, width: 100, height: 100 }, ed.width, ed.height));
  await h.fillAt(20, 20);
  c = ed.layerCanvas(id)!;
  assertEq(px(c, 20, 20).join(','), '255,0,0,255', 'filled inside the selection');
  assertEq(px(c, 200, 50).join(','), '0,0,255,255', 'untouched outside it');
  ed.undo();
  assertEq(px(ed.layerCanvas(id)!, 20, 20).join(','), '0,0,255,255', 'undo the fill');
  ed.deselect();
  log('bucket fills contiguous / all / inside the selection, undoable');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
