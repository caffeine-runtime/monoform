// Text recognition with Tesseract (tesseract.js, WASM) — entirely offline:
// the worker, core and English model ship with the app, other languages are
// files the user adds (served by Go). One worker is shared and kept for a
// minute and a half after the last job, then freed.
import type { Worker as TessWorker } from 'tesseract.js';
import { sessionToken } from '../../core/backend';

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLine {
  text: string;
  conf: number;
  bbox: OcrBox;
  words: { text: string; conf: number; bbox: OcrBox }[];
}

export interface OcrResult {
  text: string;
  confidence: number;
  lines: OcrLine[];
  /** A one-page PDF with the text only (invisible), when asked for. */
  pdf?: Uint8Array;
}

export interface OcrOptions {
  langs: string[];
  /** Also make a text-only PDF page; dpi is the image's resolution, so the page gets the original's size. */
  pdf?: { dpi: number };
}

export type OcrProgress = (status: string, progress: number) => void;

let worker: TessWorker | null = null;
let workerLangs = '';
let listener: OcrProgress | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Starting…',
  'initializing tesseract': 'Starting…',
  'loading language traineddata': 'Loading language data…',
  'initializing api': 'Starting…',
  'recognizing text': 'Recognising text…',
};

async function ensure(langs: string[]): Promise<TessWorker> {
  const key = langs.join('+');
  if (worker && key === workerLangs) return worker;
  if (worker) await worker.terminate().catch(() => {});
  worker = null;
  if (typeof WebAssembly !== 'object' || !WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))) {
    throw new Error('Text recognition needs WebAssembly SIMD, which this system’s web view doesn’t support.');
  }
  const { createWorker } = await import('tesseract.js');
  worker = await createWorker(langs, 1 /* LSTM only */, {
    workerPath: `${location.origin}/tesseract/worker.min.js`,
    corePath: `${location.origin}/tesseract/tesseract-core-simd-lstm.wasm.js`,
    // The worker appends "/<lang>.traineddata.gz", which lands in f=.
    langPath: `${location.origin}/__hia/tessdata?t=${encodeURIComponent(sessionToken())}&f=`,
    cacheMethod: 'none',
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => listener?.(STATUS[m.status] ?? m.status, m.progress),
  });
  await worker.setParameters({ preserve_interword_spaces: '1' });
  workerLangs = key;
  return worker;
}

/**
 * The part of a canvas to read, on white with a margin (Tesseract reads tight
 * crops badly), enlarged when small.
 */
export function cropForOcr(src: HTMLCanvasElement, r: { left: number; top: number; width: number; height: number }): HTMLCanvasElement {
  const pad = 24;
  const scale = r.height < 60 || r.width < 60 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(r.width * scale) + pad * 2;
  c.height = Math.round(r.height * scale) + pad * 2;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, r.left, r.top, r.width, r.height, pad, pad, r.width * scale, r.height * scale);
  return c;
}

/** Recognise the text in an image (jobs run one at a time). */
export function recognize(image: HTMLCanvasElement | Blob | ImageData, opts: OcrOptions, onProgress?: OcrProgress): Promise<OcrResult> {
  const job = async (): Promise<OcrResult> => {
    clearTimeout(idle);
    // Tesseract never finishes on an empty picture.
    const size = image instanceof HTMLCanvasElement || image instanceof ImageData ? image.width * image.height : image.size;
    if (!size) throw new Error('There is no picture to read yet.');
    try {
      const w = await ensure(opts.langs.length ? opts.langs : ['eng']);
      listener = onProgress ?? null;
      await w.setParameters({ user_defined_dpi: String(Math.round(opts.pdf?.dpi ?? 300)) });
      const r = await w.recognize(image as never, { pdfTextOnly: true, pdfTitle: 'OCR' }, { text: true, blocks: true, pdf: !!opts.pdf });
      const d = r.data as unknown as { text: string; confidence: number; blocks: { paragraphs: { lines: { text: string; confidence: number; bbox: OcrBox; words: { text: string; confidence: number; bbox: OcrBox }[] }[] }[] }[] | null; pdf: number[] | Uint8Array | null };
      const lines: OcrLine[] = [];
      for (const b of d.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.replace(/\n$/, ''), conf: l.confidence, bbox: l.bbox, words: l.words.map((w) => ({ text: w.text, conf: w.confidence, bbox: w.bbox })) });
      return { text: d.text.replace(/\n+$/, ''), confidence: d.confidence, lines, pdf: d.pdf ? Uint8Array.from(d.pdf) : undefined };
    } finally {
      listener = null;
      idle = setTimeout(() => {
        void worker?.terminate();
        worker = null;
        workerLangs = '';
      }, 90_000);
    }
  };
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
}

/** Free the worker now (tests, tab close). */
export async function release() {
  clearTimeout(idle);
  await worker?.terminate().catch(() => {});
  worker = null;
  workerLangs = '';
}
