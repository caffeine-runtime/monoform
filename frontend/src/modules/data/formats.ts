// More data formats for the tree view: XML (elements → objects, the common
// "@attribute" / "#text" convention), TOML (smol-toml) and JSON Lines. Each
// returns a plain value or an error with line/column. Also the records of a
// table view (arrays of objects). Pure; unit-tested.
import { parse as parseToml, TomlError } from 'smol-toml';
import { lineCol, parseJson, type JsonError } from './jsonparse';

export type Parsed = { ok: true; value: unknown; documents?: number } | { ok: false; error: JsonError };

const err = (text: string, offset: number, message: string): Parsed => ({ ok: false, error: { message, offset, ...lineCol(text, offset) } });

// ---------- XML ----------

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
        if (e[0] === '#') {
          const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
        }
        return ENT[e] ?? m;
      });
}

interface El {
  name: string;
  attrs: [string, string][];
  kids: (El | string)[];
}

/** Element → value: attributes as "@name", text as "#text" (or the value itself), repeated children as arrays. */
function toValue(el: El): unknown {
  const texts = el.kids.filter((k): k is string => typeof k === 'string');
  const kids = el.kids.filter((k): k is El => typeof k !== 'string');
  const text = texts.join('').trim();
  if (!el.attrs.length && !kids.length) return text;
  const o: Record<string, unknown> = {};
  for (const [k, v] of el.attrs) o[`@${k}`] = v;
  for (const k of kids) {
    const v = toValue(k);
    if (k.name in o) {
      const cur = o[k.name];
      if (Array.isArray(cur) && (cur as unknown as { __rep?: true }).__rep) cur.push(v);
      else {
        const arr = [cur, v] as unknown[] & { __rep?: true };
        Object.defineProperty(arr, '__rep', { value: true, enumerable: false });
        o[k.name] = arr;
      }
    } else o[k.name] = v;
  }
  if (text) o['#text'] = text;
  return o;
}

export function parseXml(text: string): Parsed {
  const n = text.length;
  let i = 0;
  const stack: El[] = [];
  let root: El | null = null;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt < 0 ? n : lt);
    if (chunk) {
      if (stack.length) top().kids.push(unescapeXml(chunk));
      else if (chunk.trim()) return err(text, i, 'Text outside the root element');
    }
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) return err(text, i, 'Unclosed comment');
      i = e + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i + 9);
      if (e < 0) return err(text, i, 'Unclosed CDATA section');
      if (!stack.length) return err(text, i, 'CDATA outside the root element');
      top().kids.push(text.slice(i + 9, e));
      i = e + 3;
    } else if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      if (e < 0) return err(text, i, 'Unclosed processing instruction');
      i = e + 2;
    } else if (text.startsWith('<!', i)) {
      // DOCTYPE (possibly with an internal subset in [ ]).
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') depth--;
        else if (text[j] === '>' && depth <= 0) break;
      }
      if (j >= n) return err(text, i, 'Unclosed declaration');
      i = j + 1;
    } else if (text[i + 1] === '/') {
      const e = text.indexOf('>', i);
      if (e < 0) return err(text, i, 'Unclosed end tag');
      const name = text.slice(i + 2, e).trim();
      const el = stack.pop();
      if (!el) return err(text, i, `Unexpected </${name}>`);
      if (el.name !== name) return err(text, i, `Expected </${el.name}>, found </${name}>`);
      i = e + 1;
    } else {
      const m = /^<([^\s/>!?]+)/.exec(text.slice(i, i + 256));
      if (!m) return err(text, i, 'Invalid tag');
      const el: El = { name: m[1], attrs: [], kids: [] };
      let j = i + m[0].length;
      const attrRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?)>|\s+/y;
      let closed = false;
      let self = false;
      while (j < n) {
        attrRe.lastIndex = j;
        const a = attrRe.exec(text);
        if (!a || a.index !== j) return err(text, j, `Invalid attribute in <${el.name}>`);
        j = attrRe.lastIndex;
        if (a[1]) el.attrs.push([a[1], unescapeXml(a[3] ?? a[4] ?? '')]);
        else if (a[0].trimStart().startsWith('/') || a[0].trimStart().startsWith('>')) {
          closed = true;
          self = a[5] === '/';
          break;
        }
      }
      if (!closed) return err(text, i, `Unclosed <${el.name}>`);
      if (stack.length) top().kids.push(el);
      else if (root) return err(text, i, 'More than one root element');
      else root = el;
      if (!self) stack.push(el);
      i = j;
    }
  }
  if (stack.length) return err(text, n, `Missing </${top().name}>`);
  if (!root) return err(text, 0, 'No root element');
  return { ok: true, value: { [root.name]: toValue(root) } };
}

// ---------- TOML ----------

/** TOML dates become ISO strings (so the tree and "as JSON" show them plainly). */
function plain(v: unknown): unknown {
  if (v instanceof Date) return (v as Date & { toISOString(): string }).toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}

export function parseTomlText(text: string): Parsed {
  try {
    return { ok: true, value: plain(parseToml(text)) };
  } catch (e) {
    if (e instanceof TomlError) {
      const line = e.line ?? 1;
      const col = e.column ?? 1;
      let offset = 0;
      for (let l = 1; l < line; l++) offset = text.indexOf('\n', offset) + 1;
      return { ok: false, error: { message: e.message.split('\n')[0], offset: offset + col - 1, line, col } };
    }
    throw e;
  }
}

// ---------- JSON Lines ----------

export function parseJsonl(text: string): Parsed {
  const out: unknown[] = [];
  let start = 0;
  let line = 1;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const s = text.slice(start, end).replace(/\r$/, '');
    if (s.trim()) {
      const r = parseJson(s);
      if (!r.ok) return { ok: false, error: { message: r.error.message, offset: start + r.error.offset, line, col: r.error.col } };
      out.push(r.value);
    }
    if (end >= text.length) break;
    start = end + 1;
    line++;
  }
  return { ok: true, value: out, documents: out.length };
}

// ---------- table view ----------

/** Whether a value is a list of records (objects) worth showing as a table. */
export function isTable(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.slice(0, 50).every((x) => x && typeof x === 'object' && !Array.isArray(x));
}

/** Columns: keys in first-seen order over the first rows. */
export function tableColumns(rows: Record<string, unknown>[], sample = 2000): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, sample)) if (r && typeof r === 'object') for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export function cell(v: unknown): string {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 300 ? s.slice(0, 300) + '…' : s;
  }
  return String(v);
}
