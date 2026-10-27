<script lang="ts">
  import { workspace } from '../core/tabs.svelte';
  import { modules } from '../core/modules';
  import { jobs } from '../core/jobs.svelte';
  import { formatBytes } from '../core/paths';
  import Icon from './Icon.svelte';
  import { X } from '../core/icons';
  import { t } from '../core/i18n';
  import { peek } from '../core/peek.svelte';

  const tab = $derived(workspace.active);
  const typeLabel = $derived(tab ? (tab.status.type ?? modules.get(tab.moduleId)?.name ?? '') : '');
  const visibleJobs = $derived(jobs.list.filter((j) => j.visible));
</script>

<footer class="status">
  <div class="left">
    {#if tab}
      <span>{typeLabel}</span>
      {#if tab.size != null}<span>{formatBytes(tab.size)}</span>{/if}
      {#if peek.on}
        <!-- The quick view's bar has Edit. -->
      {:else if tab.preview}
        <button class="mode" title={t("Preview mode: the file can't be changed. Click to edit it.")} onclick={() => void workspace.setPreview(tab, false)}>{t('Preview')} · <b>{t('Edit')}</b></button>
      {:else if tab.readOnly}<span>{t('Read-only')}</span>
      {:else if tab.source.kind === 'file'}
        <button class="mode quiet" title={t('Editing. Click for preview mode (read-only).')} onclick={() => void workspace.setPreview(tab, true)}>{t('Editing')}</button>
      {/if}
      {#if tab.status.info}<span class="info">{tab.status.info}</span>{/if}
    {/if}
  </div>
  <div class="jobs">
    {#each visibleJobs as j (j.id)}
      <span class="job" title={j.message || j.label}>
        <span class="spinner"></span>
        <span class="jl">{j.label}</span>
        {#if j.total > 0}
          <span class="bar"><span style:width="{Math.min(100, (j.done / j.total) * 100)}%"></span></span>
          <span class="pct">{Math.floor((j.done / j.total) * 100)}%</span>
        {:else if j.done > 0}
          <span class="pct">{j.message || j.done}</span>
        {/if}
        <button class="icon-btn xs" title={t('Cancel')} onclick={() => jobs.cancel(j.id)}><Icon icon={X} size={12} /></button>
      </span>
    {/each}
  </div>
  <div class="right">
    {#if tab}
      {#if tab.status.counts}<span class="counts">{tab.status.counts}</span>{/if}
      {#if tab.status.position}<span>{tab.status.position}</span>{/if}
      {#if tab.status.eol}<span>{tab.status.eol}</span>{/if}
      {#if tab.status.encoding}<span>{tab.status.encoding}</span>{/if}
    {/if}
  </div>
</footer>

<style>
  .mode {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    padding: 0 4px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mode:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .mode b {
    color: var(--accent-text);
    font-weight: 600;
  }
  .mode.quiet {
    opacity: 0.8;
  }
  .status {
    height: var(--statusbar-h);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    background: var(--bg-sidebar);
    flex: none;
    white-space: nowrap;
    overflow: hidden;
  }
  .left,
  .right {
    display: flex;
    gap: 14px;
    align-items: center;
    min-width: 0;
  }
  .counts {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .left .info {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .jobs {
    flex: 1;
    display: flex;
    justify-content: center;
    gap: 16px;
    min-width: 0;
  }
  .job {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  .job .spinner {
    width: 11px;
    height: 11px;
    border-width: 1.5px;
  }
  .jl {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    width: calc(120px * var(--ui-scale));
    height: 4px;
    border-radius: 4px;
    background: var(--bg-active);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.15s linear;
  }
  .pct {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .icon-btn.xs {
    width: calc(18px * var(--ui-scale));
    height: calc(18px * var(--ui-scale));
    border-radius: 3px;
  }
</style>
