// Owns a CSV/TSV document: decodes, indexes records, serves row windows,
// sorts, filters, applies edits and saves. The main thread only ever holds the
// rows currently on screen, so a 1M-row file stays responsive.
import { fetchBytes } from '../../core/fetchbytes';
import { uploadParts } from '../../core/upload';
import { classifyEol, countEol, decode, detectEncoding, encode, hasUtf16Bom, type Encoding } from '../text/encoding';
import { contentEnd, detectDelimiter, detectHeader, fieldAt, indexRecords, parseRecord, serializeRecord, toNumber } from './csv';
import { addStats, completeFrom, emptyStats, type CellChange, type Range } from './gridOps';

let text = '';
let starts: Float64Array = new Float64Array(1);
let count = 0;
let delim = ',';
let header = true;
let encoding: Encoding = 'utf-8';
let bom = false;
let eol = '\n';
let columns: string[] = [];
let edits = new Map<number, string[]>(); // record index -> fields
let added: number[] = []; // record indices >= count, in order
let deleted = new Set<number>();
let nextAdded = 0;
let view = new Int32Array(0); // view row -> record index
let sortCol = -1;
let sortDir: 1 | -1 = 1;
let filter = '';
let sortKeys: { col: number; nums: Float64Array | null; strs: string[] | null } | null = null;

// Undo log in record terms (not view rows), so it survives sorting/filtering.
interface FieldChange {
  k: number;
  col: number;
  old: string;
  now: string;
}
interface UndoEntry {
  fields: FieldChange[];
  created: number[]; // records added by this step (paste past the end, insert row)
  removed: number[]; // records deleted by this step
}
let undoLog: UndoEntry[] = [];
let redoLog: UndoEntry[] = [];
const completions = new Map<number, string[]>(); // column -> distinct text values (AutoComplete)

function post(m: unknown) {
  (self as unknown as Worker).postMessage(m);
}

function record(k: number): string[] {
  const e = edits.get(k);
  if (e) return e;
  if (k >= count) return [];
  return parseRecord(text, starts[k], contentEnd(text, starts[k], starts[k + 1]), delim);
}

function rawRecord(k: number): string {
  const e = edits.get(k);
  if (e) return e.join('\u0001');
  if (k >= count) return '';
  return text.slice(starts[k], contentEnd(text, starts[k], starts[k + 1]));
}

function computeColumns() {
  let n = 0;
  const sample = Math.min(count, 2000);
  for (let k = 0; k < sample; k++) n = Math.max(n, record(k).length);
  if (header && count > 0) {
    const h = record(0);
    n = Math.max(n, h.length);
    columns = Array.from({ length: n }, (_, i) => h[i] || `Column ${i + 1}`);
  } else {
    columns = Array.from({ length: n }, (_, i) => columnLetter(i));
  }
}

function columnLetter(i: number): string {
  let s = '';
  i++;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function dataIndices(): number[] {
  const out: number[] = [];
  for (let k = header ? 1 : 0; k < count; k++) if (!deleted.has(k)) out.push(k);
  for (const k of added) if (!deleted.has(k)) out.push(k);
  return out;
}

function buildKeys(col: number) {
  if (sortKeys?.col === col) return sortKeys;
  const total = count + nextAdded;
  const strs: string[] = new Array(total);
  let numeric = 0;
  let nonEmpty = 0;
  const nums = new Float64Array(total);
  for (const k of dataIndices()) {
    const e = edits.get(k);
    const v = e ? (e[col] ?? '') : k < count ? fieldAt(text, starts[k], contentEnd(text, starts[k], starts[k + 1]), col, delim) : '';
    strs[k] = v.toLowerCase();
    if (v !== '') {
      nonEmpty++;
      const x = toNumber(v);
      nums[k] = x;
      if (!Number.isNaN(x)) numeric++;
    } else nums[k] = NaN;
  }
  const useNums = nonEmpty > 0 && numeric / nonEmpty > 0.9;
  sortKeys = { col, nums: useNums ? nums : null, strs: useNums ? null : strs };
  return sortKeys;
}

function rebuildView() {
  let idx = dataIndices();
  if (filter) {
    const q = filter.toLowerCase();
    idx = idx.filter((k) => rawRecord(k).toLowerCase().includes(q));
  }
  if (sortCol >= 0) {
    const keys = buildKeys(sortCol);
    const dir = sortDir;
    if (keys.nums) {
      const nums = keys.nums;
      idx.sort((a, b) => {
        const x = nums[a];
        const y = nums[b];
        // Empty/NaN values always last.
        if (Number.isNaN(x)) return Number.isNaN(y) ? a - b : 1;
        if (Number.isNaN(y)) return -1;
        return (x - y) * dir || a - b;
      });
    } else {
      const strs = keys.strs!;
      idx.sort((a, b) => {
        const x = strs[a];
        const y = strs[b];
        if (x === '' && y !== '') return 1;
        if (y === '' && x !== '') return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * dir || a - b;
      });
    }
  }
  view = Int32Array.from(idx);
}

function setField(k: number, col: number, v: string): string {
  const rec = [...record(k)];
  const old = rec[col] ?? '';
  while (rec.length <= col) rec.push('');
  rec[col] = v;
  edits.set(k, rec);
  return old;
}

function newRecord(): number {
  const k = count + nextAdded++;
  edits.set(k, Array(columns.length).fill(''));
  added.push(k);
  return k;
}

function changed() {
  invalidateKeys();
  completions.clear();
}

/** Apply cell changes and cleared ranges (view coordinates) as one undoable step. */
function applyEdit(cells: CellChange[], clear: Range[]): { row: number; col: number } | null {
  const entry: UndoEntry = { fields: [], created: [], removed: [] };
  // Rows past the end become new records, appended to the view in place.
  const maxRow = Math.max(-1, ...cells.map((c) => c.row));
  if (maxRow >= view.length) {
    const grow: number[] = [];
    for (let r = view.length; r <= maxRow; r++) {
      const k = newRecord();
      grow.push(k);
      entry.created.push(k);
    }
    const next = new Int32Array(view.length + grow.length);
    next.set(view);
    next.set(grow, view.length);
    view = next;
  }
  const put = (k: number, col: number, v: string) => {
    if ((record(k)[col] ?? '') === v) return;
    entry.fields.push({ k, col, old: setField(k, col, v), now: v });
  };
  for (const r of clear) {
    for (let row = r.r0; row <= Math.min(r.r1, view.length - 1); row++) {
      const k = view[row];
      const rec = record(k);
      for (let c = r.c0; c <= Math.min(r.c1, rec.length - 1); c++) if (rec[c]) put(k, c, '');
    }
  }
  for (const c of cells) {
    const k = view[c.row];
    if (k !== undefined) put(k, c.col, c.value);
  }
  if (!entry.fields.length && !entry.created.length) return null;
  undoLog.push(entry);
  if (undoLog.length > 200) undoLog.shift();
  redoLog = [];
  changed();
  const f = entry.fields[0];
  return f ? { row: view.indexOf(f.k), col: f.col } : null;
}

function step(from: UndoEntry[], to: UndoEntry[], redo: boolean): { row: number; col: number } | null {
  const e = from.pop();
  if (!e) return null;
  for (const f of redo ? e.fields : [...e.fields].reverse()) setField(f.k, f.col, redo ? f.now : f.old);
  const hide = redo ? e.removed : e.created;
  const show = redo ? e.created : e.removed;
  for (const k of hide) deleted.add(k);
  for (const k of show) deleted.delete(k);
  if (hide.length || show.length) rebuildView();
  to.push(e);
  changed();
  const f = e.fields[0];
  const k = f?.k ?? show[0];
  return k !== undefined ? { row: Math.max(0, view.indexOf(k)), col: f?.col ?? 0 } : null;
}

function stats(r: Range) {
  const s = emptyStats();
  for (let row = r.r0; row <= Math.min(r.r1, view.length - 1); row++) {
    const rec = record(view[row]);
    for (let c = r.c0; c <= r.c1; c++) addStats(s, rec[c] ?? '', toNumber);
  }
  return s;
}

function complete(col: number, typed: string): string | null {
  let list = completions.get(col);
  if (!list) {
    const seen = new Map<string, string>();
    for (const k of dataIndices()) {
      const v = record(k)[col];
      if (!v || v.length > 255 || !Number.isNaN(toNumber(v))) continue;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
      if (seen.size > 200_000) break;
    }
    list = [...seen.values()];
    completions.set(col, list);
  }
  return completeFrom(list, typed);
}

function info() {
  return {
    rows: view.length,
    totalRows: dataIndices().length,
    columns,
    delimiter: delim,
    header,
    encoding,
    eol: eol === '\r\n' ? 'CRLF' : eol === '\r' ? 'CR' : 'LF',
    sortCol,
    sortDir,
    dirty: edits.size > 0 || added.length > 0 || deleted.size > 0,
    canUndo: undoLog.length > 0,
    canRedo: redoLog.length > 0,
  };
}

async function load(url: string, ext: string, forcedDelim?: string) {
  const bytes = await fetchBytes(url, (done, total) => post({ type: 'progress', phase: 'Reading', done, total }));
  encoding = detectEncoding(bytes);
  bom = hasUtf16Bom(bytes);
  text = decode(bytes, encoding);
  const e = classifyEol(countEol(text, 1 << 20));
  eol = e === 'crlf' ? '\r\n' : e === 'cr' ? '\r' : '\n';
  delim = forcedDelim ?? detectDelimiter(text, ext);
  header = detectHeader(text, delim);
  const r = indexRecords(text, (done) => post({ type: 'progress', phase: 'Indexing', done, total: text.length }));
  starts = r.starts;
  count = r.count;
  edits = new Map();
  added = [];
  deleted = new Set();
  nextAdded = 0;
  undoLog = [];
  redoLog = [];
  completions.clear();
  sortCol = -1;
  sortKeys = null;
  filter = '';
  computeColumns();
  rebuildView();
}

function rows(start: number, end: number) {
  const out: string[][] = [];
  const keys: number[] = [];
  for (let i = start; i < Math.min(end, view.length); i++) {
    const k = view[i];
    keys.push(k);
    out.push(record(k));
  }
  return { rows: out, keys };
}

function invalidateKeys() {
  sortKeys = null;
}

async function save(path: string, token: string) {
  const enc = (s: string) => encode(s, encoding, false);
  const parts: Uint8Array[] = [];
  if (encoding === 'utf-8-bom') parts.push(new Uint8Array([0xef, 0xbb, 0xbf]));
  else if ((encoding === 'utf-16le' || encoding === 'utf-16be') && bom) parts.push(encoding === 'utf-16le' ? new Uint8Array([0xff, 0xfe]) : new Uint8Array([0xfe, 0xff]));
  const encBody = (s: string) => (encoding === 'utf-8-bom' ? encode(s, 'utf-8') : enc(s));
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    parts.push(encBody(buf.join('')));
    buf = [];
    size = 0;
  };
  const push = (s: string) => {
    buf.push(s);
    size += s.length;
    if (size > 1 << 20) flush();
  };
  // Untouched records are written back byte-for-byte (including their own
  // line terminator); edited ones are re-serialized.
  let lastTerm = eol;
  for (let k = 0; k < count; k++) {
    if (deleted.has(k)) continue;
    const s = starts[k];
    const next = starts[k + 1];
    const e = edits.get(k);
    if (!e) {
      const raw = text.slice(s, next);
      push(raw);
      const ce = contentEnd(text, s, next);
      lastTerm = text.slice(ce, next);
    } else {
      const term = text.slice(contentEnd(text, s, next), next);
      push(serializeRecord(e, delim) + term);
      lastTerm = term;
    }
  }
  for (const k of added) {
    if (deleted.has(k)) continue;
    if (lastTerm === '') push(eol);
    push(serializeRecord(edits.get(k) ?? [], delim) + eol);
    lastTerm = eol;
  }
  flush();
  const urlFor = (p: string, q: Record<string, string>) => `/__mf/${p}?${new URLSearchParams({ t: token, ...q })}`;
  return uploadParts(urlFor, path, parts, (done, total) => post({ type: 'progress', phase: 'Saving', done, total }));
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'load':
        await load(m.url, m.ext);
        return post({ id: m.id, ok: true, info: info() });
      case 'rows':
        return post({ id: m.id, ok: true, ...rows(m.start, m.end) });
      case 'sort':
        sortCol = m.col;
        sortDir = m.dir;
        rebuildView();
        return post({ id: m.id, ok: true, info: info() });
      case 'filter':
        filter = m.query;
        rebuildView();
        return post({ id: m.id, ok: true, info: info() });
      case 'setDelimiter':
        delim = m.delimiter;
        invalidateKeys();
        edits = new Map();
        undoLog = [];
        redoLog = [];
        completions.clear();
        computeColumns();
        rebuildView();
        return post({ id: m.id, ok: true, info: info() });
      case 'setHeader':
        header = m.header;
        invalidateKeys();
        computeColumns();
        rebuildView();
        return post({ id: m.id, ok: true, info: info() });
      case 'edit': {
        if (view[m.row] === undefined) throw new Error('row out of range');
        applyEdit([{ row: m.row, col: m.col, value: m.value }], []);
        return post({ id: m.id, ok: true, info: info() });
      }
      case 'apply': {
        const at = applyEdit(m.cells, m.clear);
        return post({ id: m.id, ok: true, info: info(), at });
      }
      case 'undo':
      case 'redo': {
        const at = m.type === 'undo' ? step(undoLog, redoLog, false) : step(redoLog, undoLog, true);
        return post({ id: m.id, ok: true, info: info(), at });
      }
      case 'stats':
        return post({ id: m.id, ok: true, stats: stats(m.range) });
      case 'complete':
        return post({ id: m.id, ok: true, value: complete(m.col, m.typed) });
      case 'renameColumn': {
        if (!header || count === 0) throw new Error('no header row');
        const h = [...record(0)];
        while (h.length <= m.col) h.push('');
        h[m.col] = m.value;
        edits.set(0, h);
        computeColumns();
        return post({ id: m.id, ok: true, info: info() });
      }
      case 'insertRow': {
        const k = newRecord();
        undoLog.push({ fields: [], created: [k], removed: [] });
        redoLog = [];
        changed();
        rebuildView();
        return post({ id: m.id, ok: true, info: info(), row: view.indexOf(k) });
      }
      case 'deleteRows': {
        const removed: number[] = [];
        for (const r of m.rows as number[]) {
          const k = view[r];
          if (k !== undefined && !deleted.has(k)) {
            deleted.add(k);
            removed.push(k);
          }
        }
        if (removed.length) {
          undoLog.push({ fields: [], created: [], removed });
          redoLog = [];
        }
        changed();
        rebuildView();
        return post({ id: m.id, ok: true, info: info() });
      }
      case 'save': {
        const entry = await save(m.path, m.token);
        // The file on disk now matches: reload from it so record spans and
        // the clean state are exact.
        return post({ id: m.id, ok: true, entry });
      }
      case 'reload':
        await load(m.url, m.ext, m.delimiter);
        return post({ id: m.id, ok: true, info: info() });
    }
  } catch (e) {
    post({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
