// No interface text bypasses translation. I18N_SCOPE=modules/pdf,shell limits
// the report to those paths (handy while translating one area).
import { describe, expect, it } from 'vitest';
import { untranslated } from './untranslated';
import { scanScript, scanSvelte } from './untranslated';

describe('untranslated text', () => {
  it('finds markup text, attributes and script strings, not translated ones', () => {
    const svelte = `<script lang="ts">\n  ui.toast('Saved');\n  ui.toast(t('Saved'));\n  const a = { label: 'Bold text' };\n</script>\n<button title="Zoom in" aria-label={t('Zoom out')}>Export PNG…</button>\n<span>{t('Fine')}</span> PDF\n<p>Ignored text</p><!-- i18n-ignore -->\n<style>.x { content: 'Nope'; }</style>`;
    expect(scanSvelte(svelte).map((h) => [h.line, h.text])).toEqual([
      [6, 'Zoom in'],
      [6, 'Export PNG…'],
    ]);
    expect(scanScript(svelte.split('</script>')[0]).map((h) => [h.line, h.text])).toEqual([
      [2, 'Saved'],
      [4, 'Bold text'],
    ]);
  });

  it('is all translated', () => {
    const scope = (process.env.I18N_SCOPE ?? '').split(',').filter(Boolean);
    const hits = untranslated().filter((h) => !scope.length || scope.some((p) => h.file.startsWith(p)));
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([]);
  });
});
