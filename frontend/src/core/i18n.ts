// Interface languages. Strings are written in English in the code and
// looked up in the language's catalog (src/locales/<lang>/*.json), keyed by
// that English text:
//
//   t('Save as…')                          → "Zapisz jako…"
//   t('Exported {name}', { name })         → placeholders in {braces}
//   tn('{n} file', '{n} files', count)     → plural forms (Polish has four)
//   t('Open', {}, 'verb')                  → same English, different meaning: key "[verb] Open"
//
// The language is set once at startup, before the interface loads; changing
// it reloads the window (core/language.ts), so module-level strings are fine
// in lazily loaded modules. English needs no catalog.

export type Lang = 'en' | 'pl' | 'es' | 'de' | 'fr';

export const LANGUAGES: readonly { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' }, // i18n-ignore: each language by its own name
  { id: 'pl', name: 'Polski' }, // i18n-ignore
  { id: 'es', name: 'Español' }, // i18n-ignore
  { id: 'de', name: 'Deutsch' }, // i18n-ignore
  { id: 'fr', name: 'Français' }, // i18n-ignore
];

type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalog = Record<string, string | Plural>;

let lang: Lang = 'en';
let region = 'en';
let catalog: Catalog = {};
let plurals = new Intl.PluralRules('en');
let numbers = new Intl.NumberFormat('en');

/** The language to use: the user's choice, else the first system language we have, else English. */
export function pickLanguage(setting: string | undefined, system: readonly string[]): Lang {
  const known = (s: string) => LANGUAGES.find((l) => l.id === s.toLowerCase().split(/[-_]/)[0])?.id;
  return (setting && known(setting)) || system.map(known).find(Boolean) || 'en';
}

/** The system language matching `l` (e.g. "es-MX" for Spanish), for number and date formats. */
function regionFor(l: Lang, system: readonly string[]): string {
  return system.find((s) => s.toLowerCase().split(/[-_]/)[0] === l) ?? l;
}

const files = import.meta.glob<Catalog>('../locales/*/*.json', { import: 'default' });

/** Load a language's catalog and make it current. */
export async function setLanguage(l: Lang, system: readonly string[] = []): Promise<void> {
  const parts = Object.entries(files).filter(([p]) => p.split('/').at(-2) === l);
  const loaded = await Promise.all(parts.map(([, load]) => load()));
  catalog = Object.assign({}, ...loaded);
  lang = l;
  region = regionFor(l, system);
  plurals = new Intl.PluralRules(region);
  numbers = new Intl.NumberFormat(region);
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** The interface language. */
export function language(): Lang {
  return lang;
}

/** The locale for formatting numbers and dates ("pl-PL", "es-ES", "en-US"…). */
export function locale(): string {
  return region;
}

/** A number formatted for the interface language (1,234.5 / 1 234,5). */
export function num(n: number, opts?: Intl.NumberFormatOptions): string {
  return opts ? n.toLocaleString(region, opts) : numbers.format(n);
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (typeof vars[k] === 'number' ? num(vars[k] as number) : String(vars[k])) : m));
}

/** Translate `s` (English); {name} placeholders are filled from `vars`. */
export function t(s: string, vars?: Record<string, string | number>, context?: string): string {
  const e = catalog[context ? `[${context}] ${s}` : s];
  return fill(typeof e === 'string' && e ? e : s, vars);
}

/** Translate a count: `one` and `other` are the English forms; {n} is the count. */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  const all = { n, ...vars };
  const e = catalog[other];
  if (e && typeof e === 'object') {
    const form = e[plurals.select(n)] ?? e.other;
    if (form) return fill(form, all);
  }
  if (typeof e === 'string' && e) return fill(e, all);
  return fill(new Intl.PluralRules('en').select(n) === 'one' ? one : other, all);
}
