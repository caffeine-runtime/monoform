<script lang="ts">
  import FolderDown from '@lucide/svelte/icons/folder-down';
  import FolderOutput from '@lucide/svelte/icons/folder-output';
  import { fitBar } from '../../core/fit';
  // Browse an archive like a folder; open files in place, extract some or all.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Lock from '@lucide/svelte/icons/lock';
  import Download from '@lucide/svelte/icons/download';
  import { iconFor } from '../../core/fileicons';
  import { formatBytes } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { childrenOf, extractHere, extractTo, formatName, listArchive, readOnlyReason } from '../../core/archives';
  import type { archive } from '../../wailsjs/go/models';

  let { tab }: { tab: Tab } = $props();

  let info = $state<archive.Info | null>(null);
  let dir = $state('');
  let selected = $state<string[]>([]);
  let cursor = $state(0);
  let error = $state('');
  let filter = $state('');
  let list = $state<HTMLDivElement>();

  const entries = $derived.by(() => {
    if (!info) return [];
    const kids = filter ? info.entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()) && !e.isDir) : childrenOf(info, dir);
    return [...kids].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1));
  });
  const crumbs = $derived(dir ? dir.split('/') : []);
  const totals = $derived(info ? { files: info.entries.filter((e) => !e.isDir).length, bytes: info.entries.reduce((n, e) => n + Math.max(0, e.size), 0) } : null);

  async function load() {
    error = '';
    try {
      info = await listArchive(tab.path!, true);
      tab.status = { ...tab.status, type: formatName(info.format, tab.path ?? ''), info: `${totals?.files ?? 0} files · ${formatBytes(totals?.bytes ?? 0)} unpacked` };
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    }
  }

  const META_ORDER = ['Type', 'Package', 'Volume', 'Version', 'Architecture', 'Summary', 'Manufacturer', 'Maintainer', 'Vendor', 'License'];
  const metaRank = (k: string) => (META_ORDER.indexOf(k) + 1 || 50) + (k === 'Description' || k === 'Note' ? 100 : 0);

  function go(d: string) {
    dir = d;
    selected = [];
    cursor = 0;
  }

  function open(e: archive.Entry) {
    if (e.isDir) go(e.name);
    else void workspace.openArchiveEntry(tab.path!, e.name);
  }

  function click(ev: MouseEvent, e: archive.Entry, i: number) {
    cursor = i;
    if (ev.ctrlKey || ev.metaKey) selected = selected.includes(e.name) ? selected.filter((n) => n !== e.name) : [...selected, e.name];
    else if (ev.shiftKey && selected.length) {
      const anchor = entries.findIndex((x) => x.name === selected[selected.length - 1]);
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      selected = entries.slice(a, b + 1).map((x) => x.name);
    } else selected = [e.name];
    if (ev.detail === 2) open(e);
  }

  function key(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown') cursor = Math.min(entries.length - 1, cursor + 1);
    else if (ev.key === 'ArrowUp') cursor = Math.max(0, cursor - 1);
    else if (ev.key === 'Enter' && entries[cursor]) open(entries[cursor]);
    else if ((ev.key === 'Backspace' || (ev.key === 'ArrowUp' && ev.altKey)) && dir) go(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
    else return;
    ev.preventDefault();
    if (entries[cursor] && !ev.ctrlKey) selected = [entries[cursor].name];
    list?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  }

  (tab as unknown as { archiveTest: unknown }).archiveTest = { info: () => info, go, open, select: (n: string[]) => (selected = n) };

  onMount(() => {
    tab.handlers = { ...tab.handlers, reload: load, onShow: () => load(), save: async () => false, focus: () => list?.focus() };
    void load();
  });
</script>

<div class="toolbar" use:fitBar>
  <button class="icon-btn" title="Up (Backspace)" disabled={!dir} onclick={() => go(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')}><Icon icon={ArrowUp} /></button>
  <nav class="crumbs">
    <button class="crumb" onclick={() => go('')}>{tab.title}</button>
    {#each crumbs as c, i}
      <span class="slash">/</span>
      <button class="crumb" onclick={() => go(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
    {/each}
  </nav>
  <span class="spacer"></span>
  <input class="input filter" placeholder="Find in archive" bind:value={filter} />
  <button class="btn ghost" disabled={!selected.length} onclick={() => extractTo(tab.path!, selected)}><Icon icon={Download} size={14} /> Extract {selected.length ? `${selected.length} selected` : 'selected'}…</button>
  <button class="btn ghost" onclick={() => extractTo(tab.path!)}><Icon icon={FolderOutput} size={14} /> Extract all…</button>
  <button class="btn ghost" onclick={() => extractHere(tab.path!)}><Icon icon={FolderDown} size={14} /> Extract here</button>
</div>

{#if info?.meta && Object.keys(info.meta).length}
  <dl class="meta">
    {#each Object.entries(info.meta).sort(([a], [b]) => metaRank(a) - metaRank(b)) as [k, v] (k)}
      <div class:wide={k === 'Description' || k === 'Note'}><dt>{k}</dt><dd title={v}>{v}</dd></div>
    {/each}
  </dl>
{/if}

{#if info && readOnlyReason(info.format)}
  <div class="banner"><Icon icon={Lock} /><span class="grow">{readOnlyReason(info.format)}</span></div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="list" bind:this={list} tabindex="0" role="listbox" aria-multiselectable="true" onkeydown={key}>
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if info}
    <div class="row head">
      <span class="name">Name</span><span class="size">Size</span><span class="date">Modified</span>
    </div>
    {#each entries as e, i (e.name)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="row" class:sel={selected.includes(e.name)} class:cur={i === cursor} role="option" tabindex="-1" aria-selected={selected.includes(e.name)} onclick={(ev) => click(ev, e, i)}>
        <span class="name">
          <span class="ico"><Icon icon={e.isDir ? FolderIcon : iconFor(e.name)} size={15} /></span>
          <span class="nm">{filter ? e.name : e.name.split('/').pop()}</span>
          {#if e.link}<span class="muted">→ {e.link}</span>{/if}
        </span>
        <span class="size">{e.isDir ? '' : e.size >= 0 ? formatBytes(e.size) : '—'}</span>
        <span class="date">{e.modTime > 0 ? new Date(e.modTime).toLocaleString() : ''}</span>
      </div>
    {/each}
    {#if !entries.length}<div class="empty-state">{filter ? 'No matching files' : 'This folder is empty'}</div>{/if}
  {:else}
    <div class="empty-state"><span class="spinner"></span></div>
  {/if}
</div>

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    margin: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-small);
  }
  .meta div {
    display: flex;
    gap: 6px;
    min-width: 0;
    max-width: 420px;
  }
  .meta div.wide {
    flex-basis: 100%;
    max-width: none;
  }
  .meta dt {
    color: var(--text-muted);
    flex: none;
  }
  .meta dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }
  .crumb {
    border: none;
    background: none;
    padding: 2px 6px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .crumb:hover {
    background: var(--bg-hover);
  }
  .slash {
    color: var(--text-faint);
  }
  .filter {
    width: 180px;
    height: 28px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
    padding: 4px 10px 20px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 100px 180px;
    align-items: center;
    gap: 12px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius);
    cursor: default;
    white-space: nowrap;
  }
  .row:not(.head):hover {
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
  }
  .row.sel {
    background: var(--bg-hover);
  }
  .row.cur {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .head {
    color: var(--text-muted);
    font-size: var(--fs-small);
    height: 26px;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ico {
    display: inline-flex;
    color: var(--text-muted);
  }
  .size,
  .date {
    color: var(--text-muted);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  .size {
    text-align: right;
  }
</style>
