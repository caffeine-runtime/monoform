<script lang="ts">
  // Hosts one tab's module. The module chunk loads on first activation and the
  // component stays mounted (hidden) while the tab is open, so editor state,
  // undo history and scroll position survive tab switches.
  import { modules, type LoadedModule } from '../core/modules';
  import { workspace, type Tab } from '../core/tabs.svelte';
  import ExternalChangeBanner from './ExternalChangeBanner.svelte';

  let { tab }: { tab: Tab } = $props();
  const active = $derived(workspace.activeId === tab.id);
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

<div class="tabview" class:active data-module={tab.moduleId} role="tabpanel" aria-hidden={!active}>
  {#if tab.external}
    <ExternalChangeBanner {tab} />
  {/if}
  <div class="body">
    {#if error}
      <div class="empty-state">{error}</div>
    {:else if mod}
      {@const C = mod.default}
      <C {tab} />
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
  .tabview.active {
    display: flex;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
</style>
