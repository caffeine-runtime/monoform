// Spreadsheet-style operations shared by the CSV and Excel grids: ranges,
// tab-separated clipboard text (what Excel/LibreOffice/Sheets exchange),
// fill-handle series and relative formula references.

import { num, t } from '../../core/i18n';

export interface Range {
  r0: number;
  c0: number;
  r1: number; // inclusive
  c1: number;
}

export interface CellChange {
  row: number;
  col: number;
  value: string;
}

export function norm(a: { row: number; col: number }, b: { row: number; col: number }): Range {
  return { r0: Math.min(a.row, b.row), c0: Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: Math.max(a.col, b.col) };
}

export const rangeRows = (r: Range) => r.r1 - r.r0 + 1;
export const rangeCols = (r: Range) => r.c1 - r.c0 + 1;
export const rangeCells = (r: Range) => rangeRows(r) * rangeCols(r);
export const inRange = (r: Range, row: number, col: number) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;

// ---------- clipboard text ----------

/** Cells → TSV like Excel writes it: fields with tabs, newlines or quotes are quoted. */
export function toTSV(rows: string[][]): string {
  return rows
    .map((r) => r.map((v) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t'))
    .join('\r\n');
}

/** TSV (or a single value) → cells. Handles quoted fields with embedded tabs/newlines and a trailing newline. */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let v = '';
    if (text[i] === '"') {
      // Quoted field.
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          v += text.slice(i);
          i = n;
          break;
        }
        v += text.slice(i, q);
        if (text[q + 1] === '"') {
          v += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // Anything up to the separator is kept (malformed input).
      while (i < n && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') v += text[i++];
    } else {
      let j = i;
      while (j < n && text[j] !== '\t' && text[j] !== '\n' && text[j] !== '\r') j++;
      v = text.slice(i, j);
      i = j;
    }
    row.push(v);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === '\t') {
      i++;
      continue;
    }
    // Line break (\r\n, \n or \r).
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    i++;
    rows.push(row);
    row = [];
    if (i >= n) break; // trailing newline
  }
  return rows;
}

// ---------- formulas ----------

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetters(i: number): string {
  let s = '';
  i++;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const REF = /(^|[^A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)([0-9]{1,7})(?![A-Za-z0-9_(])/g;

/**
 * Move the relative references of a formula by (dRow, dCol), like Excel
 * does when a formula is copied or filled. `$` parts stay; text in quotes
 * and function names are left alone; references pushed off the sheet
 * become #REF!. Non-formulas are returned unchanged.
 */
export function shiftFormula(input: string, dRow: number, dCol: number): string {
  if (!input.startsWith('=') || (dRow === 0 && dCol === 0)) return input;
  const parts = input.split('"');
  for (let p = 0; p < parts.length; p += 2) {
    parts[p] = parts[p].replace(REF, (m, pre: string, cAbs: string, col: string, rAbs: string, row: string) => {
      const c = cAbs ? colIndex(col) : colIndex(col) + dCol;
      const r = rAbs ? Number(row) : Number(row) + dRow;
      if (colIndex(col) > 16383) return m; // not a reference (too wide), e.g. a name
      if (c < 0 || r < 1 || c > 16383 || r > 1048576) return `${pre}#REF!`;
      return `${pre}${cAbs}${colLetters(c)}${rAbs}${r}`;
    });
  }
  return parts.join('"');
}

// ---------- fill series ----------

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LISTS = [DAYS, DAYS.map((d) => d.slice(0, 3)), MONTHS, MONTHS.map((m) => m.slice(0, 3))];
const NUM = /^\s*-?\d+(\.\d+)?\s*$/;
const TRAILING = /^(.*?)(\d+)(\D*)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function matchCase(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like === like.toLowerCase()) return word.toLowerCase();
  return word;
}

function decimals(s: string): number {
  const d = s.trim().split('.')[1];
  return d ? d.length : 0;
}

/**
 * Continue `values` (the cells under the fill handle, in drag order) for
 * `count` more cells, the way Excel's fill handle does: numbers with two or
 * more samples follow their trend (a single number is copied), text ending
 * in a number counts up, weekday/month names and ISO dates continue,
 * anything else repeats.
 */
export function fillSeries(values: string[], count: number): string[] {
  const out: string[] = [];
  const n = values.length;
  if (n === 0 || count <= 0) return out;
  // Numbers: linear trend.
  if (n >= 2 && values.every((v) => NUM.test(v))) {
    const nums = values.map(Number);
    const step = (nums[n - 1] - nums[0]) / (n - 1);
    const dp = Math.max(...values.map(decimals), decimals(String(step)));
    for (let i = 1; i <= count; i++) out.push(String(+(nums[n - 1] + step * i).toFixed(Math.min(dp, 10))));
    return out;
  }
  // Day / month names.
  for (const list of LISTS) {
    const idx = values.map((v) => list.findIndex((w) => w.toLowerCase() === v.trim().toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const step = n >= 2 ? idx[n - 1] - idx[n - 2] || 1 : 1;
      for (let i = 1; i <= count; i++) {
        const k = (((idx[n - 1] + step * i) % list.length) + list.length) % list.length;
        out.push(matchCase(list[k], values[n - 1].trim()));
      }
      return out;
    }
  }
  // ISO dates.
  if (values.every((v) => ISO_DATE.test(v))) {
    const t = values.map((v) => Date.parse(`${v}T00:00:00Z`));
    const step = n >= 2 ? (t[n - 1] - t[0]) / (n - 1) : 86400000;
    for (let i = 1; i <= count; i++) out.push(new Date(t[n - 1] + step * i).toISOString().slice(0, 10));
    return out;
  }
  // Text with a trailing number: "Item 1" → "Item 2", keeping zero padding.
  const m = values.map((v) => TRAILING.exec(v));
  if (m.every((x) => x && !NUM.test(x[0])) && m.every((x) => x![1] === m[0]![1] && x![3] === m[0]![3])) {
    const nums = m.map((x) => Number(x![2]));
    const step = n >= 2 ? (nums[n - 1] - nums[0]) / (n - 1) : 1;
    if (Number.isInteger(step)) {
      const width = m[n - 1]![2].length;
      const pad = m[n - 1]![2].startsWith('0');
      for (let i = 1; i <= count; i++) {
        const v = Math.max(0, nums[n - 1] + step * i);
        out.push(m[0]![1] + (pad ? String(v).padStart(width, '0') : String(v)) + m[0]![3]);
      }
      return out;
    }
  }
  // Repeat the pattern.
  for (let i = 0; i < count; i++) out.push(values[i % n]);
  return out;
}

// ---------- autocomplete ----------

/**
 * Excel's AutoComplete: the one existing text entry that starts with what was
 * typed (case-insensitive). Nothing when several entries match, the typed
 * text is a number, or it's already complete.
 */
export function completeFrom(entries: Iterable<string>, typed: string): string | null {
  if (!typed || NUM.test(typed)) return null;
  const t = typed.toLowerCase();
  let found: string | null = null;
  for (const e of entries) {
    if (e.length <= typed.length || !e.toLowerCase().startsWith(t)) continue;
    if (found === null) found = e;
    else if (found.toLowerCase() !== e.toLowerCase()) return null;
  }
  return found;
}

// ---------- statistics ----------

export interface Stats {
  count: number; // non-empty cells
  numbers: number;
  sum: number;
  min: number;
  max: number;
}

export function emptyStats(): Stats {
  return { count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity };
}

export function addStats(s: Stats, v: string, toNumber: (v: string) => number) {
  if (v === '' || v === undefined) return;
  s.count++;
  const x = toNumber(v);
  if (!Number.isNaN(x)) {
    s.numbers++;
    s.sum += x;
    if (x < s.min) s.min = x;
    if (x > s.max) s.max = x;
  }
}

/** "Average: 3 · Count: 4 · Sum: 12" like Excel's status bar. */
export function formatStats(s: Stats): string {
  const f = (x: number) => (Number.isInteger(x) ? num(x) : num(x, { maximumFractionDigits: 6 }));
  if (s.numbers === 0) return t('Count: {count}', { count: s.count });
  return t('Average: {average} · Count: {count} · Sum: {sum}', { average: f(s.sum / s.numbers), count: s.count, sum: f(s.sum) });
}
