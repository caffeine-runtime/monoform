// M14 acceptance: Excel-like grid in CSV and xlsx — range selection (mouse,
// keys, headers), status-bar stats, copy/cut/paste as TSV, clear, undo/redo,
// fill handle with series, drag-to-move, AutoComplete, formula shifting.
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, press, sleep, waitFor } from './harness';

const csvH = (t: Tab) => (t as any).csvTest;
const sheetH = (t: Tab) => (t as any).sheetTest;

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

const gridEl = () => document.querySelector<HTMLElement>('.tabview.active .grid')!;

/** Centre of a rendered cell. */
function cellXY(row: number, col: number) {
  // Row height follows the interface size (--row on the grid).
  const grid = document.querySelector<HTMLElement>('.tabview.active .grid')!;
  const rowH = parseFloat(grid.style.getPropertyValue('--row')) || 28;
  const tr = [...document.querySelectorAll<HTMLElement>('.tabview.active .grid .tr')].find((e) => e.style.top === `${row * rowH}px`);
  assert(tr, `row ${row} rendered`);
  const r = tr.children[col + 1].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

function pointer(type: string, x: number, y: number, target: EventTarget = gridEl()) {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true }));
}

async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  pointer('pointerdown', from.x, from.y);
  await sleep(20);
  for (let i = 1; i <= 4; i++) {
    pointer('pointermove', from.x + ((to.x - from.x) * i) / 4, from.y + ((to.y - from.y) * i) / 4);
    await sleep(16);
  }
  pointer('pointerup', to.x, to.y);
}

const sameSel = (a: any, b: any) => a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;

async function csv(dir: string) {
  const tab = (await workspace.openPath(join(dir, 'data', 'grid.csv')))!;
  assertEq(tab.moduleId, 'csv', 'csv module');
  const h = await waitFor(() => (csvH(tab)?.info() && csvH(tab).grid() ? csvH(tab) : null), 'csv loaded');
  const g = h.grid();
  const col = async (c: number) => (await h.rows(0, h.info().rows)).map((r: string[]) => r[c]).join(',');
  await waitFor(() => document.querySelectorAll('.tabview.active .grid .td').length >= 12, 'cells rendered');
  await waitFor(() => !document.querySelector('.tabview.active .td.loading'), 'cells filled');

  // Header click selects the whole column; the status bar shows its stats.
  const th = document.querySelectorAll<HTMLElement>('.tabview.active .grid .th')[2];
  const tr = th.getBoundingClientRect();
  pointer('pointerdown', tr.left + 10, tr.top + 10, th);
  pointer('pointerup', tr.left + 10, tr.top + 10);
  assert(sameSel(g.selection(), { r0: 0, c0: 2, r1: 3, c1: 2 }), `column selected: ${JSON.stringify(g.selection())}`);
  await waitFor(() => th.classList.contains('fullcol'), 'column header highlighted');
  const stats = await waitFor(() => h.stats(), 'selection stats');
  assertEq(stats, 'Average: 2.5 · Count: 4 · Sum: 10', 'qty stats');
  assertEq(tab.status?.position, stats, 'stats in the status bar');

  // Ctrl+A, then mouse drag A1→B2.
  press('Ctrl+a', gridEl());
  assert(sameSel(g.selection(), { r0: 0, c0: 0, r1: 3, c1: 2 }), 'Ctrl+A selects all');
  await drag(cellXY(0, 0), cellXY(1, 1));
  assert(sameSel(g.selection(), { r0: 0, c0: 0, r1: 1, c1: 1 }), `drag selects A1:B2: ${JSON.stringify(g.selection())}`);
  await waitFor(() => document.querySelector('.tabview.active .selrect'), 'selection rectangle');
  press('Shift+ArrowDown', gridEl());
  assert(sameSel(g.selection(), { r0: 0, c0: 0, r1: 2, c1: 1 }), 'Shift+Down extends');
  press('Shift+ArrowUp', gridEl());

  // Copy as TSV, paste past the end (adds a row), undo/redo.
  assertEq(await g.copy(), 'Anna\tWarsaw\r\nBartek\tWroclaw', 'copied TSV');
  g.select({ r0: 3, c0: 0, r1: 3, c1: 0 });
  await g.pasteText('Anna\tWarsaw\r\nBartek\tWroclaw');
  await waitFor(() => h.info().rows === 5, 'paste appended a row');
  assertEq(await col(0), 'Anna,Bartek,Celina,Anna,Bartek', 'pasted names');
  assertEq(await col(1), 'Warsaw,Wroclaw,Berlin,Warsaw,Wroclaw', 'pasted cities');
  assert(tab.dirty, 'dirty after paste');
  press('Ctrl+z', gridEl());
  await waitFor(() => h.info().rows === 4, 'undo removes the added row');
  assertEq(await col(0), 'Anna,Bartek,Celina,Dawid', 'undo restores names');
  press('Ctrl+y', gridEl());
  await waitFor(() => h.info().rows === 5, 'redo');
  press('Ctrl+z', gridEl());
  await waitFor(() => h.info().rows === 4, 'undo again');

  // Paste from another app: one value fills the selection.
  g.select({ r0: 0, c0: 2, r1: 1, c1: 2 });
  await g.pasteText('7');
  await waitFor(async () => (await col(2)) === '7,7,3,4', 'single value fills the selection');
  press('Ctrl+z', gridEl());
  await waitFor(async () => (await col(2)) === '1,2,3,4', 'undo paste');

  // Delete clears the range.
  g.select({ r0: 0, c0: 1, r1: 1, c1: 2 });
  press('Delete', gridEl());
  await waitFor(async () => (await col(1)) === ',,Berlin,Warsaw' && (await col(2)) === ',,3,4', 'Delete clears B1:C2');
  press('Ctrl+z', gridEl());
  await waitFor(async () => (await col(1)) === 'Warsaw,Wroclaw,Berlin,Warsaw', 'undo clear');

  // Cut + paste moves.
  g.select({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const cut = await g.copy(true);
  await waitFor(() => document.querySelector('.tabview.active .cutrect'), 'cut marquee');
  g.select({ r0: 0, c0: 1, r1: 0, c1: 1 });
  await g.pasteText(cut);
  await waitFor(async () => (await h.rows(0, 1))[0].join(',') === ',Anna,1', 'cut + paste moved the cell');
  assert(!document.querySelector('.tabview.active .cutrect'), 'marquee gone after the move');
  press('Ctrl+z', gridEl());
  await waitFor(async () => (await h.rows(0, 1))[0].join(',') === 'Anna,Warsaw,1', 'undo move');

  // Fill handle: 10, 20 → 30, 40.
  await h.edit(0, 2, '10');
  await h.edit(1, 2, '20');
  g.select({ r0: 0, c0: 2, r1: 1, c1: 2 });
  const handle = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .handle'), 'fill handle');
  await sleep(30);
  const hr = handle.getBoundingClientRect();
  const fill = await measureJank(async () => {
    await drag({ x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 }, cellXY(3, 2));
    await waitFor(async () => (await col(2)) === '10,20,30,40', 'fill handle continued the series');
  });
  assert(sameSel(g.selection(), { r0: 0, c0: 2, r1: 3, c1: 2 }), 'filled range selected');
  press('Ctrl+z', gridEl());
  await waitFor(async () => (await col(2)) === '10,20,3,4', 'undo fill');

  // Drag the selection border to move cells (onto data: confirm replaces).
  const confirm = ui.confirm;
  let asked = 0;
  ui.confirm = async () => (asked++, true);
  try {
    g.select({ r0: 0, c0: 0, r1: 1, c1: 0 });
    await sleep(30);
    const a = cellXY(0, 0);
    const b = cellXY(2, 0);
    await drag({ x: a.left + 2, y: a.y }, { x: b.left + 2, y: b.y });
    await waitFor(async () => (await col(0)) === ',,Anna,Bartek', 'border drag moved A1:A2 down two rows');
  } finally {
    ui.confirm = confirm;
  }
  assertEq(asked, 1, 'asked before replacing data');
  assert(sameSel(g.selection(), { r0: 2, c0: 0, r1: 3, c1: 0 }), 'moved range selected');
  press('Ctrl+z', gridEl());
  await waitFor(async () => (await col(0)) === 'Anna,Bartek,Celina,Dawid', 'undo move');

  // AutoComplete while typing.
  g.select({ r0: 1, c0: 1, r1: 1, c1: 1 });
  g.focus();
  gridEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'W', bubbles: true, cancelable: true }));
  const input = await waitFor(() => document.querySelector<HTMLInputElement>('.tabview.active .grid .editor'), 'editor');
  await sleep(50);
  assertEq(input.value, 'W', 'two matches: no completion yet');
  input.value = 'Wa';
  input.setSelectionRange(2, 2);
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'a', bubbles: true }));
  await waitFor(() => input.value === 'Warsaw', 'completed to Warsaw');
  assertEq(`${input.selectionStart}-${input.selectionEnd}`, '2-6', 'completed part selected');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(async () => (await col(1)) === 'Warsaw,Warsaw,Berlin,Warsaw', 'completion committed');
  assertEq(g.cursor().row, 2, 'Enter moved down');

  log(`CSV grid: fill drag longest frame ${Math.round(fill.maxGap)} ms`);
  assert(await h.save(), 'csv saved');
  await closeAll();
}

async function xlsx(dir: string) {
  const tab = (await workspace.openPath(join(dir, 'office', 'grid.xlsx')))!;
  const h = await waitFor(() => (sheetH(tab)?.book() && sheetH(tab).grid() ? sheetH(tab) : null), 'workbook');
  const g = h.grid();
  const input = async (r: number, c: number) => (await h.cell(r, c)).input;
  await waitFor(() => document.querySelectorAll('.tabview.active .grid .td').length > 20, 'grid rendered');

  // Copy a formula and paste it two columns right (C holds dates): references shift.
  g.select({ r0: 3, c0: 1, r1: 3, c1: 1 });
  const text = await g.copy();
  assertEq(text, '1212.5', 'clipboard has the value');
  g.select({ r0: 3, c0: 3, r1: 3, c1: 3 });
  await g.pasteText(text);
  await waitFor(async () => (await input(3, 3)) === '=SUM(D2:D3)', 'pasted formula shifted');
  await h.edit(1, 3, '10');
  await h.edit(2, 3, '5');
  await waitFor(async () => (await h.rows(3, 4))[0][3] === '15', 'shifted formula computes');
  await h.undoRedo(false);
  await waitFor(async () => (await h.rows(3, 4))[0][3] === '10', 'undo recalculates');
  await h.undoRedo(true);
  await waitFor(async () => (await h.rows(3, 4))[0][3] === '15', 'redo recalculates');

  // Fill right and Ctrl+D.
  g.select({ r0: 3, c0: 1, r1: 3, c1: 1 });
  await g.fillTo({ r0: 3, c0: 1, r1: 3, c1: 4 });
  await waitFor(async () => (await input(3, 4)) === '=SUM(E2:E3)' && (await input(3, 2)) === '=SUM(C2:C3)', 'fill right shifts columns');
  g.select({ r0: 3, c0: 1, r1: 4, c1: 1 });
  g.focus();
  press('Ctrl+d', gridEl());
  await waitFor(async () => (await input(4, 1)) === '=SUM(B3:B4)', 'Ctrl+D shifts rows');
  await waitFor(async () => (await h.rows(4, 5))[0][1] === '2412.5', 'filled formula computes');

  // Status-bar stats, AutoComplete from Go.
  g.select({ r0: 1, c0: 1, r1: 2, c1: 1 });
  const stats = await waitFor(() => h.stats(), 'sheet stats');
  assert(/^Average: 606.25 · Count: 2 · Sum: 1.?212.5$/.test(stats), `sheet stats: ${stats}`);
  const { api } = await import('../core/backend');
  assertEq(await api.SheetComplete(h.book().id, 'Budget', 0, 're'), 'Rent', 'sheet AutoComplete');
  assertEq(await api.SheetComplete(h.book().id, 'Budget', 0, '12'), '', 'no completion for numbers');
  assert(tab.dirty, 'dirty');
  assert(await workspace.save(tab), 'xlsx saved');
  await closeAll();
}

export default async function m14(dir: string) {
  await csv(dir);
  log('CSV: column/all/drag selection, stats, TSV copy/paste, clear, cut-move, fill handle, border move, AutoComplete, undo/redo');
  await xlsx(dir);
  log('xlsx: formula shifting on paste/fill/Ctrl+D, undo/redo with recalculation, stats, AutoComplete');
}
