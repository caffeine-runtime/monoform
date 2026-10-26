<script lang="ts">
  import { LANGUAGES, t, tn, type Lang } from '../../core/i18n';
  import { chooseLanguage, systemLanguage } from '../../core/language';
  import { updates } from '../../core/updates.svelte';
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
  import { aiModels } from '../../core/aimodels.svelte';
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
    { id: 'system', label: t('System', {}, 'theme') },
    { id: 'dark', label: t('Dark', {}, 'theme') },
    { id: 'light', label: t('Light', {}, 'theme') },
  ] as const;
  /** A translated sentence split around its {placeholders}, so they can be shown with markup. */
  const pieces = (s: string) => s.split(/(\{\w+\})/).filter(Boolean);

  function setFontSize(e: Event) {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 8 && v <= 32) settings.update((x) => (x.fontSize = v));
  }

  async function clearRecents() {
    if (await ui.confirm(t('Clear recent files?'), t('The list of recently opened files is emptied. The files themselves are not touched.'), t('Clear'), true)) settings.clearRecents();
  }

  onMount(() => {
    tab.status = { ...tab.status, type: t('Settings') };
    tab.handlers = { ...tab.handlers, getState: () => ({}) };
    void api.DataLocations().then((l) => (locations = l));
    void semantic.refresh();
    void aiModels.refresh();
  });

  let historyUsage = $state<number | null>(null);
  void api.HistoryUsage().then((n) => (historyUsage = n)).catch(() => {});

  let cliStatus = $state<{ installed: boolean; path: string; bundled: boolean } | null>(null);
  void api.CommandLineStatus().then((c) => (cliStatus = c)).catch(() => {});
  async function installCli() {
    try {
      const p = await api.InstallCommandLine();
      ui.toast(t('Installed {path}', { path: p }), 'success');
      cliStatus = await api.CommandLineStatus();
    } catch (e) {
      toastError(e);
    }
  }
  // The interface slider applies on release: rescaling the page while it is dragged moves the slider under the pointer.
  let dragScale = $state<number | null>(null);
</script>

<div class="wrap">
  <h2>{t('Settings')}</h2>
  <!-- Tiles side by side, as many columns as the window fits. -->
  <div class="tiles">

  <section class="card">
    <h3>{t('Appearance')}</h3>
    <div class="row">
      <label class="lbl" for="lang">{t('Language')}</label>
      <select id="lang" class="input" value={s.language ?? ''} onchange={(e) => void chooseLanguage((e.currentTarget as HTMLSelectElement).value as Lang | '')}>
        <option value="">{t('Like my computer ({language})', { language: LANGUAGES.find((l) => l.id === systemLanguage())!.name })}</option>
        {#each LANGUAGES as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      <span class="lbl">{t('Theme')}</span>
      <div class="seg" role="radiogroup" aria-label={t('Theme')}>
        {#each THEMES as th (th.id)}
          <button role="radio" aria-checked={s.theme === th.id} class:on={s.theme === th.id} onclick={() => theme.set(th.id)}>{th.label}</button>
        {/each}
      </div>
    </div>
    <label class="row check">
      <span class="lbl" title={t('Excalidraw and draw.io drawings, Mermaid and Graphviz diagrams. The files and exports keep their colours.')}>{t('Darken drawings and diagrams in the dark theme')}</span>
      <input type="checkbox" checked={!s.lightCanvases} onchange={(e) => theme.setDarkCanvas((e.target as HTMLInputElement).checked)} />
    </label>
    <label class="row check">
      <span class="lbl" title={t('Turns the animations off. Monoform also does this when your system asks for less motion.')}>{t('Reduce motion')}</span>
      <input type="checkbox" checked={s.reduceMotion} onchange={(e) => settings.update((x) => (x.reduceMotion = (e.target as HTMLInputElement).checked))} />
    </label>
    <div class="row">
      <label class="lbl" for="uis" title={t('Makes text, buttons and icons everywhere larger or smaller ({shortcuts})', { shortcuts: 'Ctrl+Alt+= / Ctrl+Alt+−' })}>{t('Interface size')}</label>
      <span class="scale">
        <input id="uis" type="range" min="0" max={UI_SCALES.length - 1} step="1" value={Math.max(0, UI_SCALES.findIndex((v) => Math.abs(v - (s.uiScale || 1)) < 1e-3))} oninput={(e) => (dragScale = UI_SCALES[+(e.target as HTMLInputElement).value])} onchange={(e) => { dragScale = null; settings.update((x) => (x.uiScale = UI_SCALES[+(e.target as HTMLInputElement).value])); }} />
        <span class="pct">{Math.round((dragScale ?? (s.uiScale || 1)) * 100)}%</span>
      </span>
    </div>
    <div class="row">
      <label class="lbl" for="fs">{t('Editor font size')}</label>
      <input id="fs" type="number" min="8" max="32" value={s.fontSize} onchange={setFontSize} />
    </div>
    <label class="row check">
      <span class="lbl">{t('Show the minimap in the code editor')}</span>
      <input type="checkbox" checked={!s.minimapOff} onchange={() => commands.execute('text.toggleMinimap')} />
    </label>
    <label class="row check">
      <span class="lbl">{t('Show spaces and tabs')}</span>
      <input type="checkbox" checked={s.showWhitespace} onchange={() => commands.execute('text.toggleWhitespace')} />
    </label>
    <label class="row check">
      <span class="lbl">{t('Wrap long lines in the text editor')}</span>
      <input type="checkbox" checked={s.wordWrap} onchange={(e) => settings.update((x) => (x.wordWrap = (e.target as HTMLInputElement).checked))} />
    </label>
  </section>

  <section class="card">
    <h3>{t('Files')}</h3>
    <label class="row check">
      <span class="lbl">{t('Show hidden files and folders')}</span>
      <input type="checkbox" checked={s.showHidden} onchange={(e) => settings.update((x) => (x.showHidden = (e.target as HTMLInputElement).checked))} />
    </label>
    <label class="row check">
      <span class="lbl">{t('Keep originals: save edited images as a copy next to them')}</span>
      <input type="checkbox" checked={s.imageKeepOriginal} onchange={(e) => settings.update((x) => (x.imageKeepOriginal = (e.target as HTMLInputElement).checked))} />
    </label>
    <label class="row check">
      <span class="lbl">{t('Open files in preview mode (read-only until you choose Edit in the status bar, or {shortcut})', { shortcut: formatShortcut('Mod+Alt+E') })}</span>
      <input type="checkbox" checked={s.openInPreview} onchange={(e) => settings.update((x) => (x.openInPreview = (e.target as HTMLInputElement).checked))} />
    </label>
    <div class="row">
      <span class="lbl">{#each pieces(t('Command line: {open} opens files, {hash}, {verify}, {info} and {convert} work in scripts')) as p}{#if p === '{open}'}<code>monoform FILE</code>{:else if p === '{hash}'}<code>monoform hash *.iso</code>{:else if p === '{verify}'}<code>verify</code>{:else if p === '{info}'}<code>info</code>{:else if p === '{convert}'}<code>convert</code>{:else}{p}{/if}{/each}{cliStatus?.installed ? ` (${t('installed: {path}', { path: cliStatus.path })})` : ''}</span> <!-- i18n-ignore -->
      {#if cliStatus && !cliStatus.installed && cliStatus.bundled}<button class="btn" onclick={installCli}>{t('Install the monoform command')}</button>{/if}
    </div>
    <div class="row">
      <span class="lbl">{t('New files')}</span>
      <button class="btn" onclick={() => commands.execute('file.newOf')}>{t('New document, spreadsheet, image…')} <span class="kbd">{formatShortcut('Mod+Alt+N')}</span></button>
    </div>
  </section>

  <section class="card">
    <h3>{t('File history')}</h3>
    <label class="row check">
      <span class="lbl">{t("Keep earlier versions of files saved in Monoform, to compare or restore ({shortcut} shows a file's history)", { shortcut: formatShortcut('Mod+Alt+Y') })}</span>
      <input type="checkbox" checked={!s.historyOff} onchange={(e) => settings.update((x) => (x.historyOff = !(e.target as HTMLInputElement).checked))} />
    </label>
    <div class="row">
      <label class="lbl" for="hmax">{t('Space for kept versions (oldest go first)')}</label>
      <select id="hmax" class="input" value={String(s.historyMaxMB || 2048)} onchange={(e) => settings.update((x) => (x.historyMaxMB = +(e.target as HTMLSelectElement).value))}>
        {#each [512, 1024, 2048, 5120, 10240] as mb (mb)}<option value={String(mb)}>{mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label class="lbl" for="hkeep">{t('Versions kept per file')}</label>
      <select id="hkeep" class="input" value={String(s.historyKeep || 100)} onchange={(e) => settings.update((x) => (x.historyKeep = +(e.target as HTMLSelectElement).value))}>
        {#each [20, 50, 100, 250, 1000] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </select>
    </div>
    <div class="row buttons">
      <span class="lbl muted">{historyUsage === null ? '' : t('In use: {size}.', { size: formatBytes(historyUsage) })} {t("Files over 256 MB aren't versioned.")}</span>
      <button class="btn" onclick={() => commands.execute('history.all')}>{t('Show all files')}</button>
    </div>
  </section>

  <section class="card">
    <h3>{t('Recent files')}</h3>
    <label class="row check">
      <span class="lbl">{t('Remember recently opened files and folders')}</span>
      <input type="checkbox" checked={!s.recentsOff} onchange={(e) => settings.setRecentsOff(!(e.target as HTMLInputElement).checked)} />
    </label>
    {#if s.recents.length}
      <ul class="recents" aria-label={t('Recent files')}>
        {#each s.recents as p (p)}
          <li>
            <button class="open" title={p} onclick={() => workspace.openPath(p)}>
              <span class="rn">{basename(p)}</span>
              <span class="rd">{tildify(dirname(p), boot.home)}</span>
            </button>
            <button class="icon-btn xs" title={t('Remove from recents')} aria-label={t('Remove {name} from recents', { name: basename(p) })} onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{s.recentsOff ? t('Recent files are not being recorded.') : t('No recent files.')}</p>
    {/if}
    <div class="row buttons">
      <button class="btn" disabled={!s.recents.length} onclick={clearRecents}>{t('Clear recent files ({n})', { n: s.recents.length })}</button>
      <button class="btn" disabled={!s.recentFolders.length} onclick={() => settings.clearRecentFolders()}>{t('Clear recent folders ({n})', { n: s.recentFolders.length })}</button>
    </div>
  </section>

  <section class="card">
    <h3>{t('Search by meaning')}</h3>
    <div class="row">
      <span class="lbl">{semantic.enabled ? t('On', {}, 'search') : t('Off', {}, 'search')}{semantic.info?.installed ? ` · ${t('model downloaded')}` : ''}</span>
      <button class="btn" onclick={() => workspace.openTool('semantic')}>{t('Open settings…')}</button>
    </div>
  </section>

  <section class="card ai">
    <h3>{t('Add-ons')}</h3>
    <p class="muted small">{t('Optional downloads for the image editor. They run on this computer only, and only while you use them.')}</p>
    {#if aiModels.missing.length > 1}
      <div class="row all">
        <span class="lbl muted small">{tn('{n} model isn’t downloaded yet.', '{n} models aren’t downloaded yet.', aiModels.missing.length)}</span>
        <button class="btn" onclick={() => aiModels.installAll()}>{t('Download all ({size})', { size: formatBytes(aiModels.downloadSize(aiModels.missing)) })}</button>
      </div>
    {/if}
    {#each aiModels.packs as p (p.id)}
      <div class="row pack" data-pack={p.id}>
        <div class="lbl">
          <div><b>{p.name}</b>{#if p.installed}<span class="tag">{t('Installed')}</span>{/if}</div>
          <div class="muted small">{p.purpose}</div>
          <div class="muted small">{p.model} ({p.license}) · {p.installed ? formatBytes(p.disk) : t('{size} download', { size: formatBytes(p.download) })}</div>
        </div>
        {#if p.installed}
          <button class="btn" onclick={() => aiModels.remove(p.id)}>{t('Remove')}</button>
        {:else if !p.supported}
          <span class="muted small">{t('Not available on this system')}</span>
        {:else}
          {@const pr = aiModels.progress[p.id]}
          <button class="btn primary" disabled={pr !== undefined} onclick={() => aiModels.install(p.id)}>{pr === undefined ? t('Install') : pr > 0 ? t('Downloading… {percent}%', { percent: Math.floor(pr * 100) }) : t('Downloading…')}</button>
        {/if}
      </div>
    {/each}
  </section>

  <section class="card">
    <h3>{t('About')}</h3>
    {#if boot.store}
      <div class="row"><span class="lbl">{t('The Microsoft Store keeps Monoform up to date.')}</span></div>
    {:else}
      <label class="row check">
        <span class="lbl" title={t('One request to GitHub when Monoform starts; nothing about you or this computer is sent.')}>{t('Look for a new version when Monoform starts')}</span>
        <input type="checkbox" checked={!s.updateCheckOff} onchange={(e) => settings.update((x) => (x.updateCheckOff = !(e.target as HTMLInputElement).checked))} />
      </label>
      <label class="row check">
        <span class="lbl" title={t('Test versions built from work in progress: the newest features, tested less. Off, you get normal releases only; a nightly you have stays until the next release.')}>{t('Also offer nightly builds')}</span>
        <input
          type="checkbox"
          checked={!!s.nightlyUpdates}
          onchange={(e) => {
            settings.update((x) => (x.nightlyUpdates = (e.target as HTMLInputElement).checked));
            void settings.flush(); // the next check reads it from the settings file
          }}
        />
      </label>
      <div class="row">
        <span class="lbl">
          {#if updates.checking}{t('Checking…')}{:else if updates.info?.available}{t('Version {version} is available.', { version: updates.info.version })}{:else if updates.info}{t('Monoform is up to date.')}{:else if updates.error}{t('Couldn’t check: {error}', { error: updates.error })}{/if}
        </span>
        {#if updates.info?.available}
          <button class="btn primary" onclick={() => updates.offer(updates.info!)}>{t('Update…')}</button>
        {:else}
          <button class="btn" disabled={updates.checking} onclick={() => updates.check(false)}>{t('Check now')}</button>
        {/if}
      </div>
    {/if}
    <div class="grid">
      <span class="muted">{t('Version')}</span><span class="selectable">{boot.version}</span>
      <span class="muted">{t('Settings file')}</span><span class="selectable mono">{locations ? tildify(locations.settings, boot.home) : '…'}</span>
      <span class="muted">{t('Cache')}</span><span class="selectable mono">{locations ? tildify(locations.cache, boot.home) : '…'}</span>
      <span class="muted">{t('File history')}</span><span class="selectable mono">{locations ? tildify(locations.history, boot.home) : '…'}</span>
    </div>
    <p class="muted small">{t('Monoform works offline, sends no telemetry and needs no account.')}</p>
  </section>
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    padding: 28px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 1680px;
    width: 100%;
    margin: 0 auto;
  }
  .tiles {
    columns: 22rem auto;
    column-gap: 14px;
    /* As tall as its tiles (the page scrolls): squeezed to the window's height, the
       columns would spill sideways off the page, out of reach (WebView2). */
    flex: none;
  }
  /* Inline boxes: a block's margin would carry over to the next column's top. */
  .tiles > .card {
    break-inside: avoid;
    display: inline-flex;
    width: 100%;
    vertical-align: top;
    margin-bottom: 14px;
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
    /* Long paths and commands wrap inside the tile instead of running out of it. */
    min-width: 0;
    overflow-wrap: anywhere;
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
    border-radius: 4px;
    padding: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    white-space: nowrap;
    padding: 4px 14px;
    border-radius: 4px;
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
  .pack {
    align-items: flex-start;
    gap: 16px;
  }
  .pack .lbl {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tag {
    margin-left: 8px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-small);
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
