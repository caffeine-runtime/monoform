// M30: text recognition (offline Tesseract) — an image with printed text
// (drawn by the test) read in the image viewer, then only a selected part
// of it; a scanned PDF (made from such images, no text layer) read page by
// page and made searchable: the new text layer is found by pdf.js and by
// scripts/verify-pdf-ocr.sh (pdftotext).
import { api, saveFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';
import * as selection from '../modules/image/selection';

type Panel = { text: () => string; busy: () => boolean; error: () => string; confidence: () => number; rerun: () => Promise<void> };
const panel = () => (globalThis as unknown as { __ocrPanel?: Panel }).__ocrPanel;

export const LINES = ['Monoform reads text', 'Invoice 2026-0417 total 1,234.50', 'The quick brown fox jumps'];

/** A white page with printed lines, as a PNG blob. */
export async function textImage(lines: string[], w = 1400, lineH = 90): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = lineH * (lines.length + 1);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111';
  g.font = '48px "DejaVu Sans", Arial, sans-serif';
  lines.forEach((l, i) => g.fillText(l, 60, lineH * (i + 1)));
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

async function waitText(what: string): Promise<string> {
  await waitFor(() => panel(), `${what}: panel`);
  await waitFor(() => (!panel()!.busy() && (panel()!.text() || panel()!.error()) ? true : null), `${what}: recognised`, 60000).catch(async (e) => {
    throw new Error(`${e.message} (status: ${(panel() as any)?.status?.()}, busy ${panel()?.busy()})`);
  });
  assertEq(panel()!.error(), '', `${what}: no error`);
  return panel()!.text();
}

export default async function m30(dir: string) {
  const img = join(dir, 'ocr', 'scan.png');
  await api.CreateFolder(join(dir, 'ocr')).catch(() => {});
  await saveFile(img, await textImage(LINES));

  // ---- an image ----
  const t = (await workspace.openPath(img))!;
  assertEq(t.moduleId, 'image', 'image view');
  await waitFor(() => (t as any).imageTest?.editor()?.width === 1400, 'image loaded');
  const btn = await waitFor(() => document.querySelector<HTMLButtonElement>('.tabview.active button[aria-label="Recognise text"]'), 'OCR button');
  const started = performance.now();
  const { result: text, maxGap } = await measureJank(async () => {
    btn.click();
    return waitText('whole image');
  });
  log(`OCR of a 1400×360 image: ${Math.round(performance.now() - started)} ms (first run, incl. loading), longest frame ${Math.round(maxGap)} ms`);
  for (const l of LINES) assert(norm(text).includes(l), `recognised “${l}” in “${norm(text)}”`);
  assert(panel()!.confidence() > 80, `confidence ${panel()!.confidence()}`);

  // Only the selected line.
  const ed = (t as any).imageTest.editor();
  const r = { x: 0, y: 120, width: 1400, height: 85 };
  ed.setPixelSelection(selection.fromPath(selection.rectPath(r), r, ed.width, ed.height), 'replace');
  const textBtn = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.tabview.active .selbar button')].find((b) => b.textContent?.includes('Text')), 'selection Text button');
  textBtn.click();
  await sleep(50);
  const sel = norm(await waitText('selection'));
  assertEq(sel, LINES[1], 'only the selected line');
  await workspace.close(t, { force: true });

  // ---- a scanned PDF (two page images, no text) ----
  const img2 = join(dir, 'ocr', 'scan2.png');
  await saveFile(img2, await textImage(['Second page of the scan', 'Searchable after OCR']));
  const pdf = join(dir, 'ocr', 'scanned.pdf');
  await api.PdfFromImages([img, img2], pdf, 'image');
  const p = (await workspace.openPath(pdf))!;
  const ph = await waitFor(() => ((p as any).pdfTest?.doc() ? (p as any).pdfTest : null), 'pdf open');
  await waitFor(() => (ph.scanned() ? true : null), 'detected as a scan');
  await waitFor(() => document.querySelector('.tabview.active .banner.scanned'), 'scan banner');
  ph.openOcr('all');
  const all = norm(await waitText('all pages'));
  for (const l of [...LINES, 'Second page of the scan', 'Searchable after OCR']) assert(all.includes(l), `“${l}” in the PDF text`);
  assert(all.includes('— Page 2 —'), 'pages separated');
  const before = performance.now();
  await ph.makeSearchable(['eng']);
  await waitFor(() => (!ph.busy() && ph.working() !== pdf ? true : null), 'text layer added', 60000);
  log(`made 2 pages searchable in ${Math.round(performance.now() - before)} ms`);
  await waitFor(() => (!ph.scanned() && ph.doc() ? true : null), 'no longer a scan');
  ph.setQuery('Searchable after');
  await waitFor(() => (ph.matches()?.total === 1 ? true : null), 'found by search');
  assert(await ph.save(), 'saved');
  await workspace.close(p, { force: true });
}
