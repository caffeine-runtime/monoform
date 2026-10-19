// M3 acceptance (in-app part). Files written here are checked afterwards by
// scripts/verify-pdf.sh with qpdf and poppler (another PDF reader).
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { jobs } from '../core/jobs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  doc: () => any;
  viewer: () => any;
  pageOp: (op: any) => Promise<void>;
  save: () => Promise<boolean>;
  writeTo: (p: string) => Promise<boolean>;
  setQuery: (q: string) => void;
  matches: () => { current: number; total: number } | null;
  working: () => string;
}
const hooks = (t: Tab) => (t as unknown as { pdfTest: Hooks }).pdfTest;

async function openPdf(p: string) {
  const t0 = performance.now();
  const tab = (await workspace.openPath(p))!;
  assertEq(tab.moduleId, 'pdf', 'pdf module');
  try {
    await waitFor(() => hooks(tab)?.doc(), 'document loaded', 15000);
  } catch (e) {
    log(`pdf view says: ${document.querySelector('.tabview.active')?.textContent?.slice(0, 400)}`);
    throw e;
  }
  await waitFor(() => (tab as any).pdfFirstPageMs, 'first page rendered', 15000);
  return { tab, h: hooks(tab), openMs: performance.now() - t0 };
}

function pointer(el: Element, type: string, x: number, y: number) {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
}

export default async function m3(dir: string) {
  const out = join(dir, 'pdf', 'out');
  await api.CreateFolder(out).catch(() => {});

  // --- 100-page document: first page time, search, thumbnails ---
  const { tab: big, h: bh, openMs } = await openPdf(join(dir, 'pdf', 'hundred.pdf'));
  log(`cold phases ${JSON.stringify((big as any).pdfTimings, (_k, v) => (typeof v === 'number' ? Math.round(v) : v))}`);
  log(`100-page PDF: first page rendered ${Math.round((big as any).pdfFirstPageMs)} ms after load start (${Math.round(openMs)} ms incl. module load)`);
  assertEq(bh.doc().numPages, 100, 'page count');
  await waitFor(() => document.querySelectorAll('.tabview.active .thumb').length === 100, 'thumbnails listed');
  await waitFor(() => document.querySelector('.tabview.active .thumb canvas'), 'a thumbnail rendered');
  bh.setQuery('lazy dog');
  await waitFor(() => bh.matches()?.total === 100, 'search finds 100 matches', 20000);
  log('search: 100 matches');
  await workspace.close(big, { force: true });

  // Second open of a 100-page PDF (module already loaded) — the budget case.
  const again = await openPdf(join(dir, 'pdf', 'hundred.pdf'));
  log(`100-page PDF reopened: first page ${Math.round((again.tab as any).pdfFirstPageMs)} ms, phases ${JSON.stringify((again.tab as any).pdfTimings, (_k, v) => (typeof v === 'number' ? Math.round(v) : v))}`);
  await workspace.close(again.tab, { force: true });

  // --- annotations ---
  const { tab, h } = await openPdf(join(dir, 'pdf', 'three.pdf'));
  const viewer = h.viewer();
  const layerOf = async (n: number) => waitFor(() => document.querySelector(`.tabview.active .page[data-page-number="${n}"] .annotationEditorLayer`), `editor layer ${n}`);
  // Free text on page 1.
  viewer.annotationEditorMode = { mode: 3 };
  await sleep(150);
  const l1 = await layerOf(1);
  pointer(l1, 'pointerdown', 100, 300);
  pointer(l1, 'pointerup', 100, 300);
  l1.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: l1.getBoundingClientRect().left + 100, clientY: l1.getBoundingClientRect().top + 300 }));
  const box = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .freeTextEditor .internal'), 'free text editor');
  box.focus();
  document.execCommand('insertText', false, 'Reviewed by Hold It All');
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.blur();
  await sleep(150);
  // Ink on page 1.
  viewer.annotationEditorMode = { mode: 15 };
  await sleep(150);
  const l1b = await layerOf(1);
  pointer(l1b, 'pointerdown', 120, 420);
  for (let i = 1; i <= 12; i++) pointer(l1b, 'pointermove', 120 + i * 12, 420 + Math.sin(i / 2) * 20);
  pointer(l1b, 'pointerup', 264, 430);
  await sleep(150);
  // Highlight: select text in the text layer of page 2.
  viewer.annotationEditorMode = { mode: 9 };
  await sleep(150);
  const span = await waitFor(() => [...document.querySelectorAll('.tabview.active .page[data-page-number="2"] .textLayer span')].find((s) => s.textContent?.includes('quick brown')), 'text span');
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  document.dispatchEvent(new Event('selectionchange'));
  span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await sleep(300);
  viewer.annotationEditorMode = { mode: 0 };
  await sleep(150);
  const editors = document.querySelectorAll('.tabview.active .annotationEditorLayer > div').length;
  log(`editors on pages: ${editors}`);
  await waitFor(() => tab.dirty, 'dirty after annotating');
  const annotated = join(out, 'annotated.pdf');
  assert(await h.writeTo(annotated), 'saved annotated copy');
  assert(!tab.dirty, 'clean after save');
  await workspace.close(tab, { force: true });

  // --- forms ---
  const { tab: ft, h: fh } = await openPdf(join(dir, 'pdf', 'form.pdf'));
  const input = await waitFor(() => document.querySelector<HTMLInputElement>('.tabview.active .annotationLayer input[type=text], .tabview.active .annotationLayer textarea'), 'form text field');
  input.focus();
  input.value = 'Alice Example';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  const box2 = await waitFor(() => document.querySelector<HTMLInputElement>('.tabview.active .annotationLayer input[type=checkbox]'), 'checkbox');
  box2.click();
  await waitFor(() => ft.dirty, 'dirty after form fill');
  assert(await fh.writeTo(join(out, 'filled.pdf')), 'saved filled form');
  await workspace.close(ft, { force: true });

  // --- page operations on three.pdf (working copy, then save as) ---
  const { tab: ot, h: oh } = await openPdf(join(dir, 'pdf', 'three.pdf'));
  await oh.pageOp({ kind: 'reorder', order: [3, 1, 2] });
  assertEq(oh.doc().numPages, 3, 'reorder keeps count');
  assert(ot.dirty, 'dirty after reorder');
  await oh.pageOp({ kind: 'rotate', pages: [1], degrees: 90 });
  await oh.pageOp({ kind: 'merge', others: [join(dir, 'pdf', 'two.pdf')] });
  assertEq(oh.doc().numPages, 5, 'merge appends');
  await oh.pageOp({ kind: 'delete', pages: [5] });
  assertEq(oh.doc().numPages, 4, 'delete');
  const original = await api.Stat(join(dir, 'pdf', 'three.pdf'));
  assert(await oh.writeTo(join(out, 'reordered.pdf')), 'saved reordered');
  assertEq((await api.Stat(join(dir, 'pdf', 'three.pdf'))).size, original.size, 'original untouched by Save As');
  await workspace.close(ot, { force: true });

  // Extract + split.
  await api.PdfOp(join(dir, 'pdf', 'hundred.pdf'), join(out, 'extract.pdf'), { kind: 'extract', pages: [2, 50, 99], degrees: 0, order: [], others: [] });
  const splitDir = join(out, 'split');
  await api.CreateFolder(splitDir).catch(() => {});
  const done = await jobs.run<string[]>('split', () => api.PdfSplit(join(dir, 'pdf', 'hundred.pdf'), splitDir, 25));
  assertEq(done.result?.length, 4, 'split into 4 files');
}
