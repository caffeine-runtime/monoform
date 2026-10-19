<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TabBar from './TabBar.svelte';
  import TabView from './TabView.svelte';
  import StatusBar from './StatusBar.svelte';
  import Palette from './Palette.svelte';
  import Overlays from './Overlays.svelte';
  import Welcome from './Welcome.svelte';
  import QuickPick from './QuickPick.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { settings } from '../core/settings.svelte';
  import { theme } from '../core/theme.svelte';
  import { tree } from '../core/tree.svelte';
  import { ui } from '../core/ui.svelte';
  import { api } from '../core/backend';
  import { boot } from '../core/boot';

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

  // Persist the session whenever tabs, the active tab, folder or tree change.
  $effect(() => {
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
    const title = t ? `${t.dirty ? '• ' : ''}${t.title} — Hold It All` : 'Hold It All';
    document.title = title;
    void api.SetTitle(title);
  });
  $effect(() => {
    void api.SetDirtyCount(workspace.dirtyCount);
  });
  $effect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${settings.value.fontSize}px`);
  });
</script>

<div class="app" data-platform={boot.platform}>
  {#if settings.value.sidebarVisible}
    <Sidebar />
  {/if}
  <main class="main">
    <TabBar />
    <div class="views">
      {#each workspace.tabs as tab (tab.id)}
        {#if tab.mounted}
          <TabView {tab} />
        {/if}
      {/each}
      {#if workspace.tabs.length === 0}
        <Welcome />
      {/if}
    </div>
  </main>
  <div class="statusbar"><StatusBar /></div>
</div>

{#if ui.paletteOpen}
  <Palette />
{/if}
{#if ui.picker}
  <QuickPick />
{/if}
<Overlays />

<style>
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
  .statusbar {
    grid-column: 1 / -1;
    grid-row: 2;
  }
</style>
