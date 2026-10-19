// CSV/TSV core: delimiter and header detection, quote-aware row indexing,
// field parsing and minimal-quoting serialization. Pure functions; used by
// the CSV worker and unit-tested.

export const DELIMITERS = [',', ';', '\t', '|'];

/** Parse one record (text[start, end) without its line terminator) into fields. */
export function parseRecord(text: string, start: number, end: number, delim: string): string[] {
  const out: string[] = [];
  const d = delim.charCodeAt(0);
  let i = start;
  for (;;) {
    if (i < end && text.charCodeAt(i) === 34) {
      // quoted field
      let j = i + 1;
      let val = '';
      let chunk = j;
      for (;;) {
        if (j >= end) {
          val += text.slice(chunk, end);
          i = end;
          break;
        }
        if (text.charCodeAt(j) === 34) {
          if (text.charCodeAt(j + 1) === 34) {
            val += text.slice(chunk, j + 1);
            j += 2;
            chunk = j;
            continue;
          }
          val += text.slice(chunk, j);
          j++;
          // Skip to the delimiter (tolerate junk after a closing quote).
          while (j < end && text.charCodeAt(j) !== d) val += text[j++];
          i = j;
          break;
        }
        j++;
      }
      out.push(val);
    } else {
      let j = i;
      while (j < end && text.charCodeAt(j) !== d) j++;
      out.push(text.slice(i, j));
      i = j;
    }
    if (i >= end) {
      if (i === end && end > start && text.charCodeAt(end - 1) === d) out.push('');
      break;
    }
    i++; // skip delimiter
    if (i === end) {
      out.push('');
      break;
    }
  }
  return out;
}

/**
 * Index record boundaries. Returns starts[] where record k spans
 * [starts[k], starts[k+1]) including its line terminator. Quoted fields may
 * contain line breaks. A final empty line is not a record.
 */
export function indexRecords(text: string, onProgress?: (done: number) => void): { starts: Float64Array; count: number } {
  let cap = Math.max(1024, Math.ceil(text.length / 40));
  let starts = new Float64Array(cap);
  let n = 0;
  let inQuotes = false;
  let recStart = 0;
  const len = text.length;
  const push = (s: number) => {
    if (n + 1 >= cap) {
      cap *= 2;
      const next = new Float64Array(cap);
      next.set(starts);
      starts = next;
    }
    starts[n++] = s;
  };
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) inQuotes = !inQuotes;
    else if (!inQuotes && (c === 10 || c === 13)) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      push(recStart);
      recStart = i + 1;
      if (onProgress && (n & 0xffff) === 0) onProgress(i);
    }
  }
  if (recStart < len) push(recStart);
  starts[n] = len; // sentinel end
  return { starts: starts.subarray(0, n + 1), count: n };
}

/** End of the record content (excluding its line terminator). */
export function contentEnd(text: string, start: number, next: number): number {
  let e = next;
  if (e > start && text.charCodeAt(e - 1) === 10) e--;
  if (e > start && text.charCodeAt(e - 1) === 13) e--;
  return e;
}

/** The line terminator of a record ("" for the last record without one). */
export function terminator(text: string, start: number, next: number): string {
  return text.slice(contentEnd(text, start, next), next);
}

/** Records of a small sample, for detection. */
function sampleRecords(text: string, delim: string, max = 60): string[][] {
  const lim = Math.min(text.length, 256 * 1024);
  const sample = text.slice(0, lim);
  const { starts, count } = indexRecords(sample);
  const out: string[][] = [];
  // Drop the last record of a truncated sample.
  const usable = lim < text.length ? count - 1 : count;
  for (let k = 0; k < usable && out.length < max; k++) out.push(parseRecord(sample, starts[k], contentEnd(sample, starts[k], starts[k + 1]), delim));
  return out;
}

/** Pick the delimiter that gives the most consistent column count > 1. */
export function detectDelimiter(text: string, hint?: string): string {
  if (hint === 'tsv' || hint === 'tab') return '\t';
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const recs = sampleRecords(text, d, 40);
    if (!recs.length) continue;
    const counts = recs.map((r) => r.length);
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 1;
    let modeN = 0;
    for (const [c, k] of freq) if (k > modeN || (k === modeN && c > mode)) [mode, modeN] = [c, k];
    if (mode < 2) continue;
    const consistency = modeN / counts.length;
    const score = consistency * 100 + Math.min(mode, 50) * 0.5 + (d === ',' ? 0.1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

const NUMERIC = /^\s*[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?\s*%?\s*$/;
const DATEISH = /^\d{4}-\d{2}-\d{2}/;

export function isNumeric(s: string): boolean {
  return NUMERIC.test(s);
}

/** Guess whether the first record is a header row. */
export function detectHeader(text: string, delim: string): boolean {
  const recs = sampleRecords(text, delim, 30);
  if (recs.length < 2) return recs.length === 1 && recs[0].every((f) => f !== '' && !isNumeric(f));
  const [head, ...rest] = recs;
  if (head.some((f) => f.trim() === '')) return false;
  if (new Set(head).size !== head.length) return false;
  // A header cell is text where the column's data is numbers/dates.
  let typedCols = 0;
  for (let c = 0; c < head.length; c++) {
    const vals = rest.map((r) => r[c] ?? '').filter((v) => v !== '');
    if (!vals.length) continue;
    const numericCol = vals.filter((v) => isNumeric(v) || DATEISH.test(v)).length / vals.length > 0.8;
    if (numericCol) {
      if (isNumeric(head[c]) || DATEISH.test(head[c])) return false;
      typedCols++;
    }
  }
  if (typedCols > 0) return true;
  // All text: header if its values never appear again in their column.
  for (let c = 0; c < head.length; c++) if (rest.some((r) => r[c] === head[c])) return false;
  return head.every((f) => f.length < 64);
}

/** Quote a field only when needed. */
export function quoteField(v: string, delim: string): string {
  if (v === '') return v;
  if (v.includes(delim) || v.includes('"') || v.includes('\n') || v.includes('\r') || /^\s|\s$/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function serializeRecord(fields: string[], delim: string): string {
  return fields.map((f) => quoteField(f, delim)).join(delim);
}

/** Numeric value for sorting ("1,5" and "12%" tolerated); NaN when not numeric. */
export function toNumber(s: string): number {
  if (!NUMERIC.test(s)) return NaN;
  let t = s.trim().replace('%', '');
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  return Number(t);
}

/** Field `col` of a record without parsing the others (fast path for sorting). */
export function fieldAt(text: string, start: number, end: number, col: number, delim: string): string {
  const d = delim.charCodeAt(0);
  let i = start;
  let c = 0;
  while (c < col) {
    if (i >= end) return '';
    if (text.charCodeAt(i) === 34) {
      // skip quoted field
      i++;
      for (;;) {
        if (i >= end) return '';
        if (text.charCodeAt(i) === 34) {
          if (text.charCodeAt(i + 1) === 34) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      while (i < end && text.charCodeAt(i) !== d) i++;
    } else {
      while (i < end && text.charCodeAt(i) !== d) i++;
    }
    if (i >= end) return '';
    i++;
    c++;
  }
  if (text.charCodeAt(i) !== 34) {
    let j = i;
    while (j < end && text.charCodeAt(j) !== d) j++;
    return text.slice(i, j);
  }
  // Quoted: reuse the full parser for this one field.
  return parseRecord(text, i, end, delim)[0] ?? '';
}
