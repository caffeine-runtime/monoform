<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TabBar from './TabBar.svelte';
  import TabView from './TabView.svelte';
  import SplitOverlay from './SplitOverlay.svelte';
  import TransferOverlay from './TransferOverlay.svelte';
  import StatusBar from './StatusBar.svelte';
  import Palette from './Palette.svelte';
  import Overlays from './Overlays.svelte';
  import Welcome from './Welcome.svelte';
  import QuickPick from './QuickPick.svelte';
  import PathBar from './PathBar.svelte';
  import Icon from './Icon.svelte';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { workspace } from '../core/tabs.svelte';
  import { settings } from '../core/settings.svelte';
  import { theme } from '../core/theme.svelte';
  import { tree } from '../core/tree.svelte';
  import { ui } from '../core/ui.svelte';
  import { api } from '../core/backend';
  import { boot } from '../core/boot';
  import { t } from '../core/i18n';
  import { peek } from '../core/peek.svelte';

  // Apply the theme whenever it changes.
  $effect(() => {
    void theme.resolved;
    theme.apply();
  });

  // Mirror the folder into the tree.
  let lastRoot = '';
  $effect(() => {
    const root = workspace.folder;
    if (root === lastRoot) return;
    const expanded = lastRoot === '' ? settings.value.session.expanded : [];
    lastRoot = root;
    void tree.setRoot(root, expanded);
  });

  // Persist the session whenever tabs, the active tab, folder or tree change
  // (not while quick-peeking or in a window a tab was moved to: that would
  // replace the user's session).
  $effect(() => {
    if (peek.on || boot.extraWindow) return;
    void workspace.version;
    void workspace.tabs.length;
    void workspace.folder;
    void tree.expanded.size;
    const snap = workspace.snapshot(tree.expandedList(workspace.folder));
    settings.value.session = snap as typeof settings.value.session;
    settings.schedule(600);
  });

  // Window title and dirty tracking for the close prompt.
  $effect(() => {
    const t = workspace.active;
    const title = t ? `${t.dirty ? '• ' : ''}${t.title} — Monoform` : 'Monoform';
    document.title = title;
    void api.SetTitle(title);
  });
  $effect(() => {
    void api.SetDirtyCount(workspace.dirtyCount);
  });
  // Interface scale: design tokens, text, controls and icons follow --ui-scale. (CSS zoom
  // would be simpler but breaks pointer maths in canvas editors in WebKitGTK.)
  $effect(() => {
    const z = settings.value.uiScale || 1;
    document.documentElement.style.setProperty('--ui-scale', String(z));
    document.documentElement.style.setProperty('--editor-font-size', `${Math.round(settings.value.fontSize * z * 10) / 10}px`);
  });
</script>

<svelte:window onkeydown={(e) => peek.on && e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.modal, .palette, .quickpick') && void api.Quit(0)} />
<div class="app" data-platform={boot.platform} class:peek={peek.on} class:panels-hidden={settings.value.panelsHidden}>
  {#if settings.value.sidebarVisible && !peek.on}
    <Sidebar />
  {/if}
  <main class="main">
    {#if peek.on}
      <div class="peekbar">
        <span class="pt">{workspace.active?.title ?? ''}</span>
        <span class="pd">{t('Quick view · {key} closes', { key: 'Esc' })}</span>
        <span class="spacer"></span>
        <button class="btn primary edit" title={t('Edit in the full editor')} onclick={() => void peek.expand()}><Icon icon={Pencil} size={14} /> {t('Edit')}</button>
      </div>
    {:else}
      <TabBar />
    {/if}
    {#if !settings.value.pathBarOff}
      <PathBar />
    {/if}
    <div class="views" class:split={!!workspace.split}>
      {#each workspace.tabs as tab (tab.id)}
        {#if tab.mounted}
          <TabView {tab} />
        {/if}
      {/each}
      {#if workspace.tabs.length === 0}
        <Welcome />
      {/if}
      <SplitOverlay />
      <TransferOverlay />
    </div>
  </main>
  <div class="statusbar"><StatusBar /></div>
</div>

{#if ui.paletteOpen}
  <Palette />
{/if}
{#if ui.firstRun}
  {#await import('./FirstRun.svelte') then m}<m.default />{/await}
{/if}
{#if ui.picker}
  <QuickPick />
{/if}
<Overlays />

<style>
  .peekbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
  }
  .peekbar .pt {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peekbar .pd {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .peekbar .spacer {
    flex: 1;
  }
  .peekbar .edit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .app {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: 1fr auto;
    height: 100%;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    grid-column: 2;
    grid-row: 1;
  }
  .app > :global(.sidebar) {
    grid-column: 1;
    grid-row: 1;
  }
  .views {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }

  /* The gap colour between panes in split view. */
  .views.split {
    background: var(--bg-sidebar);
  }
  /* View › Show / hide side panels: editors' panels (layers, effects, properties) give their room to the content. */
  .app.panels-hidden :global([data-sidepanel]) {
    display: none !important;
  }
  .statusbar {
    grid-column: 1 / -1;
    grid-row: 2;
  }
</style>
