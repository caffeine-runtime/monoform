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
  import Plus from '@lucide/svelte/icons/plus';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { dropInto } from '../core/split';
  import { insertionIndex, tabDrag, zoneOf } from '../core/tabdrag.svelte';
  import { moveToNewWindow } from '../core/windows';
  import { t } from '../core/i18n';

  // Editors with side panels (layers, effects, properties) get a button to hide them.
  const PANELS = new Set(['image', 'video', 'svg', 'cad', 'model3d', 'database']);
  const hasPanels = $derived(!!workspace.active && PANELS.has(workspace.active.moduleId));

  let strip: HTMLDivElement;
  let bar: HTMLDivElement;

  // ---- dragging a tab: along the bar to reorder, onto a view to split, out of the window for a new one ----
  let press: { t: Tab; i: number; x: number; y: number; pointer: number; el: HTMLElement } | null = null;
  let dropTo = $state(-1); // the index the tab would move to
  let dragFrom = $state(-1);
  let justDragged = false; // the click after a drag isn't a click

  function down(e: PointerEvent, t: Tab, i: number) {
    if (e.button !== 0 || (e.target as Element).closest('.close')) return;
    e.preventDefault(); // no text selection sweeping over the editor while dragging
    press = { t, i, x: e.clientX, y: e.clientY, pointer: e.pointerId, el: e.currentTarget as HTMLElement };
  }

  function drag(e: PointerEvent) {
    const p = press;
    if (!p) return;
    if (!tabDrag.id) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      // Captured, the pointer keeps reporting outside the window too.
      try {
        p.el.setPointerCapture(p.pointer);
      } catch {
        /* not a live pointer (synthetic events) */
      }
      tabDrag.id = p.t.id;
      dragFrom = p.i;
    }
    tabDrag.x = e.clientX;
    tabDrag.y = e.clientY;
    tabDrag.zone = zoneOf(e.clientX, e.clientY, bar.getBoundingClientRect(), innerWidth, innerHeight);
    dropTo = tabDrag.zone === 'strip' ? insertionIndex(e.clientX, [...strip.querySelectorAll<HTMLElement>('.tab')].map((el) => el.getBoundingClientRect()), p.i) : -1;
  }

  function drop(e: PointerEvent) {
    const p = press;
    press = null;
    const id = tabDrag.id;
    if (!p || !id) return;
    justDragged = true;
    setTimeout(() => (justDragged = false));
    const zone = tabDrag.zone;
    const to = dropTo;
    tabDrag.id = null;
    dropTo = dragFrom = -1;
    if (zone === 'strip') workspace.move(p.i, to);
    else if (zone === 'views') tabDrag.dropOnViews?.(id, e.clientX, e.clientY);
    else void moveToNewWindow(p.t, { x: e.screenX, y: e.screenY });
  }

  function cancelDrag() {
    press = null;
    tabDrag.id = null;
    dropTo = dragFrom = -1;
  }

  /** Where the insertion mark goes: before the tab at this index (the length means after the last). */
  const markAt = $derived(dropTo < 0 || dropTo === dragFrom ? -1 : dropTo > dragFrom ? dropTo + 1 : dropTo);
  const dragged = $derived(tabDrag.id ? workspace.tabs.find((t) => t.id === tabDrag.id) : undefined);

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
      { label: `${!s ? '✓ ' : ''}${t('One tab')}`, shortcut: '', run: () => commands.execute('view.unsplit') },
      { label: `${s?.layout === 'columns' && n === 2 ? '✓ ' : ''}${t('Two side by side')}`, run: () => commands.execute('view.splitColumns') },
      { label: `${s?.layout === 'rows' && n === 2 ? '✓ ' : ''}${t('Two stacked')}`, run: () => commands.execute('view.splitRows') },
      { label: `${s?.layout === 'grid' && n === 3 ? '✓ ' : ''}${t('Three')}`, run: () => commands.execute('view.splitThree') },
      { label: `${n === 4 ? '✓ ' : ''}${t('Four (grid)')}`, run: () => commands.execute('view.splitGrid') },
      { separator: true },
      { label: t('Tip: drag a tab onto the edge of a view to split'), disabled: true, run: () => {} },
    ]);
  }

  function tabMenu(e: MouseEvent, tab: Tab) {
    const inSplit = !!workspace.split?.panes.includes(tab.id);
    menu.show(e, [
      { label: t('Close'), run: () => workspace.close(tab) },
      { label: t('Close others'), run: () => workspace.closeAll(tab) },
      { label: t('Close all'), run: () => workspace.closeAll() },
      { separator: true },
      ...(tab.filePath ? [{ label: t('Move to a new window'), run: () => void moveToNewWindow(tab) }] : []),
      ...(workspace.tabs.length > 1 && !inSplit
        ? [
            { label: t('Open side by side (split right)'), run: () => splitWith(tab, 'right') },
            { label: t('Open below (split down)'), run: () => splitWith(tab, 'bottom') },
          ]
        : []),
      ...(inSplit ? [{ label: t('Remove from split view'), run: () => workspace.setSplit(workspace.split!.panes.length > 2 ? { ...workspace.split!, panes: workspace.split!.panes.filter((p) => p !== tab.id) } : null) }] : []),
      { separator: true },
      ...(tab.filePath
        ? [
            { label: settings.isPinned(tab.filePath) ? t('Unpin') : t('Pin'), run: () => settings.togglePin(tab.filePath!) },
            { label: t('Copy path'), run: () => copyText(tab.filePath!) },
            { label: t('Compare with…'), run: () => void import('../core/compare').then((m) => m.compareWith(tab.filePath!)) },
            { label: t('Show history'), run: () => workspace.openTool('history', tab.filePath!) },
            { label: t('Reveal in sidebar'), run: () => commands.execute('file.reveal') },
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

<svelte:window onpointermove={drag} onpointerup={drop} onpointercancel={cancelDrag} onkeydown={(e) => tabDrag.id && e.key === 'Escape' && cancelDrag()} />
<div class="tabbar" bind:this={bar} class:mac-collapsed={boot.platform === 'darwin' && !settings.value.sidebarVisible}>
  {#if !settings.value.sidebarVisible}
    <button class="icon-btn toggle" title={t('Show sidebar')} onclick={() => commands.execute('view.toggleSidebar')}><Icon icon={PanelLeft} /></button>
  {/if}
  <div class="strip" bind:this={strip} role="tablist">
    {#each workspace.tabs as tab, i (tab.id)}
      <div
        class="tab"
        class:active={workspace.activeId === tab.id}
        class:in-split={!!workspace.split?.panes.includes(tab.id)}
        class:drop-before={markAt === i}
        class:drop-after={markAt === workspace.tabs.length && i === workspace.tabs.length - 1}
        class:dragging={tabDrag.id === tab.id}
        data-tab={tab.id}
        role="tab"
        tabindex="0"
        aria-selected={workspace.activeId === tab.id}
        title={tab.subtitle || tab.title}
        onclick={() => !justDragged && workspace.activate(tab)}
        onpointerdown={(e) => down(e, tab, i)}
        onkeydown={(e) => e.key === 'Enter' && workspace.activate(tab)}
        onmouseup={(e) => mouseup(e, tab)}
        oncontextmenu={(e) => tabMenu(e, tab)}
      >
        <span class="ico"><Icon icon={iconFor(tab.name, kindOf(tab))} size={14} /></span>
        <span class="name">{tab.title}</span>
        {#if workspace.split?.panes.includes(tab.id)}<span class="pane-no" title={t('Shown in split view, pane {n}', { n: workspace.split.panes.indexOf(tab.id) + 1 })}>{workspace.split.panes.indexOf(tab.id) + 1}</span>{/if}
        {#if tab.readOnly}<span class="ro" title={t('Read-only')}><Icon icon={Lock} size={11} /></span>{/if}
        <button
          class="close"
          class:dirty={tab.dirty}
          title={tab.dirty ? t('Unsaved changes — close') : t('Close')}
          onclick={(e) => {
            e.stopPropagation();
            void workspace.close(tab);
          }}
        >
          <span class="dot"></span>
          <span class="x"><Icon icon={X} size={13} /></span>
        </button>
      </div>
    {/each}
    <button class="icon-btn newtab" title={t('New tab ({shortcut})', { shortcut: formatShortcut('Mod+T') })} aria-label={t('New tab')} onclick={() => commands.execute('tab.new')}><Icon icon={Plus} size={15} /></button>
  </div>
  {#if hasPanels}
    <button
      class="icon-btn panels"
      class:off={settings.value.panelsHidden}
      title={settings.value.panelsHidden ? t('Show side panels ({shortcut})', { shortcut: formatShortcut('Mod+Alt+B') }) : t('Hide side panels ({shortcut})', { shortcut: formatShortcut('Mod+Alt+B') })}
      aria-pressed={!settings.value.panelsHidden}
      onclick={() => commands.execute('view.togglePanels')}><Icon icon={PanelRight} size={15} /></button
    >
  {/if}
  {#if workspace.tabs.length > 1}
    <button class="icon-btn layout" class:on={!!workspace.split} title={t('Split view: show 2–4 tabs side by side ({shortcut})', { shortcut: formatShortcut('Mod+\\') })} onclick={layoutMenu}><Icon icon={Columns2} size={15} /></button>
  {/if}
</div>
{#if dragged}
  <!-- Kept inside the window, so "release for a new window" stays readable at its edge. -->
  <div class="tab-ghost" style:left="{Math.max(8, Math.min(tabDrag.x + 12, innerWidth - 270))}px" style:top="{Math.max(8, Math.min(tabDrag.y + 14, innerHeight - 60))}px" aria-hidden="true">
    <span class="gname">{dragged.title}</span>
    {#if tabDrag.zone === 'outside'}<span class="ghint">{dragged.filePath ? t('Release for a new window') : t('Only files can have their own window')}</span>{/if}
  </div>
{/if}

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
  .panels {
    margin: 0 0 5px 4px;
    --wails-draggable: no-drag;
  }
  .panels.off {
    color: var(--text-faint);
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
    user-select: none;
    touch-action: none;
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
  .tab.dragging {
    opacity: 0.45;
  }
  .tab.drop-after::after {
    content: '';
    position: absolute;
    right: -2px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .newtab {
    flex: none;
    /* Centred on the tabs (which sit at the bottom of the bar), not on the bar. */
    align-self: flex-end;
    margin: 0 2px calc(1.5px * var(--ui-scale));
    --wails-draggable: no-drag;
  }
  .tab-ghost {
    position: fixed;
    z-index: 500;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 260px;
    padding: 6px 10px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow);
    font-size: var(--fs-small);
  }
  .gname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ghint {
    color: var(--accent-text);
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
