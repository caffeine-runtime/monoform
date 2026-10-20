<script lang="ts">
  import Icon from './Icon.svelte';
  import { Lock, X, PanelLeft } from '../core/icons';
  import { iconFor } from '../core/fileicons';
  import { workspace, type Tab } from '../core/tabs.svelte';
  import { settings } from '../core/settings.svelte';
  import { commands } from '../core/commands';
  import { menu } from '../core/ui.svelte';
  import { boot } from '../core/boot';
  import { formatShortcut } from '../core/keys';
  import { copyText } from './treeActions';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import { dropInto } from '../core/split';

  let dragIndex = -1;
  let dropIndex = $state(-1);
  let strip: HTMLDivElement;

  function kindOf(t: Tab) {
    const m = t.moduleId;
    return m === 'markdown' ? 'markdown' : m === 'image' ? 'image' : m === 'pdf' ? 'pdf' : m === 'data' ? 'json' : m === 'csv' ? 'csv' : m === 'archive' ? 'archive' : m === 'hash' ? 'checksum' : 'text';
  }

  function mouseup(e: MouseEvent, t: Tab) {
    if (e.button === 1) {
      e.preventDefault();
      void workspace.close(t);
    }
  }

  /** Show t next to the focused tab (or add it to the split). */
  function splitWith(t: Tab, edge: 'right' | 'bottom') {
    const target = workspace.activeId && workspace.activeId !== t.id ? workspace.activeId : workspace.tabs.find((x) => x.id !== t.id)?.id;
    if (!target) return;
    workspace.setSplit(dropInto(workspace.split, t.id, target, edge));
    workspace.activate(t);
  }

  function layoutMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const s = workspace.split;
    const n = s?.panes.length ?? 1;
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: `${!s ? '✓ ' : ''}One tab`, shortcut: '', run: () => commands.execute('view.unsplit') },
      { label: `${s?.layout === 'columns' && n === 2 ? '✓ ' : ''}Two side by side`, run: () => commands.execute('view.splitColumns') },
      { label: `${s?.layout === 'rows' && n === 2 ? '✓ ' : ''}Two stacked`, run: () => commands.execute('view.splitRows') },
      { label: `${s?.layout === 'grid' && n === 3 ? '✓ ' : ''}Three`, run: () => commands.execute('view.splitThree') },
      { label: `${n === 4 ? '✓ ' : ''}Four (grid)`, run: () => commands.execute('view.splitGrid') },
      { separator: true },
      { label: 'Tip: drag a tab onto the edge of a view to split', disabled: true, run: () => {} },
    ]);
  }

  function tabMenu(e: MouseEvent, t: Tab) {
    const inSplit = !!workspace.split?.panes.includes(t.id);
    menu.show(e, [
      { label: 'Close', run: () => workspace.close(t) },
      { label: 'Close others', run: () => workspace.closeAll(t) },
      { label: 'Close all', run: () => workspace.closeAll() },
      { separator: true },
      ...(workspace.tabs.length > 1 && !inSplit
        ? [
            { label: 'Open side by side (split right)', run: () => splitWith(t, 'right') },
            { label: 'Open below (split down)', run: () => splitWith(t, 'bottom') },
          ]
        : []),
      ...(inSplit ? [{ label: 'Remove from split view', run: () => workspace.setSplit(workspace.split!.panes.length > 2 ? { ...workspace.split!, panes: workspace.split!.panes.filter((p) => p !== t.id) } : null) }] : []),
      { separator: true },
      ...(t.filePath
        ? [
            { label: settings.isPinned(t.filePath) ? 'Unpin' : 'Pin', run: () => settings.togglePin(t.filePath!) },
            { label: 'Copy path', run: () => copyText(t.filePath!) },
            { label: 'Compare with…', run: () => void import('../core/compare').then((m) => m.compareWith(t.filePath!)) },
            { label: 'Show history', run: () => workspace.openTool('history', t.filePath!) },
            { label: 'Reveal in sidebar', run: () => commands.execute('file.reveal') },
          ]
        : []),
    ]);
  }

  $effect(() => {
    // Keep the active tab scrolled into view.
    const id = workspace.activeId;
    if (!id || !strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div class="tabbar" class:mac-collapsed={boot.platform === 'darwin' && !settings.value.sidebarVisible}>
  {#if !settings.value.sidebarVisible}
    <button class="icon-btn toggle" title="Show sidebar" onclick={() => commands.execute('view.toggleSidebar')}><Icon icon={PanelLeft} /></button>
  {/if}
  <div class="strip" bind:this={strip} role="tablist">
    {#each workspace.tabs as t, i (t.id)}
      <div
        class="tab"
        class:active={workspace.activeId === t.id}
        class:in-split={!!workspace.split?.panes.includes(t.id)}
        class:drop-before={dropIndex === i}
        data-tab={t.id}
        role="tab"
        tabindex="0"
        aria-selected={workspace.activeId === t.id}
        title={t.subtitle || t.title}
        draggable="true"
        onclick={() => workspace.activate(t)}
        onkeydown={(e) => e.key === 'Enter' && workspace.activate(t)}
        onmouseup={(e) => mouseup(e, t)}
        oncontextmenu={(e) => tabMenu(e, t)}
        ondragstart={(e) => {
          dragIndex = i;
          e.dataTransfer?.setData('text/plain', t.id);
          // Dropping on a view splits it (see SplitOverlay).
          e.dataTransfer?.setData('application/x-hia-tab', t.id);
        }}
        ondragover={(e) => {
          if (dragIndex < 0) return;
          e.preventDefault();
          dropIndex = i;
        }}
        ondragleave={() => (dropIndex = -1)}
        ondrop={(e) => {
          e.preventDefault();
          workspace.move(dragIndex, i);
          dragIndex = dropIndex = -1;
        }}
        ondragend={() => (dragIndex = dropIndex = -1)}
      >
        <span class="ico"><Icon icon={iconFor(t.name, kindOf(t))} size={14} /></span>
        <span class="name">{t.title}</span>
        {#if workspace.split?.panes.includes(t.id)}<span class="pane-no" title="Shown in split view, pane {workspace.split.panes.indexOf(t.id) + 1}">{workspace.split.panes.indexOf(t.id) + 1}</span>{/if}
        {#if t.readOnly}<span class="ro" title="Read-only"><Icon icon={Lock} size={11} /></span>{/if}
        <button
          class="close"
          class:dirty={t.dirty}
          title={t.dirty ? 'Unsaved changes — close' : 'Close'}
          onclick={(e) => {
            e.stopPropagation();
            void workspace.close(t);
          }}
        >
          <span class="dot"></span>
          <span class="x"><Icon icon={X} size={13} /></span>
        </button>
      </div>
    {/each}
  </div>
  {#if workspace.tabs.length > 1}
    <button class="icon-btn layout" class:on={!!workspace.split} title="Split view: show 2–4 tabs side by side ({formatShortcut('Mod+\\')})" onclick={layoutMenu}><Icon icon={Columns2} size={15} /></button>
  {/if}
</div>

<style>
  .tabbar {
    display: flex;
    align-items: flex-end;
    height: var(--tabbar-h);
    padding: 0 8px;
    background: var(--bg-sidebar);
    flex: none;
    --wails-draggable: drag;
  }
  .tabbar.mac-collapsed {
    padding-left: 78px;
  }
  .toggle {
    margin: 0 4px 5px 0;
    --wails-draggable: no-drag;
  }
  .strip {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    height: 100%;
    min-width: 0;
    flex: 1;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .layout {
    margin: 0 0 5px 4px;
    --wails-draggable: no-drag;
  }
  .layout.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .tab.in-split {
    box-shadow: inset 0 -2px 0 var(--accent-soft);
  }
  .pane-no {
    font-size: calc(10px * var(--ui-scale));
    font-weight: 600;
    min-width: 1.4em;
    text-align: center;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent-text);
    padding: 0 3px;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: calc(31px * var(--ui-scale));
    max-width: 220px;
    min-width: calc(90px * var(--ui-scale));
    padding: 0 6px 0 12px;
    border-radius: var(--radius) var(--radius) 0 0;
    color: var(--text-muted);
    cursor: pointer;
    flex: none;
    white-space: nowrap;
    --wails-draggable: no-drag;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }
  .tab:hover {
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
    color: var(--text);
  }
  .tab.active {
    background: var(--bg);
    color: var(--text);
  }
  .tab.drop-before::before {
    content: '';
    position: absolute;
    left: -2px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .ico {
    display: inline-flex;
    flex: none;
    opacity: 0.85;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .ro {
    display: inline-flex;
    color: var(--text-faint);
  }
  .close {
    position: relative;
    width: calc(20px * var(--ui-scale));
    height: calc(20px * var(--ui-scale));
    border: none;
    padding: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: none;
  }
  .close:hover {
    background: var(--bg-active);
    color: var(--text);
  }
  .close .x {
    display: inline-flex;
    opacity: 0;
  }
  .tab:hover .close .x,
  .tab.active .close .x {
    opacity: 1;
  }
  .close .dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    display: none;
  }
  .close.dirty .dot {
    display: block;
  }
  .close.dirty .x {
    opacity: 0;
  }
  .close.dirty:hover .dot {
    display: none;
  }
  .close.dirty:hover .x {
    opacity: 1;
  }
</style>
