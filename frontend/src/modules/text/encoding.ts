// Text encoding and line-ending detection, and lossless re-encoding for save.
// Pure functions (no DOM) so they run in the worker and in Vitest.

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | string; // string: any single-byte WHATWG label
export type Eol = 'lf' | 'crlf' | 'cr' | 'mixed';

export const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 with BOM',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252',
  'windows-1250': 'Windows-1250',
  'windows-1251': 'Windows-1251',
  'iso-8859-1': 'ISO-8859-1',
  'iso-8859-2': 'ISO-8859-2',
  'iso-8859-15': 'ISO-8859-15',
  koi8_r: 'KOI8-R',
  'shift_jis': 'Shift JIS',
  gbk: 'GBK',
  'euc-kr': 'EUC-KR',
  big5: 'Big5',
};

/** Encodings we can write back. Single-byte ones are encoded with a table. */
export const SINGLE_BYTE = ['windows-1252', 'windows-1250', 'windows-1251', 'iso-8859-1', 'iso-8859-2', 'iso-8859-15', 'koi8-r'];
export const WRITABLE = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', ...SINGLE_BYTE];

export function canWrite(enc: Encoding): boolean {
  return WRITABLE.includes(enc);
}

export function labelOf(enc: Encoding): string {
  return ENCODING_LABELS[enc] ?? enc.toUpperCase();
}

/** Pick an encoding from a BOM or from content. */
export function detectEncoding(b: Uint8Array): Encoding {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8-bom';
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return 'utf-16le';
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return 'utf-16be';
  // BOM-less UTF-16: lots of NULs in alternating positions (checked before
  // UTF-8 because NUL bytes are valid UTF-8).
  const sample = b.subarray(0, Math.min(b.length, 4096));
  let even = 0;
  let odd = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) i % 2 ? odd++ : even++;
  if (sample.length > 16) {
    if (odd > sample.length / 4 && even < sample.length / 20) return 'utf-16le';
    if (even > sample.length / 4 && odd < sample.length / 20) return 'utf-16be';
  }
  if (isUtf8(b)) return 'utf-8';
  return 'windows-1252';
}

export function isUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Decode bytes; the BOM (if any) is not part of the returned text. */
export function decode(b: Uint8Array, enc: Encoding): string {
  switch (enc) {
    case 'utf-8':
      // ignoreBOM keeps a U+FEFF that isn't a BOM we detected.
      return new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
    case 'utf-8-bom':
      return new TextDecoder('utf-8', { ignoreBOM: true }).decode(b.subarray(3));
    case 'utf-16le':
    case 'utf-16be': {
      const hasBom = b.length >= 2 && ((enc === 'utf-16le' && b[0] === 0xff && b[1] === 0xfe) || (enc === 'utf-16be' && b[0] === 0xfe && b[1] === 0xff));
      return new TextDecoder(enc, { ignoreBOM: true }).decode(hasBom ? b.subarray(2) : b);
    }
    default:
      return new TextDecoder(enc).decode(b);
  }
}

const tables = new Map<string, Map<number, number>>();

/** Reverse table (code unit -> byte) for a single-byte encoding. */
function reverseTable(enc: string): Map<number, number> {
  let t = tables.get(enc);
  if (t) return t;
  t = new Map();
  const dec = new TextDecoder(enc);
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const s = dec.decode(bytes);
  // Single-byte decoders map each byte to exactly one UTF-16 code unit.
  for (let i = 0; i < 256 && i < s.length; i++) if (!t.has(s.charCodeAt(i))) t.set(s.charCodeAt(i), i);
  tables.set(enc, t);
  return t;
}

export class UnencodableError extends Error {
  constructor(
    public encoding: string,
    public char: string,
    public index: number,
  ) {
    super(`“${char}” can't be saved as ${labelOf(encoding)}`);
  }
}

/**
 * Encode text. `withBom` controls the BOM for UTF-16 (we keep whatever the
 * file had). Throws UnencodableError for characters a single-byte encoding
 * can't represent.
 */
export function encode(text: string, enc: Encoding, withBom = true): Uint8Array {
  switch (enc) {
    case 'utf-8':
      return new TextEncoder().encode(text);
    case 'utf-8-bom': {
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return out;
    }
    case 'utf-16le':
    case 'utf-16be': {
      const le = enc === 'utf-16le';
      const off = withBom ? 2 : 0;
      const out = new Uint8Array(off + text.length * 2);
      if (withBom) out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out[off + i * 2] = le ? c & 0xff : c >> 8;
        out[off + i * 2 + 1] = le ? c >> 8 : c & 0xff;
      }
      return out;
    }
    default: {
      if (!SINGLE_BYTE.includes(enc)) throw new UnencodableError(enc, '', 0);
      const t = reverseTable(enc);
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const byte = c < 0x80 ? c : t.get(c);
        if (byte === undefined) throw new UnencodableError(enc, text[i], i);
        out[i] = byte;
      }
      return out;
    }
  }
}

/** Whether the original UTF-16 file had a BOM. */
export function hasUtf16Bom(b: Uint8Array): boolean {
  return b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
}

export interface EolStats {
  crlf: number;
  lf: number;
  cr: number;
}

export function countEol(text: string, limit = text.length): EolStats {
  const s: EolStats = { crlf: 0, lf: 0, cr: 0 };
  const n = Math.min(limit, text.length);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        s.crlf++;
        i++;
      } else s.cr++;
    } else if (c === 10) s.lf++;
  }
  return s;
}

export function classifyEol(s: EolStats): Eol {
  const kinds = (s.crlf > 0 ? 1 : 0) + (s.lf > 0 ? 1 : 0) + (s.cr > 0 ? 1 : 0);
  if (kinds > 1) return 'mixed';
  if (s.crlf) return 'crlf';
  if (s.cr) return 'cr';
  return 'lf';
}

export function eolString(e: Eol): string {
  return e === 'crlf' ? '\r\n' : e === 'cr' ? '\r' : '\n';
}

export const EOL_LABELS: Record<Eol, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR', mixed: 'Mixed' };
