<script lang="ts">
  // The full path of the active file. Each folder opens a small browser of
  // that folder: subfolders to go into, files to open, and buttons to open
  // it as the sidebar folder or show it in the system file manager.
  import Icon from './Icon.svelte';
  import { ChevronRight, Folder, FolderOpen } from '../core/icons';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { iconFor } from '../core/fileicons';
  import { workspace } from '../core/tabs.svelte';
  import { peek } from '../core/peek.svelte';
  import { settings } from '../core/settings.svelte';
  import { sidebar } from '../core/sidebar.svelte';
  import { menu, toastError, ui } from '../core/ui.svelte';
  import { api, type Entry } from '../core/backend';
  import { boot } from '../core/boot';
  import { ancestors, basename, dirname } from '../core/paths';
  import { copyText } from './treeActions';
  import { t } from '../core/i18n';

  const tab = $derived(workspace.active);
  // The file on disk (for an archive entry: the archive, then the entry's name).
  const file = $derived(tab?.filePath ?? (tab?.source.kind === 'archive-entry' ? tab.source.path : undefined));
  const crumbs = $derived(file ? ancestors(file) : []);
  const entry = $derived(tab?.source.kind === 'archive-entry' ? tab.source.entry : '');

  const showIn = boot.platform === 'windows' ? t('Show in {app}', { app: 'Explorer' }) : boot.platform === 'darwin' ? t('Show in {app}', { app: 'Finder' }) : t('Show in the file manager');

  let strip = $state<HTMLDivElement>();
  // Keep the end of a long path (the file and its folder) in view.
  $effect(() => {
    void file;
    queueMicrotask(() => strip && (strip.scrollLeft = strip.scrollWidth));
  });

  // ---- the folder browser ----
  let pop = $state<{ dir: string; x: number; y: number; from: string } | null>(null);
  let items = $state<Entry[]>([]);
  let loading = $state(false);
  let error = $state('');
  let filter = $state('');
  let sel = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  const LIMIT = 500;

  const shown = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    return f ? items.filter((e) => e.name.toLowerCase().includes(f)) : items;
  });
  // ancestors() of a folder ends with its parent; a drive or / is its own.
  const parent = $derived(pop ? ancestors(pop.dir).at(-1)?.path : undefined);
  const isRoot = $derived(!!pop && (parent === undefined || parent === pop.dir));

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // Case folded first: under the C locale WebKit's collator compares code
  // points, which would put "SHA256SUMS" before "abc.txt".
  const byName = (a: string, b: string) => collator.compare(a.toLowerCase(), b.toLowerCase()) || collator.compare(a, b);

  async function load(dir: string, from = '') {
    if (!pop) return;
    pop = { ...pop, dir, from };
    loading = true;
    error = '';
    filter = '';
    try {
      const list = await api.ListDir(dir);
      if (pop?.dir !== dir) return;
      items = list
        .filter((e) => settings.value.showHidden || !e.hidden)
        .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : byName(a.name, b.name)));
      const i = from ? items.findIndex((e) => e.path === from) : -1;
      sel = Math.max(0, i);
    } catch (e) {
      items = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
      queueMicrotask(() => {
        input?.focus();
        scrollToSel();
      });
    }
  }

  function open(e: MouseEvent, dir: string, from: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (pop?.dir === dir) return close();
    pop = { dir, x: Math.min(r.left, innerWidth - 380), y: r.bottom + 2, from };
    void load(dir, from);
  }

  function close() {
    pop = null;
    items = [];
  }

  async function choose(e: Entry | undefined) {
    if (!e) return;
    if (e.isDir) return load(e.path);
    close();
    // A quick view shows one file: the chosen one takes its place.
    const before = peek.on ? workspace.active : undefined;
    const t = await workspace.openPath(e.path, peek.on ? { preview: true, quiet: true } : {});
    if (before && t && t !== before) await workspace.close(before, { force: true });
  }

  function up() {
    if (pop && !isRoot && parent) void load(parent, pop.dir);
  }

  function scrollToSel() {
    list?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function key(e: KeyboardEvent) {
    const n = Math.min(shown.length, LIMIT);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') sel = Math.min(n - 1, sel + 1);
    else if (e.key === 'ArrowUp') sel = Math.max(0, sel - 1);
    else if (e.key === 'Enter') void choose(shown[sel]);
    else if ((e.key === 'Backspace' && !filter) || (e.key === 'ArrowLeft' && e.altKey)) up();
    else return;
    e.preventDefault();
    queueMicrotask(scrollToSel);
  }

  function outside(e: PointerEvent) {
    if (pop && !(e.target as Element).closest('.folderpop, .crumb')) close();
  }

  async function asFolder() {
    if (!pop) return;
    const dir = pop.dir;
    close();
    sidebar.show();
    await workspace.openFolder(dir);
  }

  async function reveal(p: string) {
    try {
      await api.ShowInFolder(p);
    } catch (e) {
      toastError(e);
    }
  }

  function context(e: MouseEvent) {
    if (!file) return;
    menu.show(e, [
      { label: t('Copy path'), run: () => copyText(entry ? `${file}/${entry}` : file) },
      { label: t('Copy folder path'), run: () => copyText(dirname(file), t('Folder path copied')) },
      { separator: true },
      { label: showIn, run: () => reveal(file) },
      { label: t('Hide the path bar'), run: () => settings.update((s) => (s.pathBarOff = true)) },
    ]);
  }
</script>

<svelte:window onpointerdown={outside} onblur={close} />

{#if file}
  <div class="pathbar" role="navigation" aria-label={t('File location')} oncontextmenu={context}>
    <div class="strip" bind:this={strip}>
      {#each crumbs as c, i (c.path)}
        {#if i > 0}<span class="sep"><Icon icon={ChevronRight} size={12} /></span>{/if}
        <button
          class="crumb"
          class:open={pop?.dir === c.path}
          title={c.path}
          onclick={(e) => open(e, c.path, crumbs[i + 1]?.path ?? file)}>{c.name}</button
        >
      {/each}
      <span class="sep"><Icon icon={ChevronRight} size={12} /></span>
      <span class="leaf" title={file}>{basename(file)}</span>
      {#if entry}
        <span class="sep"><Icon icon={ChevronRight} size={12} /></span>
        <span class="leaf">{entry}</span>
      {/if}
    </div>
  </div>
{/if}

{#if pop}
  <div class="folderpop" style:left="{Math.max(4, pop.x)}px" style:top="{pop.y}px" role="dialog" aria-label={t('Folder')}>
    <div class="fp-head">
      <span class="fp-dir" title={pop.dir}>{pop.dir}</span>
    </div>
    <div class="fp-actions">
      <button class="btn" onclick={asFolder} title={t('Show this folder in the sidebar')}><Icon icon={FolderOpen} size={13} /> {t('Open as folder')}</button>
      <button class="btn" onclick={() => pop && reveal(pop.dir)}><Icon icon={ExternalLink} size={13} /> {showIn}</button>
    </div>
    <input class="fp-filter" bind:this={input} bind:value={filter} placeholder={t('Type to filter')} onkeydown={key} oninput={() => (sel = 0)} spellcheck="false" />
    <div class="fp-list" bind:this={list} role="listbox">
      {#if !isRoot}
        <button class="fp-item up" onclick={up} title={t('Up one folder ({key})', { key: 'Backspace' })}><Icon icon={ArrowUp} size={14} /><span>..</span></button>
      {/if}
      {#if loading && !items.length}
        <div class="fp-note"><span class="spinner"></span></div>
      {:else if error}
        <div class="fp-note err">{error}</div>
      {:else if !shown.length}
        <div class="fp-note">{filter ? t('Nothing matches') : t('Empty folder')}</div>
      {/if}
      {#each shown.slice(0, LIMIT) as e, i (e.path)}
        <button
          class="fp-item"
          class:sel={i === sel}
          class:current={e.path === file || e.path === pop.from}
          data-i={i}
          role="option"
          aria-selected={i === sel}
          onpointermove={() => (sel = i)}
          onclick={() => void choose(e)}
        >
          <Icon icon={e.isDir ? Folder : iconFor(e.name, e.kind)} size={14} />
          <span class="nm">{e.name}</span>
          {#if e.isDir}<span class="chev"><Icon icon={ChevronRight} size={12} /></span>{/if}
        </button>
      {/each}
      {#if shown.length > LIMIT}
        <div class="fp-note">{t('{n} more — type to filter', { n: shown.length - LIMIT })}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pathbar {
    display: flex;
    align-items: center;
    height: var(--pathbar-h);
    padding: 0 8px;
    border-bottom: 1px solid var(--border-soft);
    background: var(--bg);
    font-size: var(--fs-small);
    color: var(--text-muted);
    min-width: 0;
  }
  .strip {
    display: flex;
    align-items: center;
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
    min-width: 0;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .crumb {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    padding: 2px 5px;
    border-radius: 3px;
    cursor: pointer;
    flex: none;
  }
  .crumb:hover,
  .crumb.open {
    background: var(--bg-hover);
    color: var(--text);
  }
  .sep {
    display: inline-flex;
    color: var(--text-faint);
    flex: none;
  }
  .leaf {
    padding: 2px 5px;
    color: var(--text);
    flex: none;
  }
  .folderpop {
    position: fixed;
    z-index: 60;
    width: 360px;
    max-height: min(480px, 70vh);
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    font-size: var(--fs-ui);
  }
  .fp-head {
    padding: 8px 10px 4px;
    color: var(--text-muted);
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .fp-dir {
    unicode-bidi: plaintext;
  }
  .fp-actions {
    display: flex;
    gap: 6px;
    padding: 2px 10px 6px;
  }
  .fp-actions .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    font-size: var(--fs-small);
  }
  .fp-filter {
    margin: 0 10px 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
  }
  .fp-list {
    overflow-y: auto;
    padding: 0 4px 6px;
    min-height: 0;
  }
  .fp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: var(--row-h);
    padding: 0 8px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fp-item.sel {
    background: var(--bg-hover);
  }
  .fp-item.current .nm {
    color: var(--accent-text);
    font-weight: 600;
  }
  .fp-item.up {
    color: var(--text-muted);
  }
  .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    display: inline-flex;
    color: var(--text-faint);
  }
  .fp-note {
    padding: 8px 10px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .fp-note.err {
    color: var(--danger);
  }
</style>
