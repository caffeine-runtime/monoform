// M4b: Word and Excel files open, edit and save (checked afterwards with
// LibreOffice by scripts/verify-office.sh).
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const docH = (t: Tab) => (t as any).docTest;
const sheetH = (t: Tab) => (t as any).sheetTest;

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

function placeCaret(node: Node, offset: number) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

function selectText(el: Node, word: string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(word);
    if (i >= 0) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
  }
  return false;
}

export default async function m4b(dir: string) {
  // --- .docx ---
  const d = (await workspace.openPath(join(dir, 'office', 'report.docx')))!;
  assertEq(d.moduleId, 'doc', 'doc module');
  const page: HTMLElement = await waitFor(() => docH(d)?.page()?.querySelector('h1') && docH(d).page(), 'docx rendered');
  assertEq(page.querySelector('h1')!.textContent, 'Quarterly report', 'heading 1');
  assert(page.querySelector('b') && page.querySelector('i') && page.querySelector('u'), 'run formatting shown');
  assert(page.querySelectorAll('.li').length >= 2, 'list items');
  assertEq(page.querySelectorAll('td').length, 4, 'table cells');
  // Edit: change the last paragraph, bold a word, add a paragraph after it.
  const last = [...page.querySelectorAll('p')].find((p) => p.textContent === 'Last paragraph.')!;
  page.focus();
  const tn = last.querySelector('span')!.firstChild!;
  placeCaret(tn, tn.textContent!.length - 1);
  document.execCommand('insertText', false, ', edited in Hold It All');
  assert(selectText(last, 'edited'), 'select word');
  docH(d).exec('bold');
  const end = document.createRange();
  end.selectNodeContents(last);
  end.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(end);
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'A brand new paragraph.');
  page.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => d.dirty, 'docx dirty');
  // A table cell edit.
  const cell = page.querySelectorAll('td')[3];
  const ct = cell.querySelector('span')?.firstChild ?? cell.querySelector('p')!;
  placeCaret(ct, ct.textContent?.length ?? 0);
  document.execCommand('insertText', false, '+');
  assert(await docH(d).save(), 'docx saved');
  assert(!d.dirty, 'clean after save');
  await closeAll();
  // Reopen: content survived.
  const d2 = (await workspace.openPath(join(dir, 'office', 'report.docx')))!;
  const page2: HTMLElement = await waitFor(() => docH(d2)?.page()?.querySelector('h1') && docH(d2).page(), 'docx reopened');
  assert(page2.textContent!.includes('Last paragraph, edited in Hold It All.'), 'edit persisted');
  assert(page2.textContent!.includes('A brand new paragraph.'), 'new paragraph persisted');
  assert([...page2.querySelectorAll('b')].some((b) => b.textContent === 'edited'), 'bold persisted');
  assertEq(page2.querySelectorAll('td')[3].textContent, 'B2+', 'table cell edit persisted');
  await closeAll();

  // --- legacy .doc -> .docx ---
  const ld = (await workspace.openPath(join(dir, 'office', 'legacy.doc')))!;
  const lpage: HTMLElement = await waitFor(() => docH(ld)?.page()?.textContent?.includes('Quarterly report') && docH(ld).page(), '.doc text');
  assert(document.querySelector('.tabview.active .banner')?.textContent?.includes('.docx'), 'legacy note shown');
  const firstP = lpage.querySelector('p')!;
  placeCaret(firstP.querySelector('span')!.firstChild!, 0);
  document.execCommand('insertText', false, 'Converted: ');
  lpage.dispatchEvent(new Event('input', { bubbles: true }));
  assert(await docH(ld).writeTo(join(dir, 'office', 'legacy.docx'), true), '.doc saved as .docx');
  assertEq(ld.title, 'legacy.docx', 'tab now points at the .docx');
  await closeAll();

  // --- .xlsx ---
  const x = (await workspace.openPath(join(dir, 'office', 'budget.xlsx')))!;
  assertEq(x.moduleId, 'sheet', 'sheet module');
  const xh = await waitFor(() => (sheetH(x)?.book() ? sheetH(x) : null), 'workbook');
  assertEq(xh.book().sheets.map((s: any) => s.name).join(','), 'Budget,Notes', 'sheets');
  const rows = await xh.rows(0, 4);
  assertEq(rows[3][1], '1212.5', 'formula value');
  assertEq((await xh.cell(3, 1)).input, '=SUM(B2:B3)', 'formula shown in bar');
  await xh.edit(2, 1, '1300');
  await waitFor(async () => (await xh.rows(3, 4))[0][1] === '1312.5', 'SUM recalculated');
  await xh.edit(4, 0, 'Note');
  await xh.edit(4, 1, '=B4/2');
  await waitFor(async () => (await xh.rows(4, 5))[0][1] === '656.25', 'new formula computed');
  await sleep(50);
  await waitFor(() => document.querySelectorAll('.tabview.active .td').length > 20, 'grid rendered');
  assert([...document.querySelectorAll('.tabview.active .td')].some((e) => e.textContent === '1312.5'), 'grid shows recalculated value');
  await xh.switchSheet('Notes');
  assertEq((await xh.rows(0, 1))[0][0], 'Second sheet', 'second sheet');
  assert(await workspace.save(x), 'xlsx saved');
  await closeAll();

  // --- legacy .xls -> .xlsx ---
  const l = (await workspace.openPath(join(dir, 'office', 'legacy.xls')))!;
  const lh = await waitFor(() => (sheetH(l)?.book() ? sheetH(l) : null), 'xls workbook');
  assert(lh.book().saveAs.endsWith('legacy.xlsx'), 'saves as .xlsx');
  assertEq((await lh.rows(1, 2))[0][0], 'Café ☕', 'xls text');
  await lh.edit(1, 1, '99');
  assert(await lh.writeTo(join(dir, 'office', 'legacy.xlsx'), true), 'xls saved as xlsx');
  assertEq(l.title, 'legacy.xlsx', 'tab retargeted');
  await closeAll();
  log('office documents edited and saved');
}
