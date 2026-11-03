// M90: several layers selected at once in the image editor's Layers panel.
// Over a white background, a red square on one layer and a half-transparent
// blue one on another: click the red layer, Shift+click the blue one and both
// are selected (the blue one, clicked last, is the one painted on, ringed; a
// note says so). Copy takes them together, as they look (the blue at half
// strength, the background left out), the whole picture or a selected part;
// pasted back, one layer has both squares. Cut empties the selection on both
// in one undo step. Ctrl+click takes a layer off again or adds it; Shift+click
// on a thumbnail selects from the last layer clicked; Ctrl+J makes one layer
// of the selected ones. A plain click, or a new layer, selects one again.
import { workspace } from '../core/tabs.svelte';
import { join } from '../core/paths';
import { readTransfer } from '../core/transfer.svelte';
import { ui } from '../core/ui.svelte';
import * as selection from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const W = 100;
const H = 60;

function square(color: string, x: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(x, 10, 20, 20);
  return c;
}

const px = (c: HTMLCanvasElement, x: number, y: number) => Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data);
const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

export default async function m90(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
    const ed = h.editor();
    const white = document.createElement('canvas');
    white.width = W;
    white.height = H;
    white.getContext('2d')!.fillStyle = '#fff';
    white.getContext('2d')!.fillRect(0, 0, W, H);
    ed.load(white);
    const bg = ed.state().layers[0].id;
    const red = ed.addLayer('Red', square('#f00', 10)); // x 10…29
    const blue = ed.addLayer('Blue', square('#00f', 60)); // x 60…79
    ed.setLayerProps(blue, { opacity: 0.5 });
    await sleep(50);

    h.setPanel('layers');
    const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;
    await waitFor(() => (root().querySelectorAll('.layers .layer').length === 3 ? true : null), 'three layers listed');
    // Rows are listed top first.
    const row = (id: string) => root().querySelectorAll<HTMLElement>('.layers .layer')[[...ed.state().layers].reverse().findIndex((l: { id: string }) => l.id === id)];
    const click = async (el: Element, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
      await sleep(30);
    };
    const selected = () => ed.state().selectedIds.join(',');

    // ---- Shift+click: both selected, the one clicked last painted on ----
    await click(row(red));
    assertEq(selected(), red, 'a click: one layer');
    await click(row(blue), { shiftKey: true });
    assertEq(selected(), `${red},${blue}`, 'Shift+click: both, bottom first');
    assertEq(ed.state().activeId, blue, 'the one clicked last is painted on');
    assert(row(red).getAttribute('aria-selected') === 'true' && row(blue).getAttribute('aria-selected') === 'true' && row(bg).getAttribute('aria-selected') === 'false', 'both rows selected, the background not');
    assert(row(red).classList.contains('picked') && row(blue).classList.contains('picked') && row(blue).classList.contains('active'), 'both highlighted, the blue one ringed');
    const note = await waitFor(() => root().querySelector('.layers .picknote')?.textContent ?? null, 'a note on the selection');
    assert(note.startsWith('2 layers selected') && note.includes('“Blue”'), note);
    log('Shift+click selects both layers');

    // ---- Copy: both together, as they look ----
    let c = ed.copySelection().canvas;
    assertEq(`${c.width}×${c.height}`, `${W}×${H}`, 'without a selection: the whole picture');
    assert(near(px(c, 20, 20), [255, 0, 0, 255]), `the red square (${px(c, 20, 20)})`);
    assert(near(px(c, 70, 20), [0, 0, 255, 128]), `the blue one at half strength (${px(c, 70, 20)})`);
    assertEq(px(c, 50, 40)[3], 0, 'the background is not among them');

    const r = { x: 5, y: 5, width: 80, height: 30 };
    ed.setPixelSelection(selection.fromPath(selection.rectPath(r), r, W, H), 'replace');
    h.copy();
    assert(ui.toasts.some((t: { message: string }) => t.message === 'Copied 80 × 30 px from 2 layers'), `a toast says so (${ui.toasts.map((t: { message: string }) => t.message).join(' | ')})`);
    await sleep(300);
    const tr = await readTransfer();
    assert(tr?.kind === 'image', 'on the clipboard');
    if (tr?.kind !== 'image') return;
    assertEq(`${tr.image.width}×${tr.image.height}`, '80×30', 'the selected part');
    assert(near(px(tr.image, 15, 15), [255, 0, 0, 255]) && px(tr.image, 65, 15)[2] > 200, `red and blue on it (${px(tr.image, 15, 15)} / ${px(tr.image, 65, 15)})`);

    // Pasted back: one layer with both squares, where they were.
    await h.paste();
    const pasted = await waitFor(() => (ed.state().layers.length === 4 ? ed.state().layers[3] : null), 'pasted as a layer');
    const pc = ed.layerCanvas(pasted.id)!;
    assert(near(px(pc, 15, 15), [255, 0, 0, 255]) && px(pc, 65, 15)[2] > 200, 'the pasted layer has both');
    assertEq(selected(), pasted.id, 'a new layer: one selected again');
    ed.undo();
    await waitFor(() => (ed.state().layers.length === 3 ? true : null), 'paste undone');
    log('copied together and pasted as one layer');

    // ---- Cut: from both, one undo step ----
    await click(row(red));
    await click(row(blue), { shiftKey: true });
    ed.setPixelSelection(selection.fromPath(selection.rectPath(r), r, W, H), 'replace');
    const step = ed.state().step;
    h.copy(true);
    await sleep(50);
    assertEq(ed.state().step, step + 1, 'one step');
    assert(px(ed.layerCanvas(red)!, 20, 20)[3] === 0 && px(ed.layerCanvas(blue)!, 70, 20)[3] === 0, 'both emptied there');
    assertEq(px(ed.layerCanvas(bg)!, 20, 20)[0], 255, 'the background untouched');
    ed.undo();
    await sleep(50);
    assert(px(ed.layerCanvas(red)!, 20, 20)[3] === 255 && px(ed.layerCanvas(blue)!, 70, 20)[3] === 255, 'undo brings both back');
    assertEq(selected(), `${red},${blue}`, 'still both selected after undo');
    log('cut from both layers, undone in one step');

    // ---- Ctrl+click: off and on again ----
    await click(row(red), { ctrlKey: true });
    assertEq(selected(), blue, 'Ctrl+click takes the red layer off');
    c = ed.copySelection().canvas;
    assert(px(c, 15, 15)[3] === 0 && px(c, 65, 15)[2] > 200, 'only the blue square copied');
    await click(row(red), { ctrlKey: true });
    assertEq(selected(), `${red},${blue}`, 'Ctrl+click adds it again');
    assertEq(ed.state().activeId, red, 'the one added is painted on');

    // ---- Shift+click on a thumbnail: from the last layer clicked ----
    await click(row(bg).querySelector('canvas.thumb')!, { shiftKey: true });
    assertEq(selected(), `${bg},${red}`, 'Shift+click on the background thumbnail: from the red layer to it');

    // ---- Ctrl+J: one layer of the selected ones ----
    ed.layerFromSelection();
    await sleep(50);
    assertEq(ed.state().layers.length, 4, 'a new layer');
    const lc = ed.layerCanvas(ed.state().activeId)!; // (just above the background, the active layer)
    assertEq(`${lc.width}×${lc.height}`, '80×30', 'of the selected part');
    assert(near(px(lc, 15, 15), [255, 0, 0, 255]) && near(px(lc, 45, 15), [255, 255, 255, 255]), 'red over white in it');
    ed.undo();
    await sleep(50);

    // ---- A plain click: one again ----
    await click(row(blue));
    assertEq(selected(), blue, 'a plain click selects one');
    assert(!root().querySelector('.layers .picknote') && !root().querySelector('.layers .layer.picked'), 'no note, no highlight left');
    log('Ctrl+click, Shift+click on a thumbnail, Ctrl+J and a plain click');
  } finally {
    await workspace.close(tab, { force: true });
  }
}
