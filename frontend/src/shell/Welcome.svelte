<script lang="ts">
  import type { Component } from 'svelte';
  import Icon from './Icon.svelte';
  import { Braces, Command, FileSpreadsheet, FileText, FolderOpen, Globe, Hash, ImageIcon, NotebookPen, PenTool, Table, Type, X } from '../core/icons';
  import { commands } from '../core/commands';
  import { formatShortcut } from '../core/keys';
  import { NEW_KINDS, newFileOfKind } from '../core/newfile';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { basename, dirname, tildify } from '../core/paths';
  import { boot } from '../core/boot';

  // One button per kind of new file.
  const ICONS: Record<string, Component<any>> = {
    markdown: NotebookPen,
    docx: FileText,
    xlsx: FileSpreadsheet,
    csv: Table,
    image: ImageIcon,
    svg: PenTool,
    html: Globe,
    json: Braces,
    text: Type,
  };
  const kinds = NEW_KINDS.filter((k) => ICONS[k.kind]);

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
    <p class="tag">Documents, spreadsheets, PDFs, images, 3D models, audio, video, data and archives — one calm window.</p>

    <div class="sechead">
      <h3>New</h3>
      {#if commands.shortcutOf('file.newOf')}<button class="more" title="All new-file types" onclick={() => commands.execute('file.newOf')}><span class="kbd">{formatShortcut(commands.shortcutOf('file.newOf')!)}</span></button>{/if}
    </div>
    <div class="kinds">
      {#each kinds as k (k.kind)}
        <button class="kind" data-kind={k.kind} title="New {k.label.toLowerCase()} — {k.detail}" onclick={() => void newFileOfKind(undefined, k.kind)}>
          <Icon icon={ICONS[k.kind]} size={16} />
          <span class="kn">{k.label}</span>
        </button>
      {/each}
    </div>

    <div class="sechead"><h3>Open</h3></div>
    <div class="actions">
      {#each actions as a (a.id)}
        {@const sc = commands.shortcutOf(a.id)}
        <button class="action" onclick={() => commands.execute(a.id)}>
          <Icon icon={a.icon} size={16} />
          <span class="al">{a.label}</span>
          {#if sc}<span class="kbd">{formatShortcut(sc)}</span>{/if}
        </button>
      {/each}
    </div>

    {#if settings.value.recents.length}
      <div class="sechead"><h3>Recent</h3></div>
      <div class="recents">
        {#each settings.value.recents.slice(0, 8) as p (p)}
          <div class="rrow">
            <button class="recent" title={p} onclick={() => workspace.openPath(p)}>
              <span class="rn">{basename(p)}</span>
              <span class="rd">{tildify(dirname(p), boot.home)}</span>
            </button>
            <button class="rm icon-btn xs" title="Remove from recents" aria-label="Remove {basename(p)} from recents" onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
          </div>
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
    width: min(640px, 100%);
    padding: 10vh 28px 40px;
  }
  h1 {
    font-size: 34px;
    margin: 0 0 6px;
  }
  .tag {
    color: var(--text-muted);
    margin: 0 0 8px;
    font-size: 14px;
  }
  .sechead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 28px 0 10px;
  }
  h3 {
    font-size: 15px;
    margin: 0;
    color: var(--text-muted);
  }
  .more {
    margin-left: auto;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }
  .kind :global(svg),
  .action :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .kind:hover {
    background: var(--bg-active);
  }
  .kn {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }
  .action:hover {
    background: var(--bg-active);
  }
  :global([data-theme='dark']) .action,
  :global([data-theme='dark']) .kind {
    background: var(--bg-hover);
  }
  :global([data-theme='dark']) .action:hover,
  :global([data-theme='dark']) .kind:hover {
    background: var(--bg-active);
  }
  .al {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 560px) {
    .kinds {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .actions {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .rrow {
    position: relative;
  }
  .rrow .rm {
    position: absolute;
    right: -4px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
  }
  .rrow:hover .rm,
  .rrow .rm:focus-visible {
    opacity: 1;
  }
  .rrow:hover .rd {
    visibility: hidden;
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
    width: calc(100% + 20px);
    border: none;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
  }
  .recent:hover {
    background: var(--bg-hover);
  }
  .rn {
    flex: none;
  }
  .rd {
    min-width: 0;
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
