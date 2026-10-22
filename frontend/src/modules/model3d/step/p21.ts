// ISO 10303-21 ("STEP physical file") reader: the DATA section as numbered
// entities with their parameters. A simple instance is #12=TYPE(args); a
// complex one #13=(TYPE_A(args) TYPE_B(args)) keeps all its parts.

import { t } from '../../../core/i18n';

export type Value = number | string | Ref | Enum | Typed | null | Value[];
export interface Ref {
  ref: number;
}
export interface Enum {
  enum: string;
}
export interface Typed {
  typed: string;
  args: Value[];
}
export interface Entity {
  type: string; // upper case; the first part's type for a complex instance
  args: Value[];
  /** A complex instance's parts (each part's own parameters). */
  parts?: { type: string; args: Value[] }[];
}

export const isRef = (v: Value | undefined): v is Ref => !!v && typeof v === 'object' && 'ref' in v;
export const isEnum = (v: Value | undefined): v is Enum => !!v && typeof v === 'object' && 'enum' in v;

/** \X2\hhhh…\X0\ (UTF-16), \X4\, \X\hh (ISO 8859-1) and \S\ escapes in a string. */
function decodeString(s: string): string {
  if (!s.includes('\\')) return s;
  return s
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, h: string) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))))
    .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, h: string) => String.fromCodePoint(...(h.match(/.{8}/g) ?? []).map((x) => parseInt(x, 16))))
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, '\\');
}

export interface StepFile {
  schema: string;
  name: string;
  entities: Map<number, Entity>;
}

/**
 * Parse a STEP file. progress (0…1) is called now and then on big files.
 * Malformed instances are skipped rather than failing the whole file.
 */
export function parseStep(text: string, progress?: (f: number) => void): StepFile {
  const n = text.length;
  let i = 0;
  const entities = new Map<number, Entity>();

  const skipWs = () => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else if (c === 47 && text.charCodeAt(i + 1) === 42) {
        const e = text.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
      } else return;
    }
  };

  const keyword = (): string => {
    const s = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45) i++;
      else break;
    }
    return text.slice(s, i).toUpperCase();
  };

  const value = (): Value => {
    skipWs();
    const c = text[i];
    if (c === '#') {
      i++;
      const s = i;
      while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      return { ref: Number(text.slice(s, i)) };
    }
    if (c === "'") {
      i++;
      let out = '';
      for (;;) {
        const e = text.indexOf("'", i);
        if (e < 0) {
          out += text.slice(i);
          i = n;
          break;
        }
        out += text.slice(i, e);
        i = e + 1;
        if (text[i] === "'") {
          out += "'";
          i++;
        } else break;
      }
      return decodeString(out);
    }
    if (c === '(') {
      i++;
      const list: Value[] = [];
      skipWs();
      if (text[i] === ')') {
        i++;
        return list;
      }
      for (;;) {
        list.push(value());
        skipWs();
        if (text[i] === ',') i++;
        else {
          if (text[i] === ')') i++;
          return list;
        }
      }
    }
    if (c === '.') {
      const e = text.indexOf('.', i + 1);
      const v = text.slice(i + 1, e);
      i = e + 1;
      return { enum: v.toUpperCase() };
    }
    if (c === '$' || c === '*') {
      i++;
      return null;
    }
    if (c === '"') {
      const e = text.indexOf('"', i + 1);
      const v = text.slice(i + 1, e);
      i = e + 1;
      return v; // binary: kept as its hex text
    }
    const code = text.charCodeAt(i);
    if ((code >= 48 && code <= 57) || c === '-' || c === '+') {
      const s = i;
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if ((d >= 48 && d <= 57) || d === 46 || d === 69 || d === 101 || d === 43 || d === 45) i++;
        else break;
      }
      return Number(text.slice(s, i));
    }
    // A typed parameter: NAME(args).
    const name = keyword();
    skipWs();
    if (text[i] === '(') {
      const args = value() as Value[];
      return { typed: name, args: Array.isArray(args) ? args : [args] };
    }
    return name;
  };

  // Header: schema and file name.
  const head = text.slice(0, Math.min(n, 20000));
  const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head)?.[1] ?? '';
  const name = /FILE_NAME\s*\(\s*'([^']*)'/i.exec(head)?.[1] ?? '';
  const data = /\bDATA\b\s*(\([^;]*\))?\s*;/i.exec(text);
  if (!data) throw new Error(t('not a STEP file (no DATA section)'));
  i = data.index + data[0].length;
  let lastReport = 0;
  while (i < n) {
    skipWs();
    if (text[i] !== '#') {
      // ENDSEC; or something unexpected: next statement.
      if (/^ENDSEC/i.test(text.slice(i, i + 6))) break;
      const e = text.indexOf(';', i);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    const start = i;
    try {
      i++;
      const s = i;
      while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      const id = Number(text.slice(s, i));
      skipWs();
      if (text[i] !== '=') throw new Error('='); // i18n-ignore (caught below)
      i++;
      skipWs();
      if (text[i] === '(') {
        // Complex instance: (A(…) B(…) …)
        i++;
        const parts: { type: string; args: Value[] }[] = [];
        for (;;) {
          skipWs();
          if (text[i] === ')') {
            i++;
            break;
          }
          const type = keyword();
          if (!type) throw new Error('part'); // i18n-ignore (caught below)
          const args = value();
          parts.push({ type, args: Array.isArray(args) ? args : [] });
        }
        entities.set(id, { type: parts[0]?.type ?? '', args: parts[0]?.args ?? [], parts });
      } else {
        const type = keyword();
        const args = value();
        entities.set(id, { type, args: Array.isArray(args) ? args : [] });
      }
      skipWs();
      if (text[i] === ';') i++;
    } catch {
      const e = text.indexOf(';', start + 1);
      i = e < 0 ? n : e + 1;
    }
    if (progress && i - lastReport > 1 << 20) {
      lastReport = i;
      progress(i / n);
    }
  }
  return { schema, name, entities };
}

/** The parameters of an entity's part of a type (complex instances), or its own for a simple one. */
export function partOf(e: Entity | undefined, type: string): Value[] | undefined {
  if (!e) return undefined;
  if (!e.parts) return e.type === type ? e.args : undefined;
  return e.parts.find((p) => p.type === type)?.args;
}

/** Whether an entity is (or, complex, has a part) of the type. */
export function hasType(e: Entity | undefined, type: string): boolean {
  return !!e && (e.type === type || !!e.parts?.some((p) => p.type === type));
}
