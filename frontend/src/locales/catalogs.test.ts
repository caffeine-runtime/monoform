// Every translatable string has a translation in every language, with the
// same {placeholders} and all the plural forms the language needs; no
// catalog keeps strings the code no longer uses.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../core/i18n';
import { extract, placeholders, SRC } from './extract';

type Entry = string | Record<string, string>;
// I18N_SCOPE=modules/pdf,shell checks only strings used there (while translating one area).
const scope = (process.env.I18N_SCOPE ?? '').split(',').filter(Boolean);
const inScope = (file: string) => !scope.length || scope.some((p) => file.startsWith(p));
const { found: everything, dynamic: allDynamic } = extract();
const found = everything.filter((f) => inScope(f.file));
const dynamic = allDynamic.filter((d) => inScope(d.file));
const keys = new Map<string, (typeof found)[number]>();
for (const f of found) if (!keys.has(f.key) || f.plural) keys.set(f.key, f);

function load(lang: string): { all: Record<string, Entry>; conflicts: string[] } {
  const dir = join(SRC, 'locales', lang);
  const all: Record<string, Entry> = {};
  const conflicts: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const part = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Entry>;
    for (const [k, v] of Object.entries(part)) {
      if (k in all && JSON.stringify(all[k]) !== JSON.stringify(v)) conflicts.push(`${f}: ${k}`);
      all[k] = v;
    }
  }
  return { all, conflicts };
}

describe('translatable strings', () => {
  it('are plain literals (or marked i18n-dynamic)', () => {
    expect(dynamic.map((d) => `${d.file}:${d.line}  ${d.code}`)).toEqual([]);
  });

  it('use the same placeholders in both plural forms', () => {
    const bad = found.filter((f) => f.plural && placeholders(f.one!).join() !== placeholders(f.key).filter((p) => p !== 'n' || f.one!.includes('{n}')).join());
    expect(bad.map((f) => `${f.file}:${f.line}  ${f.one} / ${f.key}`)).toEqual([]);
  });
});

for (const { id } of LANGUAGES.filter((l) => l.id !== 'en')) {
  describe(`${id} catalog`, () => {
    const { all, conflicts } = load(id);
    // The forms whole-number counts use (Spanish "many" is only for millions in compact notation).
    const rules = new Intl.PluralRules(id);
    const categories = [...new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)))];

    it('has no conflicting duplicates across files', () => expect(conflicts).toEqual([]));

    it('translates every string', () => {
      const missing = [...keys.values()].filter((f) => !(f.key in all) || all[f.key] === '').map((f) => `${f.file}:${f.line}  ${f.key}`);
      expect(missing).toEqual([]);
    });

    it('keeps no unused strings', () => {
      const used = new Set(everything.map((f) => f.key));
      expect(Object.keys(all).filter((k) => !used.has(k))).toEqual([]);
    });

    it('keeps placeholders and plural forms', () => {
      const bad: string[] = [];
      for (const [k, v] of Object.entries(all)) {
        const f = keys.get(k);
        if (!f) continue;
        const want = placeholders(k).filter((p) => p !== 'n');
        if (f.plural) {
          if (typeof v === 'string') {
            bad.push(`${k}: needs plural forms ${categories.join('/')}`);
            continue;
          }
          for (const c of categories) if (!v[c]) bad.push(`${k}: missing "${c}"`);
          for (const [c, s] of Object.entries(v)) if (placeholders(s).filter((p) => p !== 'n').join() !== want.join()) bad.push(`${k} [${c}]: placeholders ${placeholders(s)} ≠ ${placeholders(k)}`);
        } else {
          if (typeof v !== 'string') bad.push(`${k}: not a plural (use a plain string)`);
          else if (placeholders(v).join() !== placeholders(k).join()) bad.push(`${k}: placeholders ${placeholders(v)} ≠ ${placeholders(k)}`);
        }
      }
      expect(bad).toEqual([]);
    });
  });
}
