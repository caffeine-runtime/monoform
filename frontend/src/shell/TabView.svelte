<script lang="ts">
  // Hosts one tab's module. The module chunk loads on first activation and the
  // component stays mounted (hidden) while the tab is open, so editor state,
  // undo history and scroll position survive tab switches.
  import { modules, type LoadedModule } from '../core/modules';
  import { workspace, type Tab } from '../core/tabs.svelte';
  import ExternalChangeBanner from './ExternalChangeBanner.svelte';
  import { paneRect } from '../core/split';

  let { tab }: { tab: Tab } = $props();
  const active = $derived(workspace.activeId === tab.id);
  const shown = $derived(workspace.isShown(tab.id));
  // In split view the tab sits in its pane; the focused pane is outlined.
  const rect = $derived.by(() => {
    const s = workspace.split;
    const i = s ? s.panes.indexOf(tab.id) : -1;
    return s && i >= 0 ? paneRect(s, i) : null;
  });
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  let mod = $state<LoadedModule | null>(null);
  let error = $state('');
  let slow = $state(false);

  $effect(() => {
    const id = tab.moduleId;
    mod = null;
    error = '';
    const t = setTimeout(() => (slow = true), 150);
    modules
      .load(id)
      .then((m) => {
        if (tab.moduleId === id) mod = m;
      })
      .catch((e) => (error = `Couldn't load the ${id} module: ${e?.message ?? e}`))
      .finally(() => {
        clearTimeout(t);
        slow = false;
      });
    return () => clearTimeout(t);
  });
</script>

<div
  class="tabview"
  class:active
  class:shown
  class:pane={!!rect}
  data-module={tab.moduleId}
  data-tab-id={tab.id}
  role="tabpanel"
  aria-hidden={!shown}
  style:left={rect ? pct(rect.left) : null}
  style:top={rect ? pct(rect.top) : null}
  style:width={rect ? pct(rect.width) : null}
  style:height={rect ? pct(rect.height) : null}
  onpointerdowncapture={() => !active && shown && workspace.activate(tab)}
  onfocusin={() => !active && shown && workspace.activate(tab)}
>
  {#if tab.external}
    <ExternalChangeBanner {tab} />
  {/if}
  <div class="body">
    {#if error}
      <div class="empty-state">{error}</div>
    {:else if mod}
      {@const C = mod.default}
      {#key tab.mountKey}
        <C {tab} />
      {/key}
    {:else if slow}
      <div class="empty-state"><span class="spinner"></span></div>
    {/if}
  </div>
</div>

<style>
  .tabview {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    background: var(--bg);
  }
  .tabview.shown {
    display: flex;
  }
  .tabview.pane {
    inset: auto;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    overflow: hidden;
  }
  .tabview.pane.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    z-index: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
</style>
