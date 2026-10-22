<script lang="ts">
  import FileText from '@lucide/svelte/icons/file-text';
  import Table from '@lucide/svelte/icons/table';
  import { fitBar } from '../../core/fit';
  // INI / .properties / .env: the text editor plus a table of the settings
  // (by section), problems (duplicate keys, malformed lines) and, for .env,
  // secret-looking values masked until revealed. Editing a value in the table
  // rewrites just that value in the text (comments and layout stay), as one
  // undo step of the editor.
  import Icon from '../../shell/Icon.svelte';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { EditorView } from '@codemirror/view';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { kindOf, looksSecret, parse, setValue, type Entry, type Issue } from './config';
  import { t, tn } from '../../core/i18n';

  let { tab }: { tab: Tab } = $props();

  // svelte-ignore state_referenced_locally
  const kind = kindOf(tab.name);
  const LABEL = { ini: 'INI', properties: t('Properties', {}, 'config format'), env: t('Environment') } as const;
  const TYPE = { ini: t('INI file'), properties: t('Properties file'), env: t('Environment file') } as const;
  // svelte-ignore state_referenced_locally
  let view = $state<'table' | 'text'>((tab.restoredState as { view?: 'table' | 'text' } | undefined)?.view ?? 'table');
  let entries = $state<Entry[]>([]);
  let issues = $state<Issue[]>([]);
  let filter = $state('');
  let reveal = $state(false);
  let ctl: TextController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function reparse() {
    if (!ctl) return;
    const r = parse(ctl.view.state.doc.toString(), kind);
    entries = r.entries;
    issues = r.issues;
    tab.status = { ...tab.status, type: TYPE[kind], info: `${tn('{n} setting', '{n} settings', r.entries.length)}${r.issues.length ? ` · ${tn('{n} problem', '{n} problems', r.issues.length)}` : ''}` };
  }

  const sections = $derived.by(() => {
    const q = filter.toLowerCase();
    const out: { name: string; items: Entry[] }[] = [];
    for (const e of entries) {
      if (q && !e.key.toLowerCase().includes(q) && !e.value.toLowerCase().includes(q) && !e.section.toLowerCase().includes(q)) continue;
      const last = out[out.length - 1];
      if (last && last.name === e.section) last.items.push(e);
      else out.push({ name: e.section, items: [e] });
    }
    return out;
  });
  const problemLines = $derived(new Set(issues.map((i) => i.line)));

  function edit(e: Entry, value: string) {
    if (!ctl || value === e.value || tab.readOnly) return;
    const text = ctl.view.state.doc.toString();
    const next = setValue(text, e, value, kind);
    // Replace only the changed span: find the common prefix/suffix.
    let a = 0;
    while (a < text.length && a < next.length && text[a] === next[a]) a++;
    let b = 0;
    while (b < text.length - a && b < next.length - a && text[text.length - 1 - b] === next[next.length - 1 - b]) b++;
    ctl.view.dispatch({ changes: { from: a, to: text.length - b, insert: next.slice(a, next.length - b) }, userEvent: 'input.table' });
    reparse();
  }

  function goto(line: number) {
    if (!ctl) return;
    view = 'text';
    workspace.touch();
    queueMicrotask(() => {
      const l = ctl!.view.state.doc.line(Math.min(line, ctl!.view.state.doc.lines));
      ctl!.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      ctl!.view.requestMeasure();
      ctl!.view.focus();
    });
  }

  const masked = (e: Entry) => kind === 'env' && !reveal && looksSecret(e.key) && e.value.length > 0;

  const options = {
    onDocChanged: () => {
      clearTimeout(timer);
      timer = setTimeout(reparse, 150);
    },
    onLoaded: () => reparse(),
  };

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view });
  }

  (tab as unknown as { configTest: unknown }).configTest = { entries: () => entries, issues: () => issues, edit, text: () => ctl?.view.state.doc.toString() ?? '', setView: (v: 'table' | 'text') => (view = v), setReveal: (r: boolean) => (reveal = r) };
</script>

<div class="toolbar" use:fitBar>
  <div class="seg">
    <button class="btn ghost" class:on={view === 'table'} onclick={() => ((view = 'table'), workspace.touch())}><Icon icon={Table} size={14} /> {t('Table')}</button>
    <button class="btn ghost" class:on={view === 'text'} onclick={() => ((view = 'text'), workspace.touch(), queueMicrotask(() => ctl?.view.requestMeasure()))}><Icon icon={FileText} size={14} /> {t('Text')}</button>
  </div>
  {#if view === 'table'}
    <input class="input filter" placeholder={t('Filter settings')} bind:value={filter} aria-label={t('Filter settings')} />
    {#if kind === 'env'}
      <button class="btn ghost" title={reveal ? t('Hide secret-looking values') : t('Show secret-looking values')} onclick={() => (reveal = !reveal)}><Icon icon={reveal ? EyeOff : Eye} size={14} /> {reveal ? t('Hide secrets') : t('Show secrets')}</button>
    {/if}
  {/if}
  <span class="spacer"></span>
  {#if issues.length}
    <button class="status bad" title={t('Go to the first problem')} onclick={() => goto(issues[0].line)}><Icon icon={TriangleAlert} size={14} /> {tn('{n} problem', '{n} problems', issues.length)}</button>
  {/if}
  <span class="label">{LABEL[kind]}</span>
</div>

<div class="body">
  <div class="raw" class:hidden={view !== 'text'}><TextEditor {tab} {options} onready={ready} /></div>
  {#if view === 'table'}
    <div class="table">
      {#if issues.length}
        <ul class="issues">
          {#each issues as i (i.line + i.message)}<li><button onclick={() => goto(i.line)}>{t('Line {line}', { line: String(i.line) })}</button> {i.message}</li>{/each}
        </ul>
      {/if}
      {#each sections as s (s.name + s.items[0].line)}
        {#if kind === 'ini'}<h3>{s.name ? `[${s.name}]` : t('(no section)')}</h3>{/if}
        <div class="grid" role="table">
          {#each s.items as e (e.line)}
            <div class="row" class:problem={problemLines.has(e.line)} role="row">
              <button class="key" role="cell" title={t('Line {line} — click to show it in the text', { line: String(e.line) })} onclick={() => goto(e.line)}>{e.key}</button>
              {#if masked(e)}
                <span class="val secret" role="cell" title={t('Hidden — use Show secrets')}>{'•'.repeat(Math.min(12, e.value.length))}</span>
              {:else}
                <input class="input val" role="cell" value={e.value} readonly={tab.readOnly} spellcheck="false" aria-label={e.key} onchange={(ev) => edit(e, (ev.currentTarget as HTMLInputElement).value)} onkeydown={(ev) => ev.key === 'Enter' && (ev.currentTarget as HTMLInputElement).blur()} />
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      {#if !entries.length}<div class="empty-state">{t('No settings in this file yet.')}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
  }
  .filter {
    width: calc(220px * var(--ui-scale));
    margin-left: 8px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .status.bad {
    color: var(--warning);
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .raw,
  .table {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .hidden {
    display: none;
  }
  .table {
    overflow: auto;
    padding: 10px 16px 30px;
    display: block;
  }
  h3 {
    font-family: var(--font-mono);
    font-size: var(--fs-ui);
    margin: 16px 0 6px;
    color: var(--accent-text);
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(140px, max-content) 1fr;
    gap: 2px 12px;
    max-width: 1100px;
  }
  .row {
    display: contents;
  }
  .key {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 4px 0;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row.problem .key {
    color: var(--warning);
  }
  .val {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    min-width: 0;
  }
  .secret {
    color: var(--text-muted);
    padding: 4px 8px;
    letter-spacing: 2px;
  }
  .issues {
    margin: 0 0 8px;
    padding: 8px 12px;
    list-style: none;
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
  .issues button {
    border: none;
    background: none;
    color: var(--accent-text);
    cursor: pointer;
    font: inherit;
    padding: 0;
    margin-right: 6px;
  }
</style>
