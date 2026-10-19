// pdf.js setup: worker and offline resource locations.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// pdf_viewer.mjs reads the library from this global when it is evaluated.
(globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;

export { pdfjs };

// One worker for every document, started as soon as this module loads, so
// opening a PDF doesn't pay for worker start-up.
let shared: InstanceType<typeof pdfjs.PDFWorker> | null = null;
export function sharedWorker() {
  if (!shared || shared.destroyed) shared = new pdfjs.PDFWorker({ name: 'hia-pdf' as unknown as null });
  return shared;
}
sharedWorker();

export function openDocument(src: { url: string } | { data: Uint8Array }) {
  return pdfjs.getDocument({
    ...src,
    worker: sharedWorker(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    enableXfa: false,
    // Big range requests: fewer round trips through the webview.
    rangeChunkSize: 1 << 20,
    disableAutoFetch: false,
  });
}
