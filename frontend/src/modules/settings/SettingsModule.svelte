<script lang="ts">
  import { UI_SCALES } from '../../core/appCommands';
  // Settings: appearance, files, recents (with per-item removal and
  // clearing), search by meaning, and where the app keeps its data.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import { X } from '../../core/icons';
  import { api } from '../../core/backend';
  import { settings } from '../../core/settings.svelte';
  import { theme } from '../../core/theme.svelte';
  import { semantic } from '../../core/semantic/semantic.svelte';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { basename, dirname, formatBytes, tildify } from '../../core/paths';
  import { boot } from '../../core/boot';
  import { commands } from '../../core/commands';
  import { formatShortcut } from '../../core/keys';
  import { toastError, ui } from '../../core/ui.svelte';

  let { tab }: { tab: Tab } = $props();
  let locations = $state<{ settings: string; cache: string; history: string } | null>(null);

  const s = $derived(settings.value);
  const THEMES = [
    { id: 'system', label: 'System' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ] as const;

  function setFontSize(e: Event) {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 8 && v <= 32) settings.update((x) => (x.fontSize = v));
  }

  async function clearRecents() {
    if (await ui.confirm('Clear recent files?', 'The list of recently opened files is emptied. The files themselves are not touched.', 'Clear', true)) settings.clearRecents();
  }

  onMount(() => {
    tab.status = { ...tab.status, type: 'Settings' };
    tab.handlers = { ...tab.handlers, getState: () => ({}) };
    void api.DataLocations().then((l) => (locations = l));
    void semantic.refresh();
  });

  let historyUsage = $state<number | null>(null);
  void api.HistoryUsage().then((n) => (historyUsage = n)).catch(() => {});

  let cliStatus = $state<{ installed: boolean; path: string; bundled: boolean } | null>(null);
  void api.CommandLineStatus().then((c) => (cliStatus = c)).catch(() => {});
  async function installCli() {
    try {
      const p = await api.InstallCommandLine();
      ui.toast(`Installed ${p}`, 'success');
      cliStatus = await api.CommandLineStatus();
    } catch (e) {
      toastError(e);
    }
  }
</script>

<div class="wrap">
  <h2>Settings</h2>

  <section class="card">
    <h3>Appearance</h3>
    <div class="row">
      <span class="lbl">Theme</span>
      <div class="seg" role="radiogroup" aria-label="Theme">
        {#each THEMES as t (t.id)}
          <button role="radio" aria-checked={s.theme === t.id} class:on={s.theme === t.id} onclick={() => theme.set(t.id)}>{t.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <label class="lbl" for="uis" title="Makes text, buttons and icons everywhere larger or smaller (Ctrl+Alt+= / Ctrl+Alt+−)">Interface size</label>
      <span class="scale">
        <input id="uis" type="range" min="0" max={UI_SCALES.length - 1} step="1" value={Math.max(0, UI_SCALES.findIndex((v) => Math.abs(v - (s.uiScale || 1)) < 1e-3))} oninput={(e) => settings.update((x) => (x.uiScale = UI_SCALES[+(e.target as HTMLInputElement).value]))} />
        <span class="pct">{Math.round((s.uiScale || 1) * 100)}%</span>
      </span>
    </div>
    <div class="row">
      <label class="lbl" for="fs">Editor font size</label>
      <input id="fs" type="number" min="8" max="32" value={s.fontSize} onchange={setFontSize} />
    </div>
    <label class="row check">
      <span class="lbl">Show the minimap in the code editor</span>
      <input type="checkbox" checked={!s.minimapOff} onchange={() => commands.execute('text.toggleMinimap')} />
    </label>
    <label class="row check">
      <span class="lbl">Show spaces and tabs</span>
      <input type="checkbox" checked={s.showWhitespace} onchange={() => commands.execute('text.toggleWhitespace')} />
    </label>
    <label class="row check">
      <span class="lbl">Wrap long lines in the text editor</span>
      <input type="checkbox" checked={s.wordWrap} onchange={(e) => settings.update((x) => (x.wordWrap = (e.target as HTMLInputElement).checked))} />
    </label>
  </section>

  <section class="card">
    <h3>Files</h3>
    <label class="row check">
      <span class="lbl">Show hidden files and folders</span>
      <input type="checkbox" checked={s.showHidden} onchange={(e) => settings.update((x) => (x.showHidden = (e.target as HTMLInputElement).checked))} />
    </label>
    <label class="row check">
      <span class="lbl">Keep originals: save edited images as a copy next to them</span>
      <input type="checkbox" checked={s.imageKeepOriginal} onchange={(e) => settings.update((x) => (x.imageKeepOriginal = (e.target as HTMLInputElement).checked))} />
    </label>
    <label class="row check">
      <span class="lbl">Open files in preview mode (read-only until you choose Edit in the status bar, or {formatShortcut('Mod+Alt+E')})</span>
      <input type="checkbox" checked={s.openInPreview} onchange={(e) => settings.update((x) => (x.openInPreview = (e.target as HTMLInputElement).checked))} />
    </label>
    <div class="row">
      <span class="lbl">Command line: <code>holdit FILE</code> opens files, <code>holdit hash *.iso</code>, <code>verify</code>, <code>info</code> and <code>convert</code> work in scripts{cliStatus?.installed ? ` (installed: ${cliStatus.path})` : ''}</span>
      {#if cliStatus && !cliStatus.installed && cliStatus.bundled}<button class="btn" onclick={installCli}>Install the holdit command</button>{/if}
    </div>
    <div class="row">
      <span class="lbl">New files</span>
      <button class="btn" onclick={() => commands.execute('file.newOf')}>New document, spreadsheet, image… <span class="kbd">{formatShortcut('Mod+Alt+N')}</span></button>
    </div>
  </section>

  <section class="card">
    <h3>File history</h3>
    <label class="row check">
      <span class="lbl">Keep earlier versions of files saved in Hold It All, to compare or restore ({formatShortcut('Mod+Alt+Y')} shows a file's history)</span>
      <input type="checkbox" checked={!s.historyOff} onchange={(e) => settings.update((x) => (x.historyOff = !(e.target as HTMLInputElement).checked))} />
    </label>
    <div class="row">
      <label class="lbl" for="hmax">Space for kept versions (oldest go first)</label>
      <select id="hmax" class="input" value={String(s.historyMaxMB || 2048)} onchange={(e) => settings.update((x) => (x.historyMaxMB = +(e.target as HTMLSelectElement).value))}>
        {#each [512, 1024, 2048, 5120, 10240] as mb (mb)}<option value={String(mb)}>{mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label class="lbl" for="hkeep">Versions kept per file</label>
      <select id="hkeep" class="input" value={String(s.historyKeep || 100)} onchange={(e) => settings.update((x) => (x.historyKeep = +(e.target as HTMLSelectElement).value))}>
        {#each [20, 50, 100, 250, 1000] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </select>
    </div>
    <div class="row buttons">
      <span class="lbl muted">{historyUsage === null ? '' : `In use: ${formatBytes(historyUsage)}.`} Files over 256 MB aren't versioned.</span>
      <button class="btn" onclick={() => commands.execute('history.all')}>Show all files</button>
    </div>
  </section>

  <section class="card">
    <h3>Recent files</h3>
    <label class="row check">
      <span class="lbl">Remember recently opened files and folders</span>
      <input type="checkbox" checked={!s.recentsOff} onchange={(e) => settings.setRecentsOff(!(e.target as HTMLInputElement).checked)} />
    </label>
    {#if s.recents.length}
      <ul class="recents" aria-label="Recent files">
        {#each s.recents as p (p)}
          <li>
            <button class="open" title={p} onclick={() => workspace.openPath(p)}>
              <span class="rn">{basename(p)}</span>
              <span class="rd">{tildify(dirname(p), boot.home)}</span>
            </button>
            <button class="icon-btn xs" title="Remove from recents" aria-label="Remove {basename(p)} from recents" onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{s.recentsOff ? 'Recent files are not being recorded.' : 'No recent files.'}</p>
    {/if}
    <div class="row buttons">
      <button class="btn" disabled={!s.recents.length} onclick={clearRecents}>Clear recent files ({s.recents.length})</button>
      <button class="btn" disabled={!s.recentFolders.length} onclick={() => settings.clearRecentFolders()}>Clear recent folders ({s.recentFolders.length})</button>
    </div>
  </section>

  <section class="card">
    <h3>Search by meaning</h3>
    <div class="row">
      <span class="lbl">{semantic.enabled ? 'On' : 'Off'}{semantic.info?.installed ? ' · model downloaded' : ''}</span>
      <button class="btn" onclick={() => workspace.openTool('semantic')}>Open settings…</button>
    </div>
  </section>

  <section class="card">
    <h3>About</h3>
    <div class="grid">
      <span class="muted">Version</span><span class="selectable">{boot.version}</span>
      <span class="muted">Settings file</span><span class="selectable mono">{locations ? tildify(locations.settings, boot.home) : '…'}</span>
      <span class="muted">Cache</span><span class="selectable mono">{locations ? tildify(locations.cache, boot.home) : '…'}</span>
      <span class="muted">File history</span><span class="selectable mono">{locations ? tildify(locations.history, boot.home) : '…'}</span>
    </div>
    <p class="muted small">Hold It All works offline, sends no telemetry and needs no account.</p>
  </section>
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    padding: 28px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  h2 {
    margin: 0 0 4px;
    font-size: calc(20px * var(--ui-scale));
  }
  h3 {
    margin: 0;
    font-size: calc(14px * var(--ui-scale));
  }
  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  :global([data-theme='dark']) .card {
    background: var(--bg-sidebar);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px 16px;
    min-height: 30px;
  }
  /* A label keeps a readable width; when the row is too narrow its control
     moves under it instead of squeezing the label into a column. */
  .row > .lbl {
    flex: 1 1 14em;
  }
  .row.check > .lbl {
    flex-basis: 0;
  }
  .row.check {
    cursor: pointer;
  }
  .row.buttons {
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 8px;
  }
  input[type='number'] {
    width: 72px;
  }
  .seg {
    display: inline-flex;
    background: var(--bg-hover);
    border-radius: 8px;
    padding: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    white-space: nowrap;
    padding: 4px 14px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
  }
  .seg button.on {
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.2));
  }
  .recents {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 280px;
    overflow: auto;
  }
  .recents li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .recents .open {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 10px;
    align-items: baseline;
    border: none;
    background: transparent;
    padding: 5px 8px;
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .recents .open:hover {
    background: var(--bg-hover);
  }
  .rn {
    flex: none;
  }
  .rd {
    color: var(--text-faint);
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
  }
  .muted {
    color: var(--text-muted);
    margin: 0;
  }
  .small {
    font-size: var(--fs-small);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.92em;
    word-break: break-all;
  }
  .scale {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pct {
    min-width: 3em;
    font-variant-numeric: tabular-nums;
  }
</style>
