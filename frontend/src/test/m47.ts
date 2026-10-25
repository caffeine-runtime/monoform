// M47: the interface in another language. Run with the system set to Polish,
// Spanish, German or French (MF_SYSTEM_LANG=pl-PL / es-ES / de-DE / fr-FR): the app starts in that language
// (no setting needed), numbers use its format, the first-run screen and
// Settings offer "like my computer" and each language, and opening a file of
// every kind shows no English text that has a translation (every text node
// and title/aria-label/placeholder is checked against the catalogs).
import { join } from '../core/paths';
import { LANGUAGES, language, num, pickLanguage, t, type Catalog } from '../core/i18n';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const catalogs = import.meta.glob<Catalog>('../locales/*/*.json', { import: 'default', eager: true });

/** English texts that show translated in this language (key → translation). */
function englishWithTranslation(lang: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, cat] of Object.entries(catalogs)) {
    if (path.split('/').at(-2) !== lang) continue;
    for (const [k, v] of Object.entries(cat)) {
      if (k.startsWith('[')) continue; // the same English in another meaning (e.g. a font's "Bold" style vs a line width)
      const key = k;
      if (/\{\w+\}/.test(key)) continue; // filled in at runtime
      const tr = typeof v === 'string' ? v : '';
      if (tr && tr !== key && /[a-z]{3}/i.test(key)) out.set(key, tr);
    }
  }
  return out;
}

/** The file's own content (text, drawings, document headings in an outline): not interface text. */
const CONTENT = '.cm-content, .md, .page, .pdfViewer, textarea, pre, code, [contenteditable], .paper, .stage svg, .canvas, aside.outline, .notepanel .item, .pathbar .crumb, .row .item .hint, header .meta, .rows .td';

/** A short description of where an element is, for the report. */
function where(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && parts.length < 3; e = e.parentElement) parts.push(`${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).filter((c) => !c.startsWith('svelte-')).join('.') : ''}`);
  return parts.join(' < ');
}

/** English text left on screen: text nodes and labelling attributes that equal a key with a different translation. */
function leaks(root: Element, english: Map<string, string>): string[] {
  const found = new Set<string>();
  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || el.closest('svg') !== null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.textContent?.trim() ?? '';
    const el = n.parentElement;
    if (!s || !el || el.closest(CONTENT) || !visible(el)) continue;
    if (english.has(s)) found.add(`${s} (in ${where(el)})`);
  }
  for (const el of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
    if (el.closest(CONTENT) || !visible(el)) continue;
    for (const a of ['title', 'aria-label', 'placeholder']) {
      const s = el.getAttribute(a)?.trim();
      if (s && english.has(s)) found.add(`${a}="${s}" (in ${where(el)})`);
    }
  }
  return [...found];
}

const FILES = [
  'notes/index.md',
  'vault/Home.md',
  'pdf/three.pdf',
  'office/report.docx',
  'office/budget.xlsx',
  'data/grid.csv',
  'data/sample.json',
  'img/photo.png',
  'img/vector.svg',
  'drawings/sketch.excalidraw',
  'diagrams/flow.mmd',
  'cad/plan.dxf',
  'archives/sample.zip',
  'audio/tones.wav',
  'video/clip.webm',
  'models/cube.stl',
  'db/shop.db',
  'certs/chain.pem',
  'hash/SHA256SUMS',
  'logs/app.log',
  'config/app.ini',
  'fonts/test.ttf',
];

export default async function m47(dir: string) {
  const lang = language();
  assert(lang !== 'en', `started in the system's language (got ${lang}; run with MF_SYSTEM_LANG=pl-PL, es-ES, de-DE or fr-FR)`);
  assertEq(settings.value.language ?? '', '', 'no language chosen: it follows the system');
  assertEq(document.documentElement.lang, lang, '<html lang>');
  assertEq(pickLanguage('', ['ja-JP', `${lang}-XX`]), lang, 'first known system language wins');
  assertEq(pickLanguage('en', [lang]), 'en', 'a chosen language beats the system');
  // Numbers in the language's format.
  const n = num(12345.5);
  assert(lang === 'pl' || lang === 'fr' ? /^12\s345,5$/.test(n) : /^12\.?345,5$/.test(n), `number format ${n}`);
  log(`language ${lang}; 12345.5 → ${n}`);

  const english = englishWithTranslation(lang);
  assert(english.size > 500, `catalog loaded (${english.size} strings)`);

  // First run: the language choice comes first.
  ui.firstRun = true;
  const pick = await waitFor(() => document.querySelector<HTMLSelectElement>('.firstrun select'), 'language picker on the welcome screen');
  const opts = [...pick.options].map((o) => o.textContent?.trim());
  assertEq(opts[0], t('Like my computer ({language})', { language: LANGUAGES.find((l) => l.id === lang)!.name }), 'first option follows the system');
  assertEq(opts.slice(1).join(','), LANGUAGES.map((l) => l.name).join(','), 'each language by its own name');
  assertEq(leaks(document.querySelector('.firstrun')!, english).join(' | '), '', 'welcome screen translated');
  ui.firstRun = false;
  await sleep(50);

  // The app frame, then a file of each kind.
  const bad: string[] = [];
  const check = (what: string) => {
    for (const l of leaks(document.body, english)) bad.push(`${what}: ${l}`);
  };
  check('start');
  for (const f of FILES) {
    for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
    const tab = await workspace.openPath(join(dir, f));
    assert(tab, `opened ${f}`);
    await sleep(1200);
    check(f);
  }
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  await workspace.openPath(join(dir, 'notes', 'index.md'));
  const { commands } = await import('../core/commands');
  commands.execute('app.settings');
  await sleep(800);
  check('settings');
  const row = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'pl') && [...s.options].some((o) => o.value === ''));
  assert(row, 'Settings has the language choice');
  log(`checked ${FILES.length} files, the start page and Settings`);
  assertEq(bad.join('\n'), '', 'no English text with a translation left on screen');
}
