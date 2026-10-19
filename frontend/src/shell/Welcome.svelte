<script lang="ts">
  import Icon from './Icon.svelte';
  import { Command, FileText, FolderOpen, Hash } from '../core/icons';
  import { commands } from '../core/commands';
  import { formatShortcut } from '../core/keys';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { basename, dirname, tildify } from '../core/paths';
  import { boot } from '../core/boot';

  const actions = [
    { id: 'file.open', label: 'Open file', icon: FileText },
    { id: 'file.openFolder', label: 'Open folder', icon: FolderOpen },
    { id: 'tools.hash', label: 'Check a file hash', icon: Hash },
    { id: 'app.palette', label: 'All commands', icon: Command },
  ];
</script>

<div class="welcome">
  <div class="inner">
    <h1>Hold It All</h1>
    <p class="tag">Text, markdown, PDFs, images, data, archives and hashes — one calm window.</p>
    <div class="actions">
      {#each actions as a (a.id)}
        {@const sc = commands.shortcutOf(a.id)}
        <button class="action" onclick={() => commands.execute(a.id)}>
          <Icon icon={a.icon} size={18} />
          <span class="al">{a.label}</span>
          {#if sc}<span class="kbd">{formatShortcut(sc)}</span>{/if}
        </button>
      {/each}
    </div>
    {#if settings.value.recents.length}
      <h3>Recent</h3>
      <div class="recents">
        {#each settings.value.recents.slice(0, 8) as p (p)}
          <button class="recent" title={p} onclick={() => workspace.openPath(p)}>
            <span class="rn">{basename(p)}</span>
            <span class="rd">{tildify(dirname(p), boot.home)}</span>
          </button>
        {/each}
      </div>
    {/if}
    <p class="hint">Drop files anywhere in this window to open them.</p>
  </div>
</div>

<style>
  .welcome {
    height: 100%;
    overflow: auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .inner {
    width: min(560px, 100%);
    padding: 12vh 28px 40px;
  }
  h1 {
    font-size: 34px;
    margin: 0 0 6px;
  }
  .tag {
    color: var(--text-muted);
    margin: 0 0 28px;
    font-size: 14px;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }
  :global([data-theme='dark']) .action {
    background: var(--bg-hover);
  }
  .action:hover {
    background: var(--bg-active) !important;
  }
  .al {
    flex: 1;
  }
  h3 {
    font-size: 15px;
    margin: 32px 0 8px;
    color: var(--text-muted);
  }
  .recents {
    display: flex;
    flex-direction: column;
  }
  .recent {
    display: flex;
    align-items: baseline;
    gap: 10px;
    height: 30px;
    padding: 0 10px;
    margin: 0 -10px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .recent:hover {
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
  .hint {
    margin-top: 36px;
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
</style>
