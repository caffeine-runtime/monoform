// PDF tools that don't need an open PDF view: build a PDF from images, and
// page rendering shared by "export pages as images" and redaction. Loaded on
// demand (the "Create PDF from images…" command imports it).
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api, fileUrl, saveFile } from '../../core/backend';
import { dirname, extname, join, stem } from '../../core/paths';
import { workspace } from '../../core/tabs.svelte';
import { toastError, ui } from '../../core/ui.svelte';

const DIRECT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp'];
export const IMAGE_PATTERNS = '*.png;*.jpg;*.jpeg;*.webp;*.tif;*.tiff;*.gif;*.bmp;*.avif;*.svg';

/** Paths pdfcpu can import: other formats (GIF, BMP, AVIF, SVG…) go through a canvas to a temp PNG. */
export async function importable(paths: string[]): Promise<{ files: string[]; temps: string[] }> {
  const files: string[] = [];
  const temps: string[] = [];
  for (const p of paths) {
    if (DIRECT.includes(extname(p))) {
      files.push(p);
      continue;
    }
    const img = new Image();
    img.src = fileUrl(p);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1000;
    c.height = img.naturalHeight || 1000;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed'))), 'image/png'));
    const tmp = await api.TempPath(`${stem(p)}.png`);
    await saveFile(tmp, blob);
    files.push(tmp);
    temps.push(tmp);
  }
  return { files, temps };
}

export async function pickPageSize(): Promise<string | null> {
  return ui.pick('Page size', [
    { id: 'image', label: 'Same as each image' },
    { id: 'A4', label: 'A4 (images fitted)' },
    { id: 'Letter', label: 'US Letter (images fitted)' },
  ]);
}

/** Build a PDF from images at dst. */
export async function buildFromImages(paths: string[], dst: string, size: string): Promise<string> {
  const { files, temps } = await importable(paths);
  try {
    return await api.PdfFromImages(files, dst, size);
  } finally {
    for (const t of temps) void api.RemoveTemp(t);
  }
}

/** "Create PDF from images…": pick images (in the order chosen, else by name), a page size and where to save. */
export async function imagesToPdf(preset?: string[]) {
  const picked = preset ?? (await api.OpenFilesDialog('Images to put in a PDF (one per page)', [{ name: 'Images', patterns: IMAGE_PATTERNS }]));
  if (!picked?.length) return;
  const paths = preset ? picked : [...picked].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const size = await pickPageSize();
  if (!size) return;
  const def = join(dirname(paths[0]), `${paths.length === 1 ? stem(paths[0]) : 'Images'}.pdf`);
  let dst = await api.SaveFileDialog('Save PDF as', def, [{ name: 'PDF', patterns: '*.pdf' }]);
  if (!dst) return;
  if (extname(dst) !== 'pdf') dst += '.pdf';
  try {
    const out = await buildFromImages(paths, dst, size);
    ui.toast(`Created a ${paths.length}-page PDF`, 'success', { label: 'Open', run: () => void workspace.openPath(out) });
    return out;
  } catch (e) {
    toastError(e, 'Couldn’t create the PDF');
  }
}

/** Render one page to a canvas. rotation: undefined = as displayed, 0 = unrotated user space. */
export async function renderPage(doc: PDFDocumentProxy, n: number, scale: number, rotation?: number, white = true): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale, ...(rotation !== undefined ? { rotation } : {}) });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d')!;
  if (white) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp } as never).promise;
  return c;
}

/** Scale for a resolution, capped so a page stays under ~40 megapixels. */
export function scaleFor(dpi: number, wPt: number, hPt: number): number {
  const s = dpi / 72;
  const max = Math.sqrt(40e6 / Math.max(1, wPt * hPt));
  return Math.min(s, max);
}

export const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed'))), type, q));
