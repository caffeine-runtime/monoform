<script lang="ts">
  import Icon from './Icon.svelte';
  import { AlertTriangle } from '../core/icons';
  import { workspace, type Tab } from '../core/tabs.svelte';
  import { t } from '../core/i18n';

  let { tab }: { tab: Tab } = $props();
  // The sentence around the file's name (shown in bold).
  const around = (s: string) => s.split('{name}');
  const deleted = around(t('{name} was moved or deleted on disk.'));
  const conflict = around(t('{name} changed on disk, and you have unsaved changes here.'));
  const changed = around(t('{name} changed on disk.'));
</script>

<div class="banner" role="alert">
  <Icon icon={AlertTriangle} />
  <span class="grow">
    {#if tab.external === 'deleted'}
      {deleted[0]}<strong>{tab.title}</strong>{deleted[1]}{tab.dirty ? '' : ` ${t('Save to recreate it.')}`}
    {:else if tab.dirty}
      {conflict[0]}<strong>{tab.title}</strong>{conflict[1]}
    {:else}
      {changed[0]}<strong>{tab.title}</strong>{changed[1]}
    {/if}
  </span>
  {#if tab.external === 'changed'}
    <button class="btn primary" onclick={() => workspace.reloadTab(tab)}>{tab.dirty ? t('Discard mine & reload') : t('Reload')}</button>
  {/if}
  <button class="btn ghost" onclick={() => (tab.external = null)}>{tab.external === 'changed' ? t('Keep mine') : t('Dismiss')}</button>
</div>
