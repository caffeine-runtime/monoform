// M21: PDF tools — images → PDF (incl. a GIF converted on the way), compress,
// sign (drawn signature placed on a page shown rotated 90°, must come out
// upright), redact every match of a search (content really removed), export
// pages as images, add images as pages, save.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const hooks = (t: Tab) => (t as unknown as { pdfTest?: Hooks }).pdfTest;

async function open(path: string) {
  const tab = (await workspace.openPath(path))!;
  await waitFor(() => hooks(tab)?.doc(), `${path} loaded`, 15000);
  await waitFor(() => (tab as any).pdfFirstPageMs, 'first page rendered', 15000);
  return { tab, h: hooks(tab)! };
}

async function pageText(doc: any, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  return tc.items.map((i: any) => i.str).join('');
}

export default async function m21(dir: string) {
  const out = join(dir, 'pdf', 'out21');
  await api.CreateFolder(out).catch(() => {});
  const tools = await import('../modules/pdf/tools');

  // ---- images → PDF ----
  const imgs = ['photo.png', 'subject.png', 'anim.gif', 'big.png'].map((f) => join(dir, 'img', f));
  const fromImages = join(out, 'images.pdf');
  const t0 = performance.now();
  await tools.buildFromImages(imgs, fromImages, 'image');
  assertEq(await api.PdfPageCount(fromImages), 4, 'one page per image (GIF converted)');
  const a4 = join(out, 'images-a4.pdf');
  await tools.buildFromImages(imgs.slice(0, 2), a4, 'A4');
  assertEq(await api.PdfPageCount(a4), 2, 'A4 pages');
  log(`images → PDF in ${Math.round(performance.now() - t0)} ms`);

  // ---- compress ----
  const c = await open(fromImages);
  const r = await c.h.compressWith(60, 800);
  log(`compress: ${r.before} → ${r.after} bytes, ${r.recompressed}/${r.images} images recompressed`);
  assert(r.after < r.before * 0.6, 'compressed to under 60 %');
  assert(r.recompressed >= 1, 'images recompressed');
  await waitFor(() => (c.h.doc()?.numPages === 4 ? true : null), 'compressed PDF shown');
  await workspace.close(c.tab, { force: true });

  // ---- sign + redact on a document with a rotated page ----
  const { tab, h } = await open(join(dir, 'pdf', 'tools.pdf'));
  assertEq(h.doc().getPage ? (await h.doc().getPage(2)).rotate : 90, 90, 'page 2 is rotated');
  // Draw a wide signature in the pad.
  settings.update((s) => (s.signatures = []));
  h.startSign();
  await waitFor(() => (globalThis as any).__sigPad, 'signature pad');
  const pad = (globalThis as any).__sigPad;
  pad.drawLine([
    [0.1, 0.6],
    [0.25, 0.3],
    [0.4, 0.7],
    [0.55, 0.35],
    [0.7, 0.65],
    [0.9, 0.4],
  ]);
  await sleep(30);
  pad.use();
  await waitFor(() => (!h.signOpen() ? true : null), 'pad closed');
  assertEq(settings.value.signatures.length, 1, 'signature remembered');
  // Click on page 2 (lower part, away from the text) to place it.
  const page2 = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .page[data-page-number="2"]'), 'page 2 element');
  page2.scrollIntoView();
  await sleep(100);
  const catcher = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .catcher'), 'placing layer');
  const pr = page2.getBoundingClientRect();
  catcher.dispatchEvent(new PointerEvent('pointerdown', { clientX: pr.left + pr.width * 0.5, clientY: pr.top + pr.height * 0.75, button: 0, buttons: 1, bubbles: true, pointerId: 4 }));
  await waitFor(() => (h.marks().length === 1 ? true : null), 'signature placed');
  const sig = h.marks()[0];
  assertEq(sig.page, 2, 'on page 2');
  assert(sig.w > sig.h, 'placed wide (as drawn)');
  // Redact "quick brown" everywhere, then keep only pages 1 and 3.
  h.setQuery('quick brown');
  await waitFor(() => (h.matches()?.total === 3 ? true : null), 'search finds 3');
  await h.redactMatches();
  assertEq(h.marks().filter((m: any) => m.kind === 'redact').length, 3, 'a box per match');
  h.setMarks(h.marks().filter((m: any) => m.kind === 'sign' || m.page !== 2));
  const confirm = ui.confirm;
  ui.confirm = async () => true;
  let applied = false;
  const aj = await measureJank(async () => {
    applied = await h.applyMarks();
  });
  ui.confirm = confirm;
  assert(applied, 'applied');
  log(`apply 2 redactions + 1 signature: longest UI frame ${Math.round(aj.maxGap)} ms`);
  assertEq(h.marks().length, 0, 'nothing pending');
  assert(tab.dirty, 'dirty until saved');
  const doc = h.doc();
  assertEq(doc.numPages, 3, 'still 3 pages');
  assertEq(await pageText(doc, 1), '', 'page 1 text removed');
  assertEq(await pageText(doc, 3), '', 'page 3 text removed');
  assert((await pageText(doc, 2)).includes('quick brown fox'), 'page 2 text kept');
  // The signature is an image on page 2, upright as displayed.
  const p2 = await doc.getPage(2);
  const ops = await p2.getOperatorList();
  const { pdfjs } = await import('../modules/pdf/pdfjs');
  assert(ops.fnArray.includes(pdfjs.OPS.paintImageXObject), 'signature image drawn on page 2');
  const shown = await tools.renderPage(doc, 2, 1);
  const ctx = shown.getContext('2d')!;
  const rx = Math.round(sig.x * shown.width);
  const ry = Math.round(sig.y * shown.height);
  const rw = Math.round(sig.w * shown.width);
  const rh = Math.round(sig.h * shown.height);
  const px = ctx.getImageData(rx, ry, rw, rh).data;
  let x0 = rw;
  let x1 = -1;
  let y0 = rh;
  let y1 = -1;
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] < 300) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  assert(x1 > x0 && y1 > y0, 'ink found where the signature was placed');
  assert(x1 - x0 > 1.6 * (y1 - y0), `signature upright on the rotated page (ink ${x1 - x0}×${y1 - y0})`);

  // ---- export pages, add images, save ----
  const imgDir = join(out, 'pages');
  await api.CreateFolder(imgDir).catch(() => {});
  await h.exportTo(imgDir, 72);
  for (const n of [1, 2, 3]) assert((await api.Stat(join(imgDir, `p${n}.png`))).size > 1000, `page ${n} exported`);
  await h.insertImages([join(dir, 'img', 'photo.png')], 'A4');
  await waitFor(() => (h.doc()?.numPages === 4 ? true : null), 'image added as page 4');
  const saved = join(out, 'tools-done.pdf');
  assert(await h.writeTo(saved), 'saved');
  assertEq(await api.PdfPageCount(saved), 4, 'saved file has 4 pages');
  assert(!tab.dirty, 'clean after save');
  await workspace.close(tab, { force: true });
}
