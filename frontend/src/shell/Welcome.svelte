<script lang="ts">
  // The start page: drop or open something, make something new, a few
  // handy tools, and the files you had open recently.
  import type { Component } from 'svelte';
  import Icon from './Icon.svelte';
  import { ArrowDownToLine, Braces, Camera, Command, Diff, FileSpreadsheet, FileText, FolderOpen, Globe, Hash, History, ImageIcon, NotebookPen, PenTool, Table, Type, X } from '../core/icons';
  import { commands } from '../core/commands';
  import { iconFor, kindOf } from '../core/fileicons';
  import { formatShortcut } from '../core/keys';
  import { NEW_KINDS, newFileOfKind } from '../core/newfile';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { basename, dirname, tildify } from '../core/paths';
  import { boot } from '../core/boot';

  // A tile per kind of new file, each with its own colour.
  const KIND: Record<string, { icon: Component<any>; hue: string }> = {
    markdown: { icon: NotebookPen, hue: '#5b8def' },
    docx: { icon: FileText, hue: '#3f7be0' },
    xlsx: { icon: FileSpreadsheet, hue: '#2f9e64' },
    csv: { icon: Table, hue: '#1f9e9a' },
    image: { icon: ImageIcon, hue: '#9b6ce0' },
    svg: { icon: PenTool, hue: '#e07b3f' },
    html: { icon: Globe, hue: '#d9a020' },
    json: { icon: Braces, hue: '#c9605a' },
    text: { icon: Type, hue: '#8a8a8a' },
  };
  const kinds = NEW_KINDS.filter((k) => KIND[k.kind]);

  const tools = [
    { id: 'tools.hash', label: 'Check a hash', icon: Hash },
    { id: 'screenshot.region', label: 'Screenshot', icon: Camera },
    { id: 'file.compare', label: 'Compare files', icon: Diff },
    { id: 'history.all', label: 'File history', icon: History },
    { id: 'app.palette', label: 'All commands', icon: Command },
  ];
  const tip = (label: string, id: string) => {
    const sc = commands.shortcutOf(id);
    return sc ? `${label} (${formatShortcut(sc)})` : label;
  };
</script>

<div class="welcome">
  <div class="inner">
    <section class="drop" aria-label="Open">
      <span class="dropicon"><Icon icon={ArrowDownToLine} size={22} /></span>
      <div class="droptext">
        <strong>Drop files here</strong>
        <span>or open something from your computer</span>
      </div>
      <div class="dropbtns">
        <button class="btn primary" title={tip('Open a file', 'file.open')} onclick={() => commands.execute('file.open')}><Icon icon={FileText} size={15} /> Open file</button>
        <button class="btn" title={tip('Open a folder', 'file.openFolder')} onclick={() => commands.execute('file.openFolder')}><Icon icon={FolderOpen} size={15} /> Open folder</button>
      </div>
    </section>

    <h3>Create</h3>
    <div class="kinds">
      {#each kinds as k (k.kind)}
        <button class="kind" data-kind={k.kind} style:--hue={KIND[k.kind].hue} title="New {k.label.toLowerCase()} — {k.detail}" onclick={() => void newFileOfKind(undefined, k.kind)}>
          <span class="badge"><Icon icon={KIND[k.kind].icon} size={22} /></span>
          <span class="kn">{k.label}</span>
        </button>
      {/each}
    </div>

    <h3>Tools</h3>
    <div class="tools">
      {#each tools as t (t.id)}
        <button class="tool" title={tip(t.label, t.id)} onclick={() => commands.execute(t.id)}><Icon icon={t.icon} size={15} /> {t.label}</button>
      {/each}
    </div>

    {#if settings.value.recents.length}
      <h3>Recent</h3>
      <div class="recents">
        {#each settings.value.recents.slice(0, 8) as p (p)}
          <div class="rrow">
            <button class="recent" title={p} onclick={() => workspace.openPath(p)}>
              <Icon icon={iconFor(p, kindOf(p))} size={16} />
              <span class="rn">{basename(p)}</span>
              <span class="rd">{tildify(dirname(p), boot.home)}</span>
            </button>
            <button class="rm icon-btn xs" title="Remove from recents" aria-label="Remove {basename(p)} from recents" onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
          </div>
        {/each}
      </div>
    {/if}
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
    width: min(680px, 100%);
    padding: 9vh 24px 40px;
  }
  /* Opening is what most visits are for: a big, friendly target. */
  .drop {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px 18px;
    padding: 22px 24px;
    border: 1.5px dashed var(--border);
    border-radius: 18px;
    background: var(--bg-sidebar);
  }
  .dropicon {
    display: grid;
    place-items: center;
    width: calc(46px * var(--ui-scale));
    height: calc(46px * var(--ui-scale));
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    flex: none;
  }
  .droptext {
    flex: 1 1 12em;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .droptext strong {
    font-size: calc(16px * var(--ui-scale));
    font-weight: 600;
  }
  .droptext span {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .dropbtns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dropbtns .btn {
    height: calc(34px * var(--ui-scale));
    padding: 0 14px;
    border-radius: 10px;
  }
  h3 {
    font-size: calc(13px * var(--ui-scale));
    font-weight: 600;
    letter-spacing: 0.02em;
    margin: 30px 0 12px;
    color: var(--text-muted);
  }
  /* Square tiles: a coloured badge per file type, the name under it. */
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(104px * var(--ui-scale)), 1fr));
    gap: 10px;
  }
  .kind {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    aspect-ratio: 1 / 0.86;
    padding: 12px 8px;
    border: 1px solid var(--border-soft);
    border-radius: 16px;
    background: var(--bg);
    cursor: pointer;
    color: var(--text);
    transition:
      transform 0.12s var(--ease),
      border-color 0.12s var(--ease),
      box-shadow 0.12s var(--ease);
  }
  .kind:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--hue) 45%, var(--border-soft));
    box-shadow: 0 6px 18px color-mix(in srgb, var(--hue) 18%, transparent);
  }
  .kind:focus-visible {
    outline: 2px solid var(--hue);
    outline-offset: 2px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: calc(46px * var(--ui-scale));
    height: calc(46px * var(--ui-scale));
    border-radius: 14px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
  }
  .kn {
    font-size: var(--fs-small);
    text-align: center;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  /* Tools: light chips, shortcuts in the tooltip. */
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: calc(32px * var(--ui-scale));
    padding: 0 14px;
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  .tool :global(svg) {
    color: var(--text-muted);
  }
  .tool:hover {
    background: var(--bg-hover);
  }
  .recents {
    display: flex;
    flex-direction: column;
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
  .recent {
    display: flex;
    align-items: center;
    gap: 10px;
    height: calc(34px * var(--ui-scale));
    padding: 0 10px;
    margin: 0 -10px;
    width: calc(100% + 20px);
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text);
  }
  .recent :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .recent:hover {
    background: var(--bg-hover);
  }
  .rn {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rd {
    min-width: 0;
    color: var(--text-faint);
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
