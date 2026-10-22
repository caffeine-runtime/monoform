// M58: right-click menus. In the code editor (code/sample.ts) the menu has
// the text editing items and the editor's commands; Copy, Cut, Paste, Undo
// and Select all from it do what their keys do (the system clipboard holds
// what was copied). A plain text field gets Cut / Copy / Paste too. In a Word
// document's table cell: formatting, the Table submenu (a row added) and
// Insert. On a drawing's shape: it is selected and Duplicate adds one. In the
// image editor: its commands (Rotate clockwise from the Transform submenu).
// Selected text in the Markdown preview: Copy.
import { EditorView } from '@codemirror/view';
import { join } from '../core/paths';
import { menu, type MenuItem } from '../core/ui.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ClipboardGetText, ClipboardSetText } from '../wailsjs/runtime/runtime';
import { assert, assertEq, log, sleep, waitFor } from './harness';

async function rightClick(el: Element, at?: { x: number; y: number }): Promise<MenuItem[]> {
  menu.close();
  await sleep(30);
  const r = el.getBoundingClientRect();
  const x = at?.x ?? r.left + Math.min(12, r.width / 2);
  const y = at?.y ?? r.top + Math.min(8, r.height / 2);
  const target = document.elementFromPoint(x, y) ?? el;
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  return waitFor(() => menu.open?.items ?? null, 'a context menu');
}

const labels = (items: MenuItem[]) => items.filter((i) => !i.separator).map((i) => i.label ?? '');
function item(items: MenuItem[], ...path: string[]): MenuItem {
  let list = items;
  let it: MenuItem | undefined;
  for (const p of path) {
    it = list.find((x) => x.label === p);
    assert(it, `menu item ${path.join(' › ')} (have: ${labels(list).join(', ')})`);
    list = it!.items ?? [];
  }
  return it!;
}
async function choose(items: MenuItem[], ...path: string[]) {
  const it = item(items, ...path);
  assert(!it.disabled, `${path.join(' › ')} enabled`);
  menu.close();
  await it.run!();
  await sleep(60);
}

async function open(path: string): Promise<Tab> {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  return (await workspace.openPath(path))!;
}

export default async function m58(dir: string) {
  // ---- code editor ----
  await open(join(dir, 'code', 'sample.ts'));
  const cm = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .cm-editor'), 'code editor');
  const view = EditorView.findFromDOM(cm)!;
  await waitFor(() => (view.state.doc.length > 10 ? true : null), 'the file in the editor');
  const doc0 = view.state.doc.toString();
  const word = /\w+/.exec(doc0)![0];
  const at = doc0.indexOf(word);
  view.dispatch({ selection: { anchor: at, head: at + word.length } });
  view.focus();
  const line = cm.querySelector('.cm-line')!;
  let items = await rightClick(line);
  for (const l of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select all', 'Lines', 'Change case', 'Go to line…']) item(items, l);
  await ClipboardSetText('');
  await choose(items, 'Copy');
  assertEq(await ClipboardGetText(), word, 'Copy put the selection on the clipboard');
  items = await rightClick(line);
  await choose(items, 'Cut');
  assertEq(view.state.doc.toString(), doc0.slice(0, at) + doc0.slice(at + word.length), 'Cut removed it');
  assertEq(await ClipboardGetText(), word, 'and put it on the clipboard');
  items = await rightClick(line);
  await choose(items, 'Paste');
  await waitFor(() => (view.state.doc.toString() === doc0 ? true : null), 'Paste put it back');
  items = await rightClick(line);
  await choose(items, 'Undo');
  assertEq(view.state.doc.toString(), doc0.slice(0, at) + doc0.slice(at + word.length), 'Undo took the paste back');
  items = await rightClick(line);
  await choose(items, 'Select all');
  assertEq(view.state.selection.main.to - view.state.selection.main.from, view.state.doc.length, 'Select all');
  log('code editor: copy, cut, paste, undo, select all; its commands listed');

  // ---- a plain text field ----
  const input = document.createElement('input');
  input.value = 'hello world';
  input.style.cssText = 'position:fixed;left:40px;top:40px;width:200px;z-index:99999';
  document.body.append(input);
  input.focus();
  input.setSelectionRange(6, 11);
  items = await rightClick(input);
  assertEq(labels(items).join(','), 'Undo,Redo,Cut,Copy,Paste,Delete,Select all', 'text field items');
  await choose(items, 'Copy');
  assertEq(await ClipboardGetText(), 'world', 'copied from the field');
  input.setSelectionRange(11, 11);
  items = await rightClick(input);
  assert(item(items, 'Cut').disabled && item(items, 'Copy').disabled, 'Cut / Copy disabled without a selection');
  await choose(items, 'Paste');
  assertEq(input.value, 'hello worldworld', 'pasted into the field');
  input.remove();
  log('text field');

  // ---- Word document: table cell ----
  await open(join(dir, 'office', 'report.docx'));
  const td = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active td'), 'a table cell');
  const rows = td.closest('table')!.rows.length;
  const r = document.createRange();
  r.selectNodeContents(td);
  r.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  items = await rightClick(td);
  for (const l of ['Cut', 'Copy', 'Paste', 'Paste as plain text', 'Format', 'Bulleted list', 'Link…', 'Table', 'Insert']) item(items, l);
  item(items, 'Format', 'Bold');
  await choose(items, 'Table', 'Insert row below');
  assertEq(td.closest('table')!.rows.length, rows + 1, 'a row added from the menu');
  const para = document.querySelector<HTMLElement>('.tabview.active [data-p]:not(td [data-p])')!;
  items = await rightClick(para);
  assert(!labels(items).includes('Table'), 'no Table submenu outside a table');
  log('Word document: formatting, table, insert');

  // ---- drawing: a shape ----
  const board = await open(join(dir, 'drawings', 'sketch.excalidraw'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bh = await waitFor(() => ((board as any).boardTest?.board() ? (board as any).boardTest : null), 'drawing');
  await sleep(100);
  const count = () => (bh.board().doc.elements as { isDeleted?: boolean }[]).filter((e) => !e.isDeleted).length;
  const n0 = count();
  const shape = await waitFor(() => document.querySelector('.tabview.active [data-id="box"]'), 'the box');
  const sb = shape.getBoundingClientRect();
  items = await rightClick(shape, { x: sb.left + 2, y: sb.top + sb.height / 2 });
  assertEq(JSON.stringify(bh.sel()), '["box"]', 'the shape right-clicked is selected');
  for (const l of ['Undo', 'Duplicate', 'Bring to front', 'Send to back', 'Delete', 'Select all', 'Export PNG']) item(items, l);
  await choose(items, 'Duplicate');
  assert(count() > n0, `Duplicate added the shape (with its label): ${n0} → ${count()}`);
  log('drawing: shape menu');

  // ---- image editor ----
  const img = await open(join(dir, 'img', 'red.png'));
  const canvas = await waitFor(() => document.querySelector('.tabview.active canvas'), 'image canvas');
  await sleep(200);
  items = await rightClick(canvas);
  item(items, 'Transform', 'Rotate clockwise');
  item(items, 'Select all');
  await choose(items, 'Transform', 'Rotate clockwise');
  await waitFor(() => (img.dirty ? true : null), 'rotated from the menu');
  log('image editor: its commands');

  // ---- Markdown preview: selected text ----
  await open(join(dir, 'notes', 'index.md'));
  const p = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .preview p'), 'the preview');
  const range = document.createRange();
  range.selectNodeContents(p);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const want = window.getSelection()!.toString();
  items = await rightClick(p);
  assertEq(labels(items)[0], 'Copy', 'Copy first');
  await choose(items, 'Copy');
  assertEq(await ClipboardGetText(), want, 'copied from the preview');
  log('preview: copy');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
