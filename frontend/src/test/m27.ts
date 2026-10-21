// M27: OpenDocument text and spreadsheets (files made by LibreOffice) —
// .odt: headings, named and automatic text styles, lists (bullets, nesting,
// numbering), a table, a picture, a footnote, a field and a section shown;
// a paragraph edited and partly bolded, a numbered item added with Enter, a
// table cell edited; saved into the .odt with everything else kept. .ods:
// currency/date/percentage display, formulas, a recalculated total, saved as
// .ods. scripts/verify-odf.sh then checks both with LibreOffice.
import { endpoint } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, waitFor } from './harness';

const docH = (t: Tab) => (t as any).docTest;
const sheetH = (t: Tab) => (t as any).sheetTest;

function caretAtEnd(el: Node) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
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
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(r);
      return true;
    }
  }
  return false;
}

async function openOdt(path: string) {
  const t = (await workspace.openPath(path))!;
  assertEq(t.moduleId, 'doc', '.odt opens in the document editor');
  const page: HTMLElement = await waitFor(() => docH(t)?.page()?.querySelector('h1') && docH(t).page(), '.odt rendered');
  return { t, page };
}

const para = (page: HTMLElement, text: string) => [...page.querySelectorAll<HTMLElement>('p,h1,h2')].find((p) => p.textContent === text);

export default async function m27(dir: string) {
  const odtPath = join(dir, 'office', 'notes.odt');
  const { t, page } = await openOdt(odtPath);
  assertEq(t.status?.type, 'OpenDocument text', 'status');
  assertEq(page.querySelector('h1')!.textContent, 'Quarterly report', 'heading 1');
  assertEq(page.querySelector('h2')!.textContent, 'Details', 'heading 2');
  assertEq([...page.querySelectorAll('b')].map((b) => b.textContent).join(','), 'first', 'named "Strong" style shows bold');
  assert([...page.querySelectorAll('i')].some((e) => e.textContent === 'italic') && [...page.querySelectorAll('u')].some((e) => e.textContent === 'underlined blue'), 'automatic text styles');
  const items = [...page.querySelectorAll<HTMLElement>('.li')];
  assertEq(items.map((e) => e.textContent).join('|'), 'First point|Second point — zażółć|Nested point|Step one|Step two', 'list items');
  assertEq(items[2].style.marginLeft, '24px', 'nested item indented');
  assertEq(items.filter((e) => e.classList.contains('num')).map((e) => e.dataset.n).join(','), '1.,2.', 'numbered list');
  assertEq(page.querySelectorAll('td').length, 4, 'table');
  assert(page.querySelector('.atom img'), 'picture');
  assert(page.querySelector('.atom.note')?.getAttribute('title')?.includes('A footnote.'), 'footnote');
  assert(page.querySelector('.atom.field'), 'date field');
  assert(page.querySelector('.opaque')?.textContent?.includes('Inside a section.'), 'section kept read-only');
  assert(page.textContent!.includes('two  spaces'), 'runs of spaces');
  assert(page.querySelector('.atom.tab'), 'tab');

  // Edit the last paragraph and bold a word.
  const last = para(page, 'Last paragraph.')!;
  page.focus();
  const tn = last.querySelector('span')!.firstChild!;
  const r = document.createRange();
  r.setStart(tn, tn.textContent!.length - 1);
  r.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  document.execCommand('insertText', false, ', edited in Monoform');
  assert(selectText(last, 'edited'), 'select word');
  docH(t).exec('bold');
  // A new numbered item after "Step two".
  caretAtEnd(para(page, 'Step two')!);
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'Step three');
  // A table cell.
  caretAtEnd(page.querySelectorAll('td')[3].querySelector('p')!);
  document.execCommand('insertText', false, '+');
  page.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => t.dirty, 'dirty');
  assert(await docH(t).save(), 'saved');
  assertEq(t.title, 'notes.odt', 'still an .odt');
  await workspace.close(t, { force: true });

  const content = await (await fetch(endpoint('zip', { path: odtPath, entry: 'content.xml' }))).text();
  assert(/<text:span text:style-name="T\d+">edited<\/text:span>/.test(content), 'bold written as an automatic style');
  assert(content.includes('<text:note ') && content.includes('<draw:frame') && content.includes('<text:section') && content.includes('<text:date'), 'note, picture, section and field kept');
  assert(content.includes('<text:sequence-decls>'), 'declarations kept');
  const ids = [...content.matchAll(/xml:id="([^"]+)"/g)].map((m) => m[1]);
  assertEq(new Set(ids).size, ids.length, 'no duplicated xml:id');

  const again = await openOdt(odtPath);
  const p2 = again.page;
  assert(p2.textContent!.includes('Last paragraph, edited in Monoform.'), 'edit persisted');
  assert([...p2.querySelectorAll('b')].some((b) => b.textContent === 'edited'), 'bold persisted');
  const num = [...p2.querySelectorAll<HTMLElement>('.li.num')];
  assertEq(num.map((e) => `${e.dataset.n} ${e.textContent}`).join('|'), '1. Step one|2. Step two|3. Step three', 'new item in the numbered list');
  assertEq(p2.querySelectorAll('td')[3].textContent, 'B2+', 'table cell');
  assert(p2.querySelector('.atom img') && p2.querySelector('.atom.note') && p2.querySelector('.opaque'), 'picture, note and section after saving');
  assertEq(p2.querySelectorAll('.li').length, 6, 'list items');
  await workspace.close(again.t, { force: true });

  // ---- .ods ----
  const odsPath = join(dir, 'office', 'budget.ods');
  const x = (await workspace.openPath(odsPath))!;
  assertEq(x.moduleId, 'sheet', '.ods opens in the spreadsheet');
  const xh = await waitFor(() => (sheetH(x)?.book() ? sheetH(x) : null), 'workbook');
  assertEq(xh.book().sheets.map((s: any) => s.name).join(','), 'Budget,Notes', 'sheets');
  await waitFor(() => x.status?.type === 'OpenDocument spreadsheet', 'status');
  const rows = await xh.rows(0, 6);
  assertEq(`${rows[1][1]} ${rows[1][2]} ${rows[1][3]}`, '12.50 € 2026-10-19 1%', 'currency, date and percentage as LibreOffice shows them');
  assertEq((await xh.cell(3, 1)).input, '=SUM(B2:B3)', 'formula in the bar');
  assertEq((await xh.cell(4, 2)).input, '=Notes!B2*2', 'cross-sheet formula');
  await xh.edit(2, 1, '1300');
  await waitFor(async () => (await xh.rows(3, 4))[0][1] === '1312.5', 'total recalculated');
  assert(await workspace.save(x), 'saved');
  assertEq(x.title, 'budget.ods', 'still an .ods');
  await workspace.close(x, { force: true });
  const x2 = (await workspace.openPath(odsPath))!;
  const xh2 = await waitFor(() => (sheetH(x2)?.book() ? sheetH(x2) : null), 'reopened');
  const rows2 = await xh2.rows(0, 4);
  assertEq(`${rows2[2][1]} ${rows2[3][1]} ${rows2[0][0]}`, '1300 1312.5 Item', 'edits persisted');
  assertEq((await xh2.cell(3, 1)).input, '=SUM(B2:B3)', 'formula persisted');
  await workspace.close(x2, { force: true });
  log('OpenDocument files edited and saved');
}
