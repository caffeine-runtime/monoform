<script lang="ts">
  import Icon from './Icon.svelte';
  import { CaseSensitive, ChevronRight, Regex, WholeWord, X } from '../core/icons';
  import { folderSearch as s } from '../core/search.svelte';
  import { sidebar } from '../core/sidebar.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { basename, dirname, relative } from '../core/paths';
  import { iconFor } from '../core/fileicons';
  import { t, tn } from '../core/i18n';

  const root = $derived(sidebar.searchRoot || workspace.folder);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // "in <folder>", around the folder name.
  const inFolder = t('in {folder}').split('{folder}');
  const total = $derived(s.results.reduce((n, r) => n + r.matches.length, 0));

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => s.run(root), 250);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      void s.run(root);
    } else if (e.key === 'Escape') {
      if (s.query) {
        s.query = '';
        s.cancel();
        s.results = [];
      } else sidebar.mode = 'files';
    }
  }

  function toggle(opt: 'caseSensitive' | 'wholeWord' | 'regex') {
    s[opt] = !s[opt];
    schedule();
  }

  function open(path: string, line: number, col: number, len: number, text: string) {
    void workspace.openPath(path, { reveal: { line, col, text: text.slice(0, len) || undefined } });
  }

  function rel(p: string) {
    const r = root ? relative(root, dirname(p)) : null;
    return r ?? dirname(p);
  }
</script>

<div class="search">
  <div class="bar">
    <div class="field">
      <input id="folder-search" class="input" placeholder={t('Find in folder')} bind:value={s.query} oninput={schedule} onkeydown={key} spellcheck="false" autocomplete="off" />
      <div class="opts">
        <button class="icon-btn sm" class:on={s.caseSensitive} title={t('Match case')} onclick={() => toggle('caseSensitive')}><Icon icon={CaseSensitive} size={15} /></button>
        <button class="icon-btn sm" class:on={s.wholeWord} title={t('Whole word')} onclick={() => toggle('wholeWord')}><Icon icon={WholeWord} size={15} /></button>
        <button class="icon-btn sm" class:on={s.regex} title={t('Regular expression')} onclick={() => toggle('regex')}><Icon icon={Regex} size={15} /></button>
      </div>
    </div>
    <button class="icon-btn" title={t('Back to files ({key})', { key: 'Esc' })} onclick={() => (sidebar.mode = 'files')}><Icon icon={X} size={15} /></button>
  </div>
  <div class="meta">
    {#if !root}
      {t('Open a folder to search it.')}
    {:else if s.error}
      <span class="err">{s.error}</span>
    {:else if s.running}
      <span class="spinner"></span> {t('Searching…')} {tn('{n} file', '{n} files', s.scanned)} {#if total}· {tn('{n} match', '{n} matches', total)}{/if}
      <button class="link" onclick={() => s.cancel()}>{t('Stop')}</button>
    {:else if s.summary}
      {tn('{n} match', '{n} matches', s.summary.matches)} {tn('in {n} file', 'in {n} files', s.summary.files)}
      <span class="faint">{tn('({n} file searched in {ms} ms)', '({n} files searched in {ms} ms)', s.summary.scanned, { ms: s.summary.millis })}</span>
      {#if s.summary.truncated}<span class="warn">· {t('showing the first {n}', { n: s.summary.matches })}</span>{/if}
    {:else}
      {inFolder[0]}<span title={root}>{basename(root)}</span>{inFolder[1] ?? ''}
    {/if}
  </div>
  <div class="results" role="tree">
    {#each s.results as r (r.path)}
      <button class="file" onclick={() => (r.open = !r.open)} title={r.path}>
        <span class="chev" class:open={r.open}><Icon icon={ChevronRight} size={12} /></span>
        <Icon icon={iconFor(r.path)} size={14} />
        <span class="fname">{basename(r.path)}</span>
        <span class="fdir">{rel(r.path)}</span>
        <span class="count">{r.matches.length}</span>
      </button>
      {#if r.open}
        {#each r.matches.slice(0, 200) as m (m.line + ':' + m.col)}
          <button class="match" onclick={() => open(m.path, m.line, m.col, m.len, m.text.slice(m.at, m.at + m.len))} title={t('Line {n}', { n: m.line })}>
            <span class="ln">{m.line}</span>
            <span class="txt">{m.text.slice(0, m.at)}<mark>{m.text.slice(m.at, m.at + m.len)}</mark>{m.text.slice(m.at + m.len)}</span>
          </button>
        {/each}
        {#if r.matches.length > 200}<div class="more">{t('…{n} more in this file', { n: r.matches.length - 200 })}</div>{/if}
      {/if}
    {/each}
  </div>
</div>

<style>
  .search {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    gap: 4px;
    padding: 2px 8px 6px 12px;
    align-items: center;
  }
  .field {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .field .input {
    width: 100%;
    padding-right: 80px;
  }
  .opts {
    position: absolute;
    right: 3px;
    top: 3px;
    display: flex;
  }
  .icon-btn.sm {
    width: calc(24px * var(--ui-scale));
    height: calc(24px * var(--ui-scale));
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 0 16px 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .meta .spinner {
    width: 11px;
    height: 11px;
    border-width: 1.5px;
  }
  .faint {
    color: var(--text-faint);
  }
  .err {
    color: var(--danger);
  }
  .warn {
    color: var(--warning);
  }
  .link {
    border: none;
    background: none;
    color: var(--accent-text);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }
  .results {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }
  .file,
  .match {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: transparent;
    border-radius: var(--radius);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    color: var(--text);
  }
  .file {
    height: calc(26px * var(--ui-scale));
    padding: 0 8px 0 4px;
    color: var(--text-muted);
  }
  .file:hover,
  .match:hover {
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }
  .chev {
    display: inline-flex;
    transition: transform 0.12s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .fname {
    color: var(--text);
  }
  .fdir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .count {
    font-size: calc(11px * var(--ui-scale));
    padding: 0 6px;
    border-radius: 4px;
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .match {
    height: calc(24px * var(--ui-scale));
    padding: 0 8px 0 28px;
    font-size: calc(12.5px * var(--ui-scale));
  }
  .ln {
    color: var(--text-faint);
    min-width: calc(26px * var(--ui-scale));
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: calc(11px * var(--ui-scale));
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--text);
    border-radius: 3px;
    padding: 0 1px;
  }
  .more {
    padding: 2px 0 4px 34px;
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
</style>
