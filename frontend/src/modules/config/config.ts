// INI, Java .properties and .env files as entries (section, key, value and
// where the value sits in the text), with problems flagged, and value edits
// as minimal text patches so comments and layout survive. Pure; unit-tested.

export type ConfigKind = 'ini' | 'properties' | 'env';

export interface Entry {
  section: string;
  key: string;
  value: string;
  /** 1-based line of the key. */
  line: number;
  /** Offsets of the value as written (including quotes / continuations). */
  from: number;
  to: number;
  /** Quote character used for the value ('' when unquoted). */
  quote: string;
}

export interface Issue {
  line: number;
  message: string;
}

export function kindOf(name: string): ConfigKind {
  const b = name.split(/[\\/]/).pop()!.toLowerCase();
  if (/^\.env(\..+)?$/.test(b) || b.endsWith('.env')) return 'env';
  if (b.endsWith('.properties')) return 'properties';
  return 'ini';
}

function lines(text: string): { s: string; at: number; n: number }[] {
  const out: { s: string; at: number; n: number }[] = [];
  let at = 0;
  let n = 1;
  for (const m of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (m[0] === '' && at >= text.length) break;
    out.push({ s: m[1], at, n: n++ });
    at += m[0].length;
    if (!m[2]) break;
  }
  return out;
}

const unescProps = (s: string) =>
  s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => (e[0] === 'u' && e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e === 't' ? '\t' : e === 'n' ? '\n' : e === 'r' ? '\r' : e === 'f' ? '\f' : e));

export function parse(text: string, kind: ConfigKind): { entries: Entry[]; issues: Issue[] } {
  const entries: Entry[] = [];
  const issues: Issue[] = [];
  const ls = lines(text);
  let section = '';
  for (let i = 0; i < ls.length; i++) {
    const { s, at, n } = ls[i];
    const t = s.trim();
    if (!t) continue;
    if (kind === 'ini') {
      if (t[0] === ';' || t[0] === '#') continue;
      if (t[0] === '[') {
        const m = /^\[([^\]]*)\]\s*(?:[;#].*)?$/.exec(t);
        if (m) section = m[1].trim();
        else issues.push({ line: n, message: 'Unclosed [section]' });
        continue;
      }
      const eq = s.search(/[=:]/);
      if (eq < 0) {
        issues.push({ line: n, message: 'Expected key = value' });
        continue;
      }
      const key = s.slice(0, eq).trim();
      let vs = eq + 1;
      while (vs < s.length && /[ \t]/.test(s[vs])) vs++;
      let ve = s.length;
      let value = s.slice(vs, ve);
      let quote = '';
      if ((value[0] === '"' || value[0] === "'") && value.lastIndexOf(value[0]) > 0) {
        quote = value[0];
        ve = vs + value.lastIndexOf(quote) + 1;
        value = value.slice(1, value.lastIndexOf(quote));
      } else {
        const c = value.search(/\s[;#]/);
        if (c >= 0) {
          ve = vs + c;
          value = value.slice(0, c);
        }
        ve = vs + value.replace(/\s+$/, '').length;
        value = value.trim();
      }
      if (!key) issues.push({ line: n, message: 'Missing key' });
      entries.push({ section, key, value, line: n, from: at + vs, to: at + ve, quote });
    } else if (kind === 'properties') {
      if (t[0] === '#' || t[0] === '!') continue;
      // Key ends at the first unescaped = : or whitespace.
      let k = s.search(/\S/);
      let key = '';
      while (k < s.length) {
        const ch = s[k];
        if (ch === '\\' && k + 1 < s.length) {
          key += s.slice(k, k + 2);
          k += 2;
          continue;
        }
        if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t') break;
        key += ch;
        k++;
      }
      while (k < s.length && /[ \t]/.test(s[k])) k++;
      if (s[k] === '=' || s[k] === ':') k++;
      while (k < s.length && /[ \t]/.test(s[k])) k++;
      const from = at + k;
      let raw = s.slice(k);
      let end = at + s.length;
      // Continuations: an odd number of trailing backslashes.
      while (/(^|[^\\])(\\\\)*\\$/.test(raw) && i + 1 < ls.length) {
        i++;
        raw = raw.slice(0, -1) + ls[i].s.replace(/^[ \t]+/, '');
        end = ls[i].at + ls[i].s.length;
      }
      entries.push({ section: '', key: unescProps(key), value: unescProps(raw), line: n, from, to: end, quote: '' });
    } else {
      if (t[0] === '#') continue;
      const m = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*/.exec(s);
      if (!m) {
        issues.push({ line: n, message: 'Expected NAME=value' });
        continue;
      }
      const vs = m[0].length;
      let rest = s.slice(vs);
      let value: string;
      let quote = '';
      let to = at + s.length;
      if (rest[0] === '"' || rest[0] === "'" || rest[0] === '`') {
        quote = rest[0];
        // Quoted values may span lines: find the closing quote in the whole text.
        const qs = at + vs;
        const ce = findClose(text, quote, qs + 1);
        if (ce < 0) {
          issues.push({ line: n, message: `Unclosed ${quote} quote` });
          value = text.slice(qs + 1);
          to = text.length;
          i = ls.length;
        } else {
          value = text.slice(qs + 1, ce);
          if (quote === '"') value = value.replace(/\\(["\\nrt$])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c));
          to = ce + 1;
          while (i + 1 < ls.length && ls[i + 1].at <= ce) i++;
        }
      } else {
        const c = rest.search(/\s#/);
        if (c >= 0) rest = rest.slice(0, c);
        value = rest.trim();
        to = at + vs + rest.replace(/\s+$/, '').length;
      }
      entries.push({ section: '', key: m[2], value, line: n, from: at + vs, to, quote });
    }
  }
  // Duplicates within a section.
  const seen = new Map<string, number>();
  for (const e of entries) {
    const k = `${e.section}\u0000${kind === 'ini' ? e.key.toLowerCase() : e.key}`;
    const first = seen.get(k);
    if (first !== undefined) issues.push({ line: e.line, message: `“${e.key}” is already set on line ${first} (this one wins${kind === 'ini' ? ' in most readers' : ''})` });
    else seen.set(k, e.line);
  }
  issues.sort((a, b) => a.line - b.line);
  return { entries, issues };
}

function findClose(s: string, q: string, from = 0): number {
  for (let i = from; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === q) return i;
  }
  return -1;
}

/** The value text to write for a new value (quoted when the format needs it). */
export function encodeValue(value: string, kind: ConfigKind, quote: string): string {
  if (kind === 'properties') {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/^ /, '\\ ')
      .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  if (kind === 'env') {
    const needs = quote || /[\s#"'`$\\]/.test(value) || value === '';
    if (!needs) return value;
    if (quote === "'" && !value.includes("'") && !value.includes('\n')) return `'${value}'`;
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  const needs = quote || /^\s|\s$|[;#]/.test(value);
  if (!needs) return value;
  const q = quote || '"';
  return `${q}${value}${q}`;
}

/** Text with one entry's value replaced. */
export function setValue(text: string, e: Entry, value: string, kind: ConfigKind): string {
  return text.slice(0, e.from) + encodeValue(value, kind, e.quote) + text.slice(e.to);
}

/** Values that look like secrets (masked in .env tables until revealed). */
export const looksSecret = (key: string) => /pass|secret|token|key|auth|credential|private|session|cookie|salt|dsn|api/i.test(key);
