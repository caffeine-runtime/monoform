# Languages and translations

Monoform's interface is in **English, Polish and Spanish**. On first start it follows the system language (if it is
one of these, else English); the welcome screen and **Settings › Appearance › Language** let the user pick another.
Changing the language reloads the window (open tabs and the folder come back; with unsaved changes it waits for the
next start).

## How strings are written

Text is written in English in the code and passed through `t()` / `tn()` from `frontend/src/core/i18n.ts`; the
English text is the key into each language's catalog.

```ts
import { t, tn, num } from '../../core/i18n';

t('Save as…')                              // plain text
t('Exported {name}', { name })             // placeholders in {braces}; numbers are formatted for the language
tn('{n} file', '{n} files', count)         // counts — the catalog key is the plural English form
t('Open', {}, 'verb')                      // same English, other meaning: key "[verb] Open"
num(1234.5)                                // 1,234.5 / 1234,5 / 1234,5 — instead of toLocaleString()
```

In Svelte markup: `<button title={t('Zoom in')}>{t('Export PNG…')}</button>`.

Rules:

- Keys are **plain string literals** (they are found by reading the source). Never build a key at runtime, never
  glue sentence fragments: write the whole sentence with placeholders.
- Don't change the English text of an existing string without updating the catalogs (the tests catch it) — and
  self-tests find controls by their English text, so they run in English (`MF_SYSTEM_LANG=en` in the scripts).
- Names of products and formats, units, keys and code aren't translated. A line whose text needs no translation can
  be marked `// i18n-ignore` (or `<!-- i18n-ignore -->` at the end of a markup line).
- The language is set before the app's code loads (`main.ts` loads the catalog, then imports `app.ts`), so `t()` can
  be used anywhere, including in module-level tables.

## Catalogs

`frontend/src/locales/<lang>/*.json` — flat JSON, split by area (`common`, `shell`, `documents`, `image`, `media`,
`drawing`, `data`); the files of a language are merged. Only the chosen language's files are loaded (a separate
chunk; English loads none).

```json
{
  "Save as…": "Zapisz jako…",
  "Exported {name}": "Wyeksportowano {name}",
  "{n} files": { "one": "{n} plik", "few": "{n} pliki", "many": "{n} plików", "other": "{n} pliku" },
  "[verb] Open": "Otwórz"
}
```

Plural forms follow `Intl.PluralRules`: Polish needs `one`, `few` and `many` (`other` is for fractions), Spanish
`one` and `other`.

## Checks

`npm test` runs, among the unit tests:

- `src/locales/catalogs.test.ts` — every `t()`/`tn()` key has a translation in every language, with the same
  `{placeholders}` and all plural forms; no catalog keeps unused strings; no conflicting duplicates across files.
- `src/locales/untranslated.test.ts` — no interface text bypasses `t()`: text in Svelte markup, `title`/
  `aria-label`/`placeholder`/`alt` attributes, toasts, dialogs, errors and label/title fields in TypeScript.

`I18N_SCOPE=modules/pdf,shell npx vitest run src/locales/` limits both to some folders while working on them.

The in-app self-test `m47` runs the whole app in Polish and in Spanish (CI runs both): it opens a file of every
kind, the welcome screen and Settings, and fails on any English text on screen that has a translation.

## Adding a language

1. Add it to `LANGUAGES` in `frontend/src/core/i18n.ts` (its own name, e.g. `Deutsch`).
2. Copy `frontend/src/locales/es/` to `frontend/src/locales/<code>/` and translate every value (plural objects need
   the language's forms — the test says which).
3. `npm test` until the catalog tests pass; run `MF_SYSTEM_LANG=<code> scripts/selftest.sh m47 /tmp/fx`, and add
   that line to `.github/workflows/build.yml`.

Not translated yet: messages that come from the Go side (some error texts, e.g. from file operations or decoders)
are in English.
