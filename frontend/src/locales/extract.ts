// Finds translatable strings in the source, for the catalog tests and
// scripts/i18n.mjs: t('…'), t('…', vars, 'context') and tn('one', 'other', n).
// Keys must be plain string literals so they can be found here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Found {
  key: string;
  plural: boolean;
  /** English singular, for tn(). */
  one?: string;
  file: string;
  line: number;
}

export interface Dynamic {
  file: string;
  line: number;
  code: string;
}

export const SRC = join(import.meta.dirname, '..');

/** Source files with interface text (not tests, generated bindings or catalogs): the app and the setup program. */
export function sourceFiles(): string[] {
  return [...walk(SRC), ...walk(join(SRC, '..', 'setup'))];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['wailsjs', 'test', 'locales', 'node_modules'].includes(name)) continue;
      out.push(...walk(p));
    } else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Reads a JS string literal starting at s[i] (a quote); returns [value, end] or null for templates with ${}. */
function literal(s: string, i: number): [string, number] | null {
  const q = s[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[++j];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(s.slice(j + 1, j + 5), 16)) : n;
      if (n === 'u') j += 4;
      continue;
    }
    if (q === '`' && c === '$' && s[j + 1] === '{') return null;
    if (c === q) return [out, j + 1];
    out += c;
  }
  return null;
}

/** Skips one argument (balanced brackets, strings) from i; returns the index of the ',' or ')' after it. */
function skipArg(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"' || c === '`') {
      // Skip the string (templates may nest ${}; good enough to scan for the closing quote).
      let k = j + 1;
      while (k < s.length && s[k] !== c) k += s[k] === '\\' ? 2 : 1;
      j = k;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return j;
      depth--;
    } else if (c === ',' && depth === 0) return j;
  }
  return s.length;
}

const ws = (s: string, i: number) => {
  while (/\s/.test(s[i] ?? '')) i++;
  return i;
};

export function extract(files = sourceFiles()): { found: Found[]; dynamic: Dynamic[] } {
  const found: Found[] = [];
  const dynamic: Dynamic[] = [];
  for (const file of files) {
    const s = readFileSync(file, 'utf8');
    const rel = relative(SRC, file);
    const lineAt = (i: number) => s.slice(0, i).split('\n').length;
    for (const m of s.matchAll(/(?<![\w.$])(tn?)\(/g)) {
      const fn = m[1];
      let i = ws(s, m.index! + m[0].length);
      const line = lineAt(m.index!);
      const lineText = s.split('\n')[line - 1];
      if (/function\s+tn?\(|export function/.test(lineText)) continue;
      const a = literal(s, i);
      if (!a) {
        if (!/i18n-dynamic/.test(lineText)) dynamic.push({ file: rel, line, code: lineText.trim() });
        continue;
      }
      if (fn === 't') {
        i = ws(s, a[1]);
        let ctx = '';
        if (s[i] === ',') {
          i = skipArg(s, ws(s, i + 1));
          if (s[i] === ',') {
            const c = literal(s, ws(s, i + 1));
            if (c) ctx = c[0];
          }
        }
        found.push({ key: ctx ? `[${ctx}] ${a[0]}` : a[0], plural: false, file: rel, line });
      } else {
        i = ws(s, a[1]);
        const b = s[i] === ',' ? literal(s, ws(s, i + 1)) : null;
        if (!b) {
          if (!/i18n-dynamic/.test(lineText)) dynamic.push({ file: rel, line, code: lineText.trim() });
          continue;
        }
        found.push({ key: b[0], one: a[0], plural: true, file: rel, line });
      }
    }
  }
  return { found, dynamic };
}

/** {placeholders} in a string. */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}
