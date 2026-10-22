// Loads and diffs two files off the UI thread. Text stays here; the page asks
// for the lines it shows. Data files (JSON/YAML/CSV) also get a list of
// structural changes; images are diffed pixel by pixel; anything else is
// compared byte by byte (in 4 MB pieces, so huge files are fine).
import { parseAllDocuments } from 'yaml';
import { fetchBytes, PIECE } from '../../core/fetchbytes';
import { decode, detectEncoding } from '../text/encoding';
import { parseJson } from '../data/jsonparse';
import { contentEnd, detectDelimiter, detectHeader, indexRecords, parseRecord } from '../data/csv';
import { canonical, dataChanges, diff, hunks, ignoreWhitespace, intern, pixelDiff, rows, stats, tableChanges, type DataChange, type RowChange } from './diff';

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

let lines: [string[], string[]] = [[], []];

const looksBinary = (b: Uint8Array) => {
  const n = Math.min(b.length, 8192);
  for (let i = 0; i < n; i++) if (b[i] === 0) return true;
  return false;
};

function splitLines(t: string): string[] {
  const l = t.split(/\r\n|\n|\r/);
  if (l.length > 1 && l[l.length - 1] === '') l.pop();
  return l;
}

function parseData(text: string, ext: string): unknown {
  if (ext === 'yaml' || ext === 'yml') {
    const docs = parseAllDocuments(text);
    const list = (Array.isArray(docs) ? docs : [docs]).map((d) => {
      if (d.errors?.length) throw new Error(d.errors[0].message);
      return d.toJS();
    });
    return list.length === 1 ? list[0] : list;
  }
  const r = parseJson(text, true);
  if (!r.ok) throw new Error(`${r.error.message} (line ${r.error.line})`); // i18n-ignore: the worker has no catalog; the parser's message is English too
  return r.value;
}

function table(text: string, ext: string) {
  const delim = ext === 'tsv' || ext === 'tab' ? '\t' : detectDelimiter(text, ext);
  const idx = indexRecords(text);
  const all: string[][] = [];
  for (let k = 0; k < idx.count; k++) {
    const r = parseRecord(text, idx.starts[k], contentEnd(text, idx.starts[k], idx.starts[k + 1]), delim);
    if (r.length === 1 && r[0] === '' && k === idx.count - 1) continue;
    all.push(r);
  }
  return { delim, header: detectHeader(text, delim), rows: all };
}

interface TextReq {
  id: number;
  urls: [string, string];
  exts: [string, string];
  kind: 'text' | 'data' | 'csv';
  ignoreWs: boolean;
  normalize: boolean;
  keyCol: number;
}

async function load(url: string): Promise<{ bytes: Uint8Array; text: string | null; encoding: string }> {
  const bytes = await fetchBytes(url);
  if (looksBinary(bytes)) return { bytes, text: null, encoding: '' };
  const enc = detectEncoding(bytes);
  return { bytes, text: decode(bytes, enc), encoding: enc };
}

async function text(m: TextReq) {
  const [fa, fb] = await Promise.all(m.urls.map(load));
  if (fa.text === null || fb.text === null) return bytesResult(m.id, fa.bytes, fb.bytes);
  let ta = fa.text;
  let tb = fb.text;
  let changes: DataChange[] | undefined;
  let rowChanges: RowChange[] | undefined;
  let header: string[] | null = null;
  let parseError = '';
  if (m.kind === 'data') {
    try {
      const va = parseData(ta, m.exts[0]);
      const vb = parseData(tb, m.exts[1]);
      changes = dataChanges(va, vb);
      if (m.normalize) {
        ta = canonical(va);
        tb = canonical(vb);
      }
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  } else if (m.kind === 'csv') {
    const a = table(ta, m.exts[0]);
    const b = table(tb, m.exts[1]);
    header = a.header ? a.rows[0] : null;
    const ra = a.header ? a.rows.slice(1) : a.rows;
    const rb = b.header ? b.rows.slice(1) : b.rows;
    rowChanges = tableChanges(ra, rb, Math.max(0, m.keyCol), header);
  }
  lines = [splitLines(ta), splitLines(tb)];
  const ids = new Map<string, number>();
  const key = m.ignoreWs ? ignoreWhitespace : undefined;
  const t0 = performance.now();
  const e = diff(intern(lines[0], ids, key), intern(lines[1], ids, key), 4000);
  const r = rows(e);
  const longest = (l: string[]) => l.reduce((n, s) => (s.length > n ? s.length : n), 0);
  post(
    {
      id: m.id,
      ok: true,
      kind: 'text',
      rows: r,
      hunks: hunks(r),
      stats: stats(r),
      lineCounts: [lines[0].length, lines[1].length],
      widths: [Math.min(4000, longest(lines[0])), Math.min(4000, longest(lines[1]))],
      encodings: [fa.encoding, fb.encoding],
      sizes: [fa.bytes.length, fb.bytes.length],
      identicalBytes: equalBytes(fa.bytes, fb.bytes),
      changes,
      rowChanges,
      header,
      parseError,
      ms: Math.round(performance.now() - t0),
    },
    [r.buffer],
  );
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function bytesResult(id: number, a: Uint8Array, b: Uint8Array) {
  post({ id, ok: true, kind: 'binary', sizes: [a.length, b.length], firstDiff: firstDiff(a, b) });
}

/** Byte comparison in pieces, without holding both files in memory. */
async function bytes(id: number, urls: [string, string]) {
  const piece = async (url: string, off: number) => {
    const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + PIECE - 1}` } });
    if (r.status === 416) return { data: new Uint8Array(0), total: off };
    const total = Number(r.headers.get('Content-Range')?.split('/')[1] ?? NaN);
    return { data: new Uint8Array(await r.arrayBuffer()), total };
  };
  let off = 0;
  for (;;) {
    const [a, b] = await Promise.all(urls.map((u) => piece(u, off)));
    const sizes = [a.total, b.total];
    const d = firstDiff(a.data, b.data);
    if (d >= 0) return post({ id, ok: true, kind: 'binary', sizes, firstDiff: off + d });
    if (a.data.length < PIECE) return post({ id, ok: true, kind: 'binary', sizes, firstDiff: -1 });
    off += a.data.length;
    post({ type: 'progress', done: off, total: Math.max(a.total, b.total) });
  }
}

async function images(id: number, a: ImageBitmap, b: ImageBitmap, tol: number) {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const read = (bm: ImageBitmap) => {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bm, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const d = pixelDiff(read(a), read(b), w, h, tol);
  a.close();
  b.close();
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(new ImageData(d.mask as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const mask = c.transferToImageBitmap();
  post({ id, ok: true, kind: 'image', w, h, changed: d.changed, box: d.box, mask }, [mask]);
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'text':
        return await text(m);
      case 'bytes':
        return await bytes(m.id, m.urls);
      case 'image':
        return await images(m.id, m.a, m.b, m.tol);
      case 'lines': {
        const l = lines[m.side as 0 | 1];
        return post({ id: m.id, ok: true, lines: l.slice(Math.max(0, m.start), Math.min(l.length, m.end)).map((s: string) => (s.length > 4000 ? s.slice(0, 4000) + '…' : s)) });
      }
    }
  } catch (e) {
    post({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
