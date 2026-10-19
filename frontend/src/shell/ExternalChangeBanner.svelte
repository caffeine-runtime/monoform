<script lang="ts">
  import Icon from './Icon.svelte';
  import { AlertTriangle } from '../core/icons';
  import { workspace, type Tab } from '../core/tabs.svelte';

  let { tab }: { tab: Tab } = $props();
</script>

<div class="banner" role="alert">
  <Icon icon={AlertTriangle} />
  <span class="grow">
    {#if tab.external === 'deleted'}
      <strong>{tab.title}</strong> was moved or deleted on disk.{tab.dirty ? '' : ' Save to recreate it.'}
    {:else if tab.dirty}
      <strong>{tab.title}</strong> changed on disk, and you have unsaved changes here.
    {:else}
      <strong>{tab.title}</strong> changed on disk.
    {/if}
  </span>
  {#if tab.external === 'changed'}
    <button class="btn primary" onclick={() => workspace.reloadTab(tab)}>{tab.dirty ? 'Discard mine & reload' : 'Reload'}</button>
  {/if}
  <button class="btn ghost" onclick={() => (tab.external = null)}>{tab.external === 'changed' ? 'Keep mine' : 'Dismiss'}</button>
</div>
