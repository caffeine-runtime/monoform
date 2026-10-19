<script lang="ts">
  import { workspace } from '../core/tabs.svelte';
  import { modules } from '../core/modules';
  import { jobs } from '../core/jobs.svelte';
  import { formatBytes } from '../core/paths';
  import Icon from './Icon.svelte';
  import { X } from '../core/icons';

  const tab = $derived(workspace.active);
  const typeLabel = $derived(tab ? (tab.status.type ?? modules.get(tab.moduleId)?.name ?? '') : '');
  const visibleJobs = $derived(jobs.list.filter((j) => j.visible));
</script>

<footer class="status">
  <div class="left">
    {#if tab}
      <span>{typeLabel}</span>
      {#if tab.size != null}<span>{formatBytes(tab.size)}</span>{/if}
      {#if tab.readOnly}<span>Read-only</span>{/if}
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
        <button class="icon-btn xs" title="Cancel" onclick={() => jobs.cancel(j.id)}><Icon icon={X} size={12} /></button>
      </span>
    {/each}
  </div>
  <div class="right">
    {#if tab}
      {#if tab.status.position}<span>{tab.status.position}</span>{/if}
      {#if tab.status.eol}<span>{tab.status.eol}</span>{/if}
      {#if tab.status.encoding}<span>{tab.status.encoding}</span>{/if}
    {/if}
  </div>
</footer>

<style>
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
    width: 120px;
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
    width: 18px;
    height: 18px;
    border-radius: 5px;
  }
</style>
