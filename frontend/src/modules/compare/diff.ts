// Diff algorithms for Compare: Myers' O(ND) difference in linear space (the
// "middle snake" bisection, as in diff-match-patch) over integer sequences,
// side-by-side row alignment, word-level diff inside changed lines, and
// structural changes for JSON/YAML values and CSV tables. Pure; unit-tested.

export const EQ = 0;
export const DEL = 1;
export const INS = 2;
export type Op = typeof EQ | typeof DEL | typeof INS;

/** Run-length edit script: [op, count] pairs, adjacent runs merged. */
export type Edits = [Op, number][];

class Out {
  edits: Edits = [];
  push(op: Op, n: number) {
    if (n <= 0) return;
    const last = this.edits[this.edits.length - 1];
    if (last && last[0] === op) last[1] += n;
    else this.edits.push([op, n]);
  }
}

type Seq = ArrayLike<number>;

/** Diff two sequences. Gives up refining (reports a replace) after `ms` milliseconds. */
export function diff(a: Seq, b: Seq, ms = 2000): Edits {
  const out = new Out();
  main(a, 0, a.length, b, 0, b.length, out, performance.now() + ms);
  // Normalise: within a change block, deletions before insertions.
  const e = out.edits;
  const res: Edits = [];
  for (let i = 0; i < e.length; ) {
    if (e[i][0] === EQ) {
      res.push(e[i++]);
      continue;
    }
    let d = 0;
    let n = 0;
    while (i < e.length && e[i][0] !== EQ) {
      if (e[i][0] === DEL) d += e[i][1];
      else n += e[i][1];
      i++;
    }
    if (d) res.push([DEL, d]);
    if (n) res.push([INS, n]);
  }
  return res;
}

function main(a: Seq, aS: number, aE: number, b: Seq, bS: number, bE: number, out: Out, deadline: number) {
  let pre = 0;
  while (aS < aE && bS < bE && a[aS] === b[bS]) {
    aS++;
    bS++;
    pre++;
  }
  let suf = 0;
  while (aS < aE && bS < bE && a[aE - 1] === b[bE - 1]) {
    aE--;
    bE--;
    suf++;
  }
  out.push(EQ, pre);
  if (aS === aE) out.push(INS, bE - bS);
  else if (bS === bE) out.push(DEL, aE - aS);
  else bisect(a, aS, aE, b, bS, bE, out, deadline);
  out.push(EQ, suf);
}

function bisect(a: Seq, aS: number, aE: number, b: Seq, bS: number, bE: number, out: Out, deadline: number) {
  const n = aE - aS;
  const m = bE - bS;
  const maxD = Math.ceil((n + m) / 2);
  const off = maxD;
  const len = 2 * maxD;
  const v1 = new Int32Array(len).fill(-1);
  const v2 = new Int32Array(len).fill(-1);
  v1[off + 1] = 0;
  v2[off + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  const split = (x: number, y: number) => {
    main(a, aS, aS + x, b, bS, bS + y, out, deadline);
    main(a, aS + x, aE, b, bS + y, bE, out, deadline);
  };
  for (let d = 0; d < maxD; d++) {
    if ((d & 63) === 0 && performance.now() > deadline) break;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1o = off + k1;
      let x1 = k1 === -d || (k1 !== d && v1[k1o - 1] < v1[k1o + 1]) ? v1[k1o + 1] : v1[k1o - 1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aS + x1] === b[bS + y1]) {
        x1++;
        y1++;
      }
      v1[k1o] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2o = off + delta - k1;
        if (k2o >= 0 && k2o < len && v2[k2o] !== -1 && x1 >= n - v2[k2o]) return split(x1, y1);
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2o = off + k2;
      let x2 = k2 === -d || (k2 !== d && v2[k2o - 1] < v2[k2o + 1]) ? v2[k2o + 1] : v2[k2o - 1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aS + n - x2 - 1] === b[bS + m - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[k2o] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1o = off + delta - k2;
        if (k1o >= 0 && k1o < len && v1[k1o] !== -1) {
          const x1 = v1[k1o];
          const y1 = off + x1 - k1o;
          if (x1 >= n - x2) return split(x1, y1);
        }
      }
    }
  }
  // Out of time (or no overlap): report a replace.
  out.push(DEL, n);
  out.push(INS, m);
}

// ---------- lines ----------

/** Map strings to small integers (same string → same id) so lines diff as numbers. */
export function intern(lines: string[], ids: Map<string, number>, key: (s: string) => string = (s) => s): Int32Array {
  const out = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const k = key(lines[i]);
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    out[i] = id;
  }
  return out;
}

export const ignoreWhitespace = (s: string) => s.trim().replace(/\s+/g, ' ');

export const SAME = 0;
export const CHANGE = 1;
export const REMOVED = 2;
export const ADDED = 3;

/**
 * Side-by-side rows: [kind, line in a (-1 if none), line in b (-1)] × n.
 * Deleted and inserted lines of one block are paired as "changed" rows.
 */
export function rows(edits: Edits): Int32Array {
  let n = 0;
  for (let i = 0; i < edits.length; i++) {
    const [op, c] = edits[i];
    if (op === DEL && edits[i + 1]?.[0] === INS) {
      n += Math.max(c, edits[i + 1][1]);
      i++;
    } else n += c;
  }
  const r = new Int32Array(n * 3);
  let k = 0;
  let a = 0;
  let b = 0;
  const put = (kind: number, la: number, lb: number) => {
    r[k++] = kind;
    r[k++] = la;
    r[k++] = lb;
  };
  for (let i = 0; i < edits.length; i++) {
    const [op, c] = edits[i];
    if (op === EQ) for (let j = 0; j < c; j++) put(SAME, a++, b++);
    else if (op === DEL && edits[i + 1]?.[0] === INS) {
      const ci = edits[i + 1][1];
      for (let j = 0; j < Math.max(c, ci); j++) put(j < c && j < ci ? CHANGE : j < c ? REMOVED : ADDED, j < c ? a + j : -1, j < ci ? b + j : -1);
      a += c;
      b += ci;
      i++;
    } else if (op === DEL) for (let j = 0; j < c; j++) put(REMOVED, a++, -1);
    else for (let j = 0; j < c; j++) put(ADDED, -1, b++);
  }
  return r;
}

/** Change blocks as [first row, row after] for "next / previous change". */
export function hunks(r: Int32Array): [number, number][] {
  const out: [number, number][] = [];
  const n = r.length / 3;
  for (let i = 0; i < n; i++) {
    if (r[i * 3] === SAME) continue;
    const s = i;
    while (i < n && r[i * 3] !== SAME) i++;
    out.push([s, i]);
  }
  return out;
}

/**
 * "Only changes" view: unchanged runs longer than 2 × context collapse into a
 * gap. disp: row index (≥ 0) or -1 - g for gaps[g] = [first row, count].
 */
export function fold(r: Int32Array, context: number): { disp: Int32Array; gaps: [number, number][] } {
  const n = r.length / 3;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    if (r[i * 3] !== SAME) for (let k = Math.max(0, i - context); k <= Math.min(n - 1, i + context); k++) keep[k] = 1;
  const disp: number[] = [];
  const gaps: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (keep[i]) {
      disp.push(i++);
      continue;
    }
    const s = i;
    while (i < n && !keep[i]) i++;
    gaps.push([s, i - s]);
    disp.push(-gaps.length);
  }
  return { disp: Int32Array.from(disp), gaps };
}

export interface Stats {
  same: number;
  changed: number;
  removed: number;
  added: number;
}

export function stats(r: Int32Array): Stats {
  const s: Stats = { same: 0, changed: 0, removed: 0, added: 0 };
  for (let i = 0; i < r.length; i += 3) {
    const k = r[i];
    if (k === SAME) s.same++;
    else if (k === CHANGE) s.changed++;
    else if (k === REMOVED) s.removed++;
    else s.added++;
  }
  return s;
}

// ---------- words ----------

export interface Seg {
  text: string;
  changed: boolean;
}

const TOKEN = /\w+|\s+|[^\w\s]/gu;

/** Word-level diff of two lines: the segments of each side, changed ones marked. */
export function wordDiff(a: string, b: string): [Seg[], Seg[]] {
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  const ids = new Map<string, number>();
  const e = diff(intern(ta, ids), intern(tb, ids), 50);
  const sa: Seg[] = [];
  const sb: Seg[] = [];
  const add = (list: Seg[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  for (const [op, c] of e) {
    for (let k = 0; k < c; k++) {
      if (op === EQ) {
        add(sa, ta[i++], false);
        add(sb, tb[j++], false);
      } else if (op === DEL) add(sa, ta[i++], true);
      else add(sb, tb[j++], true);
    }
  }
  return [sa, sb];
}

// ---------- structured data ----------

/** Stable JSON with sorted object keys (for a structural side-by-side). */
export function canonical(v: unknown, sortKeys = true, indent = 2): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      const keys = Object.keys(x as object);
      if (sortKeys) keys.sort();
      const o: Record<string, unknown> = {};
      for (const k of keys) o[k] = norm((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v), null, indent) ?? 'undefined';
}

const pathKey = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);

/** Leaves of a value by path ($.a.b[0]); empty objects/arrays are leaves. */
export function flatten(v: unknown, path = '$', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(v)) {
    if (!v.length) out.set(path, []);
    v.forEach((x, i) => flatten(x, `${path}[${i}]`, out));
  } else if (v && typeof v === 'object') {
    const keys = Object.keys(v as object);
    if (!keys.length) out.set(path, {});
    for (const k of keys) flatten((v as Record<string, unknown>)[k], path + pathKey(k), out);
  } else out.set(path, v);
  return out;
}

export interface DataChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  a?: unknown;
  b?: unknown;
}

/** Paths whose values differ between two parsed documents. */
export function dataChanges(a: unknown, b: unknown): DataChange[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const out: DataChange[] = [];
  const same = (x: unknown, y: unknown) => x === y || JSON.stringify(x) === JSON.stringify(y);
  for (const [p, va] of fa) {
    if (!fb.has(p)) out.push({ path: p, kind: 'removed', a: va });
    else if (!same(va, fb.get(p))) out.push({ path: p, kind: 'changed', a: va, b: fb.get(p) });
  }
  for (const [p, vb] of fb) if (!fa.has(p)) out.push({ path: p, kind: 'added', b: vb });
  return out;
}

export interface RowChange {
  key: string;
  kind: 'added' | 'removed' | 'changed';
  /** Row numbers (0-based, data rows only). */
  ra: number;
  rb: number;
  cells?: { col: number; name: string; a: string; b: string }[];
}

/**
 * Table changes, rows matched by a key column (duplicate keys matched in
 * order). header: column names (from the first file) or null.
 */
export function tableChanges(a: string[][], b: string[][], keyCol: number, header: string[] | null): RowChange[] {
  const index = (rowsX: string[][]) => {
    const m = new Map<string, number[]>();
    rowsX.forEach((r, i) => {
      const k = r[keyCol] ?? '';
      const l = m.get(k);
      if (l) l.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  const ia = index(a);
  const ib = index(b);
  const out: RowChange[] = [];
  const seen = new Set<string>();
  for (const [k, la] of ia) {
    const lb = ib.get(k) ?? [];
    seen.add(k);
    la.forEach((ra, n) => {
      const rb = lb[n];
      if (rb === undefined) {
        out.push({ key: k, kind: 'removed', ra, rb: -1 });
        return;
      }
      const cols = Math.max(a[ra].length, b[rb].length);
      const cells: RowChange['cells'] = [];
      for (let c = 0; c < cols; c++) {
        const x = a[ra][c] ?? '';
        const y = b[rb][c] ?? '';
        if (x !== y) cells.push({ col: c, name: header?.[c] ?? `Column ${c + 1}`, a: x, b: y });
      }
      if (cells.length) out.push({ key: k, kind: 'changed', ra, rb, cells });
    });
    for (let n = la.length; n < lb.length; n++) out.push({ key: k, kind: 'added', ra: -1, rb: lb[n] });
  }
  for (const [k, lb] of ib) if (!seen.has(k)) for (const rb of lb) out.push({ key: k, kind: 'added', ra: -1, rb });
  return out.sort((x, y) => (x.ra >= 0 ? x.ra : Infinity) - (y.ra >= 0 ? y.ra : Infinity) || (x.rb >= 0 ? x.rb : Infinity) - (y.rb >= 0 ? y.rb : Infinity));
}

// ---------- images ----------

/**
 * Pixel difference of two RGBA images of the same size: count of pixels whose
 * largest channel difference exceeds tol, their bounding box, and a mask
 * (changed pixels opaque magenta, the rest transparent).
 */
export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, tol = 0): { changed: number; box: [number, number, number, number] | null; mask: Uint8ClampedArray } {
  const mask = new Uint8ClampedArray(w * h * 4);
  let changed = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
      if (d > tol) {
        changed++;
        mask[i] = 255;
        mask[i + 1] = 0;
        mask[i + 2] = 200;
        mask[i + 3] = 90 + Math.min(165, d);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { changed, box: x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1], mask };
}
