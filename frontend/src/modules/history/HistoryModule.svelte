<script lang="ts">
  // File history: the versions kept of one file (open, compare with the
  // current file, restore), or every file with kept versions — deleted ones
  // too — to pick from.
  import Icon from '../../shell/Icon.svelte';
  import Eye from '@lucide/svelte/icons/eye';
  import Diff from '@lucide/svelte/icons/diff';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import FileIcon from '@lucide/svelte/icons/file';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import History from '@lucide/svelte/icons/history';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Search from '@lucide/svelte/icons/search';
  import { api, errorMessage } from '../../core/backend';
  import { compareFiles } from '../../core/compare';
  import { basename, dirname, formatBytes } from '../../core/paths';
  import { settings } from '../../core/settings.svelte';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import { t, tn } from '../../core/i18n';
  import { ago, byDay, formatWhen, kindLabel, sizeDelta, type Version } from './versions';

  let { tab }: { tab: Tab } = $props();

  const path = $derived(tab.source.kind === 'tool' ? tab.source.path : undefined);
  let versions = $state<Version[]>([]);
  let current = $state('');
  let exists = $state(true);
  let files = $state<{ path: string; exists: boolean; versions: number; last: number; bytes: number }[]>([]);
  let usage = $state(0);
  let loading = $state(true);
  let error = $state('');
  let busy = $state('');
  let query = $state('');

  const limit = $derived((settings.value.historyMaxMB || 2048) * 1024 * 1024);
  const shown = $derived(query ? files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase())) : files);

  async function load() {
    error = '';
    try {
      if (path) {
        const f = await api.HistoryOf(path);
        versions = (f.entries ?? []) as Version[];
        current = f.current ?? '';
        exists = f.exists;
      } else {
        files = (await api.HistoryFiles()) ?? [];
      }
      usage = await api.HistoryUsage();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  // New saves show up when the tab is looked at again.
  $effect(() => {
    if (workspace.active === tab || workspace.split?.panes.includes(tab.id)) void load();
  });

  async function extract(v: Version): Promise<string> {
    return api.HistoryExtract(path!, v.h, v.t);
  }

  async function open(v: Version) {
    try {
      await workspace.openPath(await extract(v), { preview: true, quiet: true }); // a working copy: not a recent file
    } catch (e) {
      toastError(e);
    }
  }

  async function compare(v: Version) {
    try {
      compareFiles(await extract(v), path!);
    } catch (e) {
      toastError(e);
    }
  }

  async function restore(v: Version) {
    const p = path!;
    const openTabs = workspace.tabs.filter((t) => t.filePath === p);
    const unsaved = openTabs.some((t) => t.dirty);
    const r = await ui.ask({
      title: t('Restore {name}?', { name: basename(p) }),
      message:
        t('The file goes back to the version of {when}.', { when: formatWhen(v.t) }) +
        ' ' +
        (exists ? t('What it contains now is kept in history, so this can be undone.') : t('It was deleted; it is created again.')) +
        (unsaved ? ' ' + t('Unsaved changes in the open tab are discarded.') : ''),
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'restore', label: t('Restore') },
      ],
    });
    if (r.button !== 'restore') return;
    busy = t('Restoring…');
    try {
      await api.HistoryRestore(p, v.h);
      for (const t of openTabs) {
        t.dirty = false;
        await workspace.reloadTab(t);
      }
      ui.toast(t('{name} restored to the version of {when}.', { name: basename(p), when: formatWhen(v.t) }), 'success');
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      busy = '';
    }
  }

  async function forget() {
    const r = await ui.ask({
      title: path ? t('Forget the history of {name}?', { name: basename(path) }) : t('Clear all file history?'),
      message: path ? t('Its kept versions are deleted. The file itself is not touched.') : t('Every kept version of every file is deleted. Your files are not touched.'),
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'forget', label: path ? t('Forget') : t('Clear history'), danger: true },
      ],
    });
    if (r.button !== 'forget') return;
    try {
      await api.HistoryForget(path ?? '');
      await load();
    } catch (e) {
      toastError(e);
    }
  }

  (tab as unknown as { historyTest: unknown }).historyTest = {
    versions: () => versions,
    files: () => files,
    current: () => current,
    loaded: () => !loading,
    reload: load,
    restore: (i: number) => restore(versions[i]),
    open: (i: number) => open(versions[i]),
    compare: (i: number) => compare(versions[i]),
  };
</script>

<div class="wrap">
  {#if path}
    <header>
      <Icon icon={History} size={20} />
      <div class="ttl">
        <h1>{basename(path)}</h1>
        <div class="muted small" title={path}>{dirname(path)}{exists ? '' : ' · ' + t('deleted')}</div>
      </div>
      <span class="spacer"></span>
      {#if exists}<button class="btn ghost" onclick={() => void workspace.openPath(path)}><Icon icon={FileIcon} size={14} /> {t('Open file')}</button>{/if}
      <button class="btn ghost" onclick={() => workspace.openTool('history')}><Icon icon={FolderOpen} size={14} /> {t('All files')}</button>
    </header>
    {#if loading}
      <div class="empty-state"><span class="spinner"></span></div>
    {:else if error}
      <div class="empty-state">{error}</div>
    {:else if !versions.length}
      <div class="empty-state">
        <p>{t('No versions kept yet.')}</p>
        <p class="muted small">{t('Every time {name} is saved in Monoform, the content it had and the new one are kept here.', { name: basename(path) })}</p>
      </div>
    {:else}
      {#each byDay(versions) as group (group.day)}
        <h2>{group.day}</h2>
        <ul class="versions">
          {#each group.versions as v (v.t + v.h)}
            {@const i = versions.indexOf(v)}
            {@const isCurrent = exists && v.h === current && versions.findIndex((x) => x.h === current) === i}
            <li class:current={isCurrent}>
              <div class="when">
                <span class="time">{formatWhen(v.t)}</span>
                <span class="muted small">{ago(v.t)}</span>
              </div>
              <div class="what">
                <span>{kindLabel(v)}</span>
                {#if isCurrent}<span class="badge">{t('Current')}</span>{/if}
                <span class="muted small">{formatBytes(v.s)} {sizeDelta(versions, i, formatBytes) ? `· ${sizeDelta(versions, i, formatBytes)}` : ''}</span>
              </div>
              <div class="acts">
                <button class="btn ghost" title={t('Open this version (read-only)')} onclick={() => void open(v)}><Icon icon={Eye} size={14} /> {t('Open')}</button>
                {#if exists && !isCurrent}<button class="btn ghost" title={t('Show what changed between this version and the file now')} onclick={() => void compare(v)}><Icon icon={Diff} size={14} /> {t('Compare')}</button>{/if}
                {#if !isCurrent}<button class="btn ghost" disabled={!!busy} title={t('Put this version back')} onclick={() => void restore(v)}><Icon icon={RotateCcw} size={14} /> {t('Restore')}</button>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}
  {:else}
    <header>
      <Icon icon={History} size={20} />
      <div class="ttl">
        <h1>{t('File history')}</h1>
        <div class="muted small">{t('Earlier versions of files saved in Monoform')}</div>
      </div>
    </header>
    {#if files.length}
      <label class="search"><Icon icon={Search} size={14} /><input class="input" placeholder={t('Find a file')} bind:value={query} /></label>
    {/if}
    {#if loading}
      <div class="empty-state"><span class="spinner"></span></div>
    {:else if error}
      <div class="empty-state">{error}</div>
    {:else if !files.length}
      <div class="empty-state">
        <p>{t('No versions kept yet.')}</p>
        <p class="muted small">{settings.value.historyOff ? t('File history is off (Settings → Files).') : t('Save a file and its earlier content is kept here.')}</p>
      </div>
    {:else}
      <ul class="files">
        {#each shown as f (f.path)}
          <li>
            <button class="file" onclick={() => workspace.openTool('history', f.path)}>
              <span class="nm">{basename(f.path)}{#if !f.exists}<span class="badge gone">{t('Deleted')}</span>{/if}</span>
              <span class="muted small dir" title={f.path}>{dirname(f.path)}</span>
              <span class="muted small">{tn('{n} version', '{n} versions', f.versions)} · {ago(f.last)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <footer class="muted small">
    <span>{settings.value.historyOff ? t('Kept versions use {used} of {limit} · new versions are not being kept.', { used: formatBytes(usage), limit: formatBytes(limit) }) : t('Kept versions use {used} of {limit}.', { used: formatBytes(usage), limit: formatBytes(limit) })}</span>
    <span class="spacer"></span>
    {#if path ? versions.length : files.length}<button class="btn ghost danger" onclick={() => void forget()}><Icon icon={Trash2} size={14} /> {path ? t('Forget this history') : t('Clear all history')}</button>{/if}
  </footer>
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    padding: 24px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .ttl {
    min-width: 0;
  }
  .ttl .small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-family: var(--font-display, inherit);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  h2 {
    margin: 12px 0 2px;
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: var(--fs-small);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .versions li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  .versions li:hover {
    background: var(--bg-hover);
  }
  .versions li.current {
    background: var(--accent-soft);
  }
  .when {
    display: flex;
    flex-direction: column;
    min-width: 9em;
  }
  .time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .what {
    flex: 1 1 14em;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
  }
  .acts {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  .badge {
    font-size: calc(11px * var(--ui-scale));
    padding: 1px 7px;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    white-space: nowrap;
  }
  .badge.gone {
    background: var(--bg-active);
    color: var(--text-muted);
    margin-left: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .search .input {
    flex: 1;
  }
  .file {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0 12px;
    text-align: left;
    padding: 8px 10px;
    border: none;
    background: none;
    border-radius: var(--radius);
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .file:hover {
    background: var(--bg-hover);
  }
  .file .nm {
    grid-column: 1;
    overflow-wrap: anywhere;
  }
  .file .dir {
    grid-column: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file > :last-child {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    white-space: nowrap;
  }
  footer {
    margin-top: auto;
    padding-top: 16px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
