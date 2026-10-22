// M55: inserting into Word documents, in a new .docx. Ctrl+K makes a link
// from a selected word (example.com → https://example.com); a 3 × 2 table
// gets a row and a column more, one column less; a picture (img/red.png)
// and a page break go in; find and replace finds "cat" three times (one in
// another run) and replaces one, then all; formatted paste brings bold text
// and a bulleted list. Saved and reopened, the link, table shape, picture,
// page break, replacements, bold and list are all there.
import { api, fileUrl } from '../core/backend';
import { join } from '../core/paths';
import { ui } from '../core/ui.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  page: () => HTMLDivElement | undefined;
  writeTo: (path: string, retarget: boolean) => Promise<boolean>;
  editLink: () => Promise<void>;
  insertTable: (rows: number, cols: number) => void;
  tableOp: (op: string) => void;
  insertPageBreak: () => void;
  addPicture: (b: Blob, ext: string) => Promise<void>;
  openFind: (replace?: boolean) => void;
  setFind: (q: string, r?: string) => void;
  findState: () => { findQ: string; replaceQ: string; matches: number; matchAt: number };
  showMatch: (i: number) => void;
  replaceOne: () => void;
  replaceEvery: () => void;
  paste: (e: ClipboardEvent) => void;
}
const hooks = (t: Tab) => (t as unknown as { docTest?: Hooks }).docTest;

async function open(path: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(path))!;
  const h = await waitFor(() => hooks(tab), 'document editor');
  const page = await waitFor(() => (h.page()?.querySelector('[data-p]') ? h.page()! : null), 'document rendered');
  return { tab, h, page };
}

function select(page: HTMLElement, word: string, collapseEnd = false) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + word.length);
    if (collapseEnd) r.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return;
  }
  throw new Error(`no "${word}"`);
}

function type(page: HTMLElement, ...lines: string[]) {
  lines.forEach((l, i) => {
    if (i) document.execCommand('insertParagraph');
    document.execCommand('insertText', false, l);
  });
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

const tableShape = (page: HTMLElement) => Array.from(page.querySelector('table')?.rows ?? []).map((r) => r.cells.length).join(',');

export default async function m55(dir: string) {
  await api.CreateFolder(join(dir, 'office', 'out')).catch(() => {});
  const path = join(dir, 'office', 'out', `insert-${Date.now()}.docx`);
  await api.CreateFromTemplate(path, 'docx', { width: 0, height: 0, background: '' });
  let { h, page } = await open(path);
  const first = page.querySelector<HTMLElement>('[data-p]')!;
  const r = document.createRange();
  r.selectNodeContents(first);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  type(page, 'Visit example now', 'A cat sat. Another ca', 'The end');
  // A second run in the middle of "cat": "ca" + bold "t".
  select(page, 'Another ca', true);
  document.execCommand('bold');
  document.execCommand('insertText', false, 't');
  document.execCommand('bold');
  document.execCommand('insertText', false, ' and a cat.');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));

  // ---- link ----
  select(page, 'example');
  const asked = h.editLink();
  const d = await waitFor(() => ui.dialog, 'the link dialog');
  assertEq(d.title, 'Insert link', d.title);
  d.resolve({ button: 'ok', value: 'example.com' });
  await asked;
  const a = await waitFor(() => page.querySelector<HTMLAnchorElement>('a[data-new-href]'), 'a link');
  assertEq(`${a.textContent} → ${a.dataset.newHref}`, 'example → https://example.com', 'linked, https:// added');

  // ---- table ----
  select(page, 'The end');
  h.insertTable(2, 3);
  assertEq(tableShape(page), '3,3', 'a 3 × 2 table');
  h.tableOp('rowBelow');
  h.tableOp('colRight');
  assertEq(tableShape(page), '4,4,4', 'a row and a column more');
  h.tableOp('delCol');
  assertEq(tableShape(page), '3,3,3', 'a column less');
  document.execCommand('insertText', false, 'Cell');

  // ---- resize: drag the first column's right border 60 px right, the first row's bottom 30 px down ----
  const table = page.querySelector('table')!;
  const td = table.rows[0].cells[0];
  const pt = (type: string, x: number, y: number, el: Element) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true }));
  const drag = (x: number, y: number, dx: number, dy: number) => {
    pt('pointermove', x, y, td);
    pt('pointerdown', x, y, td);
    pt('pointermove', x + dx, y + dy, page);
    pt('pointerup', x + dx, y + dy, page);
  };
  const w0 = td.getBoundingClientRect().width;
  const w1 = table.rows[0].cells[1].getBoundingClientRect().width;
  let box = td.getBoundingClientRect();
  drag(box.right - 1, box.top + box.height / 2, 60, 0);
  assert(Math.abs(td.getBoundingClientRect().width - (w0 + 60)) < 3, `first column wider (${w0} → ${td.getBoundingClientRect().width})`);
  assert(Math.abs(table.rows[0].cells[1].getBoundingClientRect().width - (w1 - 60)) < 3, 'the next one narrower');
  box = td.getBoundingClientRect();
  const h0 = table.rows[0].getBoundingClientRect().height;
  drag(box.left + box.width / 2, box.bottom - 1, 0, 30);
  assert(table.rows[0].getBoundingClientRect().height >= h0 + 28, `first row taller (${h0} → ${table.rows[0].getBoundingClientRect().height})`);
  const widths = Array.from(table.rows[0].cells).map((c) => Math.round(c.getBoundingClientRect().width));
  const rowH = Math.round(table.rows[0].getBoundingClientRect().height);

  // ---- picture and page break ----
  select(page, 'The end', true);
  await h.addPicture(await (await fetch(fileUrl(join(dir, 'img', 'red.png')))).blob(), 'png');
  assert(page.querySelector('.atom img'), 'the picture is in');
  h.insertPageBreak();
  assert(Array.from(page.querySelectorAll('.atom')).some((e) => e.textContent?.includes('page break')), 'a page break');

  // ---- find and replace ----
  h.openFind(true);
  await sleep(50);
  h.setFind('cat', 'dog');
  assertEq(h.findState().matches, 3, 'three cats (one across two runs)');
  h.showMatch(1);
  assertEq(window.getSelection()!.toString(), 'cat', 'the second one selected');
  h.replaceOne();
  assertEq(h.findState().matches, 2, 'one replaced');
  h.replaceEvery();
  assertEq(h.findState().matches, 0, 'all replaced');
  assert(page.textContent!.includes('A dog sat. Another dog and a dog.'), page.textContent!);
  log('link, table rows/columns, picture, page break, find and replace');

  // ---- formatted paste ----
  select(page, 'Visit', true);
  document.execCommand('insertParagraph');
  const dt = new DataTransfer();
  dt.setData('text/html', '<p>Pasted <b>bold</b> text</p><ul><li>Bullet one</li><li>Bullet two</li></ul>');
  dt.setData('text/plain', 'Pasted bold text\nBullet one\nBullet two');
  h.paste(new ClipboardEvent('paste', { clipboardData: dt, cancelable: true }));
  await sleep(50);
  assert(Array.from(page.querySelectorAll('b')).some((b) => b.textContent === 'bold'), 'bold kept');
  const bullets = () => Array.from(page.querySelectorAll<HTMLElement>('.li')).map((p) => `${p.dataset.marker}${p.textContent?.trim()}`);
  assertEq(bullets().join(' | '), '•Bullet one | •Bullet two', 'pasted list');

  // ---- saved and reopened ----
  assert(await h.writeTo(path, false), 'saved');
  ({ h, page } = await open(path));
  const link = page.querySelector<HTMLAnchorElement>('a[data-href]');
  assertEq(`${link?.textContent} → ${link?.dataset.href}`, 'example → https://example.com', 'the link survives');
  assertEq(tableShape(page), '3,3,3', 'the table survives');
  const t2 = page.querySelector('table')!;
  const w2 = Array.from(t2.rows[0].cells).map((c) => Math.round(c.getBoundingClientRect().width));
  assert(w2.every((w, i) => Math.abs(w - widths[i]) <= 2), `column widths survive (${widths} → ${w2})`);
  assert(Math.abs(Math.round(t2.rows[0].getBoundingClientRect().height) - rowH) <= 2, 'the row height survives');
  assert(page.querySelector('table')!.textContent!.includes('Cell'), 'with its text');
  const img = await waitFor(() => page.querySelector<HTMLImageElement>('.atom img'), 'the picture survives');
  await waitFor(() => (img.complete && img.naturalWidth > 0 ? true : null), 'the picture loads from the saved file');
  assert(Array.from(page.querySelectorAll('.atom')).some((e) => e.textContent?.includes('page break')), 'the page break survives');
  assert(page.textContent!.includes('A dog sat. Another dog and a dog.'), 'the replacements survive');
  assertEq(bullets().join(' | '), '•Bullet one | •Bullet two', 'the pasted list survives');
  assert(Array.from(page.querySelectorAll('b')).some((b) => b.textContent === 'bold'), 'pasted bold survives');
  log('all of it saved and reopened');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
