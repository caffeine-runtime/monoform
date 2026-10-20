// Font metadata from TrueType/OpenType (and WOFF, after its tables are
// inflated): names, weight, glyph count, the characters it covers (cmap) and
// variable-font axes. Pure apart from WOFF's inflate (DecompressionStream);
// unit-tested.

export interface FontInfo {
  format: 'TrueType' | 'OpenType (CFF)' | 'WOFF' | 'WOFF2' | 'TrueType collection';
  family: string;
  style: string;
  fullName: string;
  version: string;
  copyright: string;
  license: string;
  designer: string;
  vendor: string;
  weight: number;
  italic: boolean;
  glyphs: number;
  /** Covered code points, sorted. */
  chars: number[];
  axes: { tag: string; min: number; def: number; max: number; name: string }[];
  /** Fonts inside a collection (TTC). */
  fonts: number;
}

type Tables = Map<string, DataView>;

function sfntTables(v: DataView, off = 0): Tables {
  const n = v.getUint16(off + 4);
  const t: Tables = new Map();
  for (let i = 0; i < n; i++) {
    const r = off + 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3));
    const o = v.getUint32(r + 8);
    const len = v.getUint32(r + 12);
    if (o + len <= v.byteLength) t.set(tag, new DataView(v.buffer, v.byteOffset + o, len));
  }
  return t;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function woffTables(v: DataView): Promise<Tables> {
  const n = v.getUint16(12);
  const t: Tables = new Map();
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const tag = String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3));
    const o = v.getUint32(r + 4);
    const comp = v.getUint32(r + 8);
    const orig = v.getUint32(r + 12);
    let data = new Uint8Array(v.buffer, v.byteOffset + o, comp);
    if (comp < orig) data = await inflate(data);
    t.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength));
  }
  return t;
}

function utf16be(v: DataView, o: number, len: number): string {
  let s = '';
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(v.getUint16(o + i));
  return s;
}

function names(t: DataView | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!t) return out;
  const count = t.getUint16(2);
  const strOff = t.getUint16(4);
  const best = new Map<number, number>(); // nameID → score of the record kept
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = t.getUint16(r);
    const lang = t.getUint16(r + 4);
    const id = t.getUint16(r + 6);
    const len = t.getUint16(r + 8);
    const o = strOff + t.getUint16(r + 10);
    if (o + len > t.byteLength) continue;
    // Prefer Windows English, then any Unicode, then Mac Roman.
    const score = platform === 3 && lang === 0x409 ? 3 : platform === 3 || platform === 0 ? 2 : platform === 1 ? 1 : 0;
    if (!score || score <= (best.get(id) ?? 0)) continue;
    let s = '';
    if (platform === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(t.getUint8(o + k));
    else s = utf16be(t, o, len);
    out.set(id, s);
    best.set(id, score);
  }
  return out;
}

function cmap(t: DataView | undefined): number[] {
  if (!t) return [];
  const n = t.getUint16(2);
  let sub = -1;
  let fmtBest = 0;
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    const pid = t.getUint16(r);
    const eid = t.getUint16(r + 2);
    const o = t.getUint32(r + 4);
    if (o + 2 > t.byteLength) continue;
    const fmt = t.getUint16(o);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    const score = unicode ? (fmt === 12 ? 3 : fmt === 4 ? 2 : 0) : 0;
    if (score > fmtBest) {
      fmtBest = score;
      sub = o;
    }
  }
  const out = new Set<number>();
  if (sub < 0) return [];
  const fmt = t.getUint16(sub);
  if (fmt === 4) {
    const segs = t.getUint16(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = t.getUint16(ends + s * 2);
      const start = t.getUint16(starts + s * 2);
      const delta = t.getInt16(deltas + s * 2);
      const ro = t.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + s * 2 + ro + (c - start) * 2;
          g = gi + 2 <= t.byteLength ? t.getUint16(gi) : 0;
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) out.add(c);
      }
    }
  } else if (fmt === 12) {
    const groups = t.getUint32(sub + 12);
    for (let i = 0; i < groups; i++) {
      const r = sub + 16 + i * 12;
      const s = t.getUint32(r);
      const e = Math.min(t.getUint32(r + 4), s + 0x10000);
      if (t.getUint32(r + 8) === 0 && s === e) continue;
      for (let c = s; c <= e && out.size < 200000; c++) out.add(c);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function axes(t: DataView | undefined, nm: Map<number, string>): FontInfo['axes'] {
  if (!t) return [];
  const off = t.getUint16(4);
  const count = t.getUint16(8);
  const size = t.getUint16(10);
  const fixed = (o: number) => t.getInt32(o) / 65536;
  const out: FontInfo['axes'] = [];
  for (let i = 0; i < count; i++) {
    const r = off + i * size;
    const tag = String.fromCharCode(t.getUint8(r), t.getUint8(r + 1), t.getUint8(r + 2), t.getUint8(r + 3));
    out.push({ tag, min: fixed(r + 4), def: fixed(r + 8), max: fixed(r + 12), name: nm.get(t.getUint16(r + 18)) ?? tag });
  }
  return out;
}

export async function fontInfo(buf: ArrayBuffer): Promise<FontInfo> {
  const v = new DataView(buf);
  const sig = v.byteLength >= 4 ? String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) : '';
  let tables: Tables;
  let format: FontInfo['format'];
  let fonts = 1;
  if (sig === 'wOF2') {
    return { format: 'WOFF2', family: '', style: '', fullName: '', version: '', copyright: '', license: '', designer: '', vendor: '', weight: 0, italic: false, glyphs: 0, chars: [], axes: [], fonts: 1 };
  } else if (sig === 'wOFF') {
    tables = await woffTables(v);
    format = 'WOFF';
  } else if (sig === 'ttcf') {
    fonts = v.getUint32(8);
    tables = sfntTables(v, v.getUint32(12));
    format = 'TrueType collection';
  } else if (sig === 'OTTO' || sig === '\0\x01\0\0' || sig === 'true') {
    tables = sfntTables(v);
    format = sig === 'OTTO' ? 'OpenType (CFF)' : 'TrueType';
  } else throw new Error('Not a font file');
  const nm = names(tables.get('name'));
  const os2 = tables.get('OS/2');
  const maxp = tables.get('maxp');
  const head = tables.get('head');
  const italic = os2 && os2.byteLength > 64 ? (os2.getUint16(62) & 1) !== 0 : head ? (head.getUint16(44) & 2) !== 0 : false;
  return {
    format,
    family: nm.get(16) ?? nm.get(1) ?? '',
    style: nm.get(17) ?? nm.get(2) ?? '',
    fullName: nm.get(4) ?? '',
    version: nm.get(5) ?? '',
    copyright: nm.get(0) ?? '',
    license: nm.get(13) ?? nm.get(14) ?? '',
    designer: nm.get(9) ?? nm.get(8) ?? '',
    vendor: os2 && os2.byteLength >= 62 ? String.fromCharCode(os2.getUint8(58), os2.getUint8(59), os2.getUint8(60), os2.getUint8(61)).trim() : '',
    weight: os2 && os2.byteLength >= 6 ? os2.getUint16(4) : 400,
    italic,
    glyphs: maxp ? maxp.getUint16(4) : 0,
    chars: cmap(tables.get('cmap')),
    axes: axes(tables.get('fvar'), nm),
    fonts,
  };
}

/** Unicode blocks for grouping the character grid (the common ones). */
export const BLOCKS: [number, number, string][] = [
  [0x0000, 0x007f, 'Basic Latin'],
  [0x0080, 0x00ff, 'Latin-1 Supplement'],
  [0x0100, 0x024f, 'Latin Extended'],
  [0x0250, 0x02ff, 'IPA and modifiers'],
  [0x0300, 0x036f, 'Combining marks'],
  [0x0370, 0x03ff, 'Greek'],
  [0x0400, 0x052f, 'Cyrillic'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
  [0x0900, 0x097f, 'Devanagari'],
  [0x0e00, 0x0e7f, 'Thai'],
  [0x1e00, 0x1eff, 'Latin Extended Additional'],
  [0x2000, 0x206f, 'Punctuation'],
  [0x2070, 0x209f, 'Super- and subscripts'],
  [0x20a0, 0x20cf, 'Currency'],
  [0x2100, 0x214f, 'Letterlike'],
  [0x2150, 0x218f, 'Number forms'],
  [0x2190, 0x21ff, 'Arrows'],
  [0x2200, 0x22ff, 'Math operators'],
  [0x2300, 0x23ff, 'Technical'],
  [0x2500, 0x259f, 'Box drawing'],
  [0x25a0, 0x25ff, 'Shapes'],
  [0x2600, 0x27bf, 'Symbols and dingbats'],
  [0x3000, 0x30ff, 'CJK punctuation, kana'],
  [0x4e00, 0x9fff, 'CJK ideographs'],
  [0xac00, 0xd7af, 'Hangul'],
  [0xe000, 0xf8ff, 'Private use'],
  [0xfb00, 0xfb4f, 'Ligatures'],
  [0x1f300, 0x1faff, 'Emoji'],
];

export function blockOf(cp: number): string {
  for (const [a, b, n] of BLOCKS) if (cp >= a && cp <= b) return n;
  return 'Other';
}

export const WEIGHTS: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
