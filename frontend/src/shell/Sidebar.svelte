<script lang="ts" module>
  // The sidebar slides in and out when shown or hidden, not when the window opens.
  let started = false;
</script>

<script lang="ts">
  import logoMark from '../../../build/icon/logo-mark.svg?raw';
  import { appMenuItems } from '../core/appMenu';
  import Icon from './Icon.svelte';
  import FileTree from './FileTree.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import { ChevronRight, Clock, FilePlus, FolderOpen, FolderPlus, ListCollapse, Menu, Pin, RefreshCw, Search, X } from '../core/icons';
  import { iconFor, kindOf } from '../core/fileicons';
  import { basename, dirname, tildify } from '../core/paths';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { tree } from '../core/tree.svelte';
  import { commands } from '../core/commands';
  import { menu, type MenuItem } from '../core/ui.svelte';
  import { sidebar } from '../core/sidebar.svelte';
  import { boot } from '../core/boot';
  import { formatShortcut } from '../core/keys';
  import { newFolderIn, copyText } from './treeActions';
  import { newFileOfKind } from '../core/newfile';
  import { t } from '../core/i18n';
  import { ms } from '../core/motion';
  import { FULL_MIN, RAIL, sidebarDrag, type SidebarMode } from '../core/sidebarDrag';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import FolderTree from '@lucide/svelte/icons/folder-tree';
  import Cog from '@lucide/svelte/icons/settings';
  import { tick, type Component } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  // The header keeps the name: when it doesn't fit, Open folder and then Find
  // in folder move into the menu (their shortcuts still work); only a sidebar
  // near its narrowest shows just the logo mark. Decided by what fits, so it
  // holds at any interface size and font.
  let fold = $state(0); // 1: no Open folder button, 2: no Find either, 3: no name
  let head = $state<HTMLElement>();
  let titleEl = $state<HTMLElement>();
  let fitSeq = 0;
  async function fit() {
    const seq = ++fitSeq;
    for (let f = 0; f <= 3; f++) {
      fold = f;
      await tick();
      if (seq !== fitSeq || !titleEl || titleEl.scrollWidth <= titleEl.clientWidth) return;
    }
  }
  $effect(() => {
    if (!head) return;
    const ro = new ResizeObserver(() => void fit());
    ro.observe(head);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  });
  $effect(() => {
    void settings.value.uiScale;
    void fit();
  });
  let pinnedOpen = $state(true);
  let recentsOpen = $state(true);

  const folderName = $derived(workspace.folder ? basename(workspace.folder) : '');
  const activePath = $derived(workspace.active?.filePath);
  const recents = $derived(settings.value.recents.filter((p) => !settings.value.pinned.includes(p)).slice(0, 12));


  function appMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Header buttons that didn't fit come first.
    const folded = (fold >= 2 ? ['search.inFolder', 'file.openFolder'] : fold >= 1 ? ['file.openFolder'] : []).flatMap((id): MenuItem[] => {
      const c = commands.get(id);
      const sc = commands.shortcutOf(id);
      return c ? [{ label: c.title, shortcut: sc ? formatShortcut(sc) : undefined, run: () => commands.execute(id) }] : [];
    });
    // From the icon strip the menu opens beside the button, not under it.
    const at = layer === 'compact' ? { clientX: r.right + 6, clientY: r.top } : { clientX: r.left, clientY: r.bottom + 4 };
    menu.show(at, folded.length && layer !== 'compact' ? [...folded, { separator: true }, ...appMenuItems()] : appMenuItems());
  }

  function listMenu(e: MouseEvent, path: string, recent: boolean) {
    const items: MenuItem[] = [
      { label: t('Open'), run: () => workspace.openPath(path) },
      { label: settings.isPinned(path) ? t('Unpin') : t('Pin'), run: () => settings.togglePin(path) },
      { label: t('Copy path'), run: () => copyText(path) },
    ];
    if (recent) items.push({ separator: true }, { label: t('Remove from recents'), run: () => settings.removeRecent(path) });
    menu.show(e, items);
  }

  // Full, the icon strip (settings.sidebarCompact) or, while its edge is
  // dragged past the strip, about to hide. Width changes glide; a drag
  // follows the pointer exactly until it snaps to the strip or away.
  const scale = $derived(settings.value.uiScale || 1);
  const fullW = $derived(Math.max(settings.value.sidebarWidth, Math.round(FULL_MIN * scale)));
  const railW = $derived(Math.round(RAIL * scale));
  let live = $state<SidebarMode | null>(null);
  let snapping = $state(false);
  let snapTimer: ReturnType<typeof setTimeout> | undefined;
  let widthBefore = 0;
  const mode = $derived<SidebarMode>(live ?? (settings.value.sidebarCompact ? 'compact' : 'full'));
  // What's drawn: while it hides, what it was.
  const layer = $derived(mode === 'hidden' ? (settings.value.sidebarCompact ? 'compact' : 'full') : mode);
  const width = $derived(mode === 'full' ? fullW : mode === 'compact' ? railW : 0);

  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    live = settings.value.sidebarCompact ? 'compact' : 'full';
    widthBefore = settings.value.sidebarWidth;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* not an active pointer (a synthetic event): the moves still arrive here */
    }
    document.documentElement.classList.add('mf-col-resizing');
    e.preventDefault();
  }
  function moveResize(e: PointerEvent) {
    if (!live) return;
    const r = sidebarDrag(e.clientX, scale, live);
    if (r.mode !== live) {
      live = r.mode;
      snapping = true;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => (snapping = false), ms(260));
    }
    if (r.mode === 'full') settings.value.sidebarWidth = r.width;
  }
  function endResize() {
    if (!live) return;
    const m = live;
    live = null;
    document.documentElement.classList.remove('mf-col-resizing');
    // Hidden, it comes back (Ctrl+B, the tab bar's button) as it was before
    // the drag; a strip or hidden sidebar opens again as wide as it was.
    settings.update((s) => {
      if (m !== 'full') s.sidebarWidth = widthBefore;
      if (m === 'hidden') s.sidebarVisible = false;
      else s.sidebarCompact = m === 'compact';
    });
  }
  function resetWidth() {
    settings.update((s) => {
      if (s.sidebarCompact) s.sidebarCompact = false;
      else s.sidebarWidth = 260;
    });
  }
  const expand = () => settings.update((s) => (s.sidebarCompact = false));

  /** Showing and hiding the whole sidebar: its width grows from or shrinks to nothing. */
  function slide(node: HTMLElement) {
    const w = node.getBoundingClientRect().width;
    return { duration: started ? ms(240) : 0, easing: cubicOut, css: (t: number) => `width: ${t * w}px` };
  }
  $effect(() => {
    requestAnimationFrame(() => (started = true));
  });

  // The strip's labels: beside the icon, at once when one was just shown
  // (so moving down the strip glides from label to label), else after a beat.
  let tip = $state<{ text: string; hint?: string; x: number; y: number } | null>(null);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  let tipShownAt = 0;
  function showTip(e: Event, text: string, hint?: string) {
    const el = e.currentTarget as HTMLElement;
    clearTimeout(tipTimer);
    const go = () => {
      const r = el.getBoundingClientRect();
      tip = { text, hint, x: r.right + 10, y: r.top + r.height / 2 };
    };
    if (tip || performance.now() - tipShownAt < 600) go();
    else tipTimer = setTimeout(go, 380);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (tip) tipShownAt = performance.now();
      tip = null;
    }, 70);
  }
  function tipIn(_: Element) {
    return { duration: ms(140), easing: cubicOut, css: (t: number) => `opacity: ${t}; transform: translate(${(t - 1) * 6}px, -50%)` };
  }
  $effect(() => {
    if (layer !== 'compact') tip = null;
  });

  const shortcut = (id: string) => {
    const sc = commands.shortcutOf(id);
    return sc ? formatShortcut(sc) : undefined;
  };
  const railPinned = $derived(settings.value.pinned.slice(0, 6));
  const railRecents = $derived(recents.slice(0, 8));
</script>

{#snippet railButton(icon: Component, label: string, run: (e: MouseEvent) => void, opts: { hint?: string; on?: boolean; menu?: (e: MouseEvent) => void; pinned?: boolean } = {})}
  <button
    class="rbtn"
    class:on={opts.on}
    aria-label={label}
    onclick={run}
    oncontextmenu={opts.menu}
    onpointerenter={(e) => showTip(e, label, opts.hint)}
    onpointerleave={hideTip}
    onfocus={(e) => showTip(e, label, opts.hint)}
    onblur={hideTip}
  >
    <Icon {icon} size={18} />
    {#if opts.pinned}<span class="badge" aria-hidden="true"><Icon icon={Pin} size={9} /></span>{/if}
  </button>
{/snippet}

<aside class="sidebar" class:tracking={live === 'full' && !snapping} class:mf-panel-resizing={!!live} style:width="{width}px" transition:slide|global>
  <div class="clip">
    {#if layer === 'compact'}
      <div class="layer rail" style:width="{railW}px" in:fade={{ duration: ms(180), delay: ms(70) }} out:fade={{ duration: ms(90) }}>
        <header class="rhead" class:mac={boot.platform === 'darwin'}>
          <button
            class="logo"
            aria-label={t('Expand sidebar')}
            onclick={expand}
            onpointerenter={(e) => showTip(e, t('Expand sidebar'), shortcut('view.compactSidebar'))}
            onpointerleave={hideTip}
            onfocus={(e) => showTip(e, t('Expand sidebar'), shortcut('view.compactSidebar'))}
            onblur={hideTip}
          >
            <span class="mark" aria-hidden="true">{@html logoMark}</span>
            <span class="open" aria-hidden="true"><Icon icon={PanelLeftOpen} size={18} /></span>
          </button>
        </header>
        <nav class="rgroup" aria-label={t('Sidebar')}>
          {@render railButton(FolderTree, t('Files'), () => ((sidebar.mode = 'files'), expand()), { hint: shortcut('view.showFiles') })}
          {@render railButton(Search, t('Find in folder'), () => commands.execute('search.inFolder'), { hint: shortcut('search.inFolder') })}
          {@render railButton(FolderOpen, t('Open folder'), () => commands.execute('file.openFolder'), { hint: shortcut('file.openFolder') })}
        </nav>
        {#if railPinned.length || railRecents.length}
          <div class="rsep"></div>
          <div class="rfiles" role="group" aria-label={t('Pinned and recent files')}>
            {#each railPinned as p (p)}
              {@render railButton(iconFor(p, kindOf(p)), basename(p), () => workspace.openPath(p), { hint: tildify(dirname(p), boot.home), on: activePath === p, menu: (e) => listMenu(e, p, false), pinned: true })}
            {/each}
            {#each railRecents as p (p)}
              {@render railButton(iconFor(p, kindOf(p)), basename(p), () => workspace.openPath(p), { hint: tildify(dirname(p), boot.home), on: activePath === p, menu: (e) => listMenu(e, p, true) })}
            {/each}
          </div>
        {:else}
          <div class="rfiles"></div>
        {/if}
        <div class="rfoot">
          {@render railButton(Cog, t('Settings'), () => commands.execute('app.settings'), { hint: shortcut('app.settings') })}
          {@render railButton(Menu, t('Menu'), appMenu)}
        </div>
      </div>
    {:else}
      <div class="layer full" style:width="{fullW}px" in:fade={{ duration: ms(180), delay: ms(70) }} out:fade={{ duration: ms(90) }}>
        <header class="head" class:mac={boot.platform === 'darwin'} bind:this={head}>
          <h1 class="title" bind:this={titleEl} title={fold >= 3 ? 'Monoform' : undefined}><span class="mark" aria-hidden="true">{@html logoMark}</span>{#if fold < 3}<span class="word">Monoform</span>{/if}</h1>
          <div class="actions">
            {#if fold < 2}
              <button class="icon-btn" class:on={sidebar.mode === 'search'} title={t('Find in folder ({shortcut})', { shortcut: formatShortcut('Mod+Shift+F') })} onclick={() => commands.execute('search.inFolder')}>
                <Icon icon={Search} />
              </button>
            {/if}
            {#if fold < 1}
              <button class="icon-btn" title={t('Open folder ({shortcut})', { shortcut: formatShortcut('Mod+Shift+O') })} onclick={() => commands.execute('file.openFolder')}>
                <Icon icon={FolderOpen} />
              </button>
            {/if}
            <button class="icon-btn" title={t('Menu')} onclick={appMenu}><Icon icon={Menu} /></button>
            <button class="icon-btn" title={t('Collapse sidebar ({shortcut})', { shortcut: formatShortcut('Mod+Shift+B') })} onclick={() => commands.execute('view.compactSidebar')}><Icon icon={PanelLeftClose} /></button>
          </div>
        </header>

        {#if sidebar.mode === 'search'}
          <SearchPanel />
        {:else}
          <div class="sections">
            <section class="folder" class:has={!!workspace.folder}>
              {#if workspace.folder}
                <div class="label row-label" title={workspace.folder}>
                  <span class="label-text">{folderName}</span>
                  <span class="label-actions">
                    <button class="icon-btn sm" title={t('New file ({shortcut})', { shortcut: formatShortcut('Mod+Alt+N') })} onclick={() => newFileOfKind(workspace.folder)}><Icon icon={FilePlus} size={14} /></button>
                    <button class="icon-btn sm" title={t('New folder')} onclick={() => newFolderIn(workspace.folder)}><Icon icon={FolderPlus} size={14} /></button>
                    <button class="icon-btn sm" title={t('Refresh')} onclick={() => tree.refreshAll()}><Icon icon={RefreshCw} size={14} /></button>
                    <button class="icon-btn sm" title={t('Collapse all')} onclick={() => tree.collapseAll(workspace.folder)}><Icon icon={ListCollapse} size={14} /></button>
                    <button class="icon-btn sm" title={t('Close folder')} onclick={() => commands.execute('folder.close')}><Icon icon={X} size={14} /></button>
                  </span>
                </div>
                <div class="tree-wrap"><FileTree root={workspace.folder} /></div>
              {:else}
                <div class="no-folder">
                  <button class="btn" onclick={() => commands.execute('file.openFolder')}><Icon icon={FolderOpen} /> {t('Open folder')}</button>
                  {#if settings.value.recentFolders.length}
                    <div class="recent-folders">
                      {#each settings.value.recentFolders.slice(0, 4) as f (f)}
                        <div class="row">
                          <button class="item" title={f} onclick={() => workspace.openFolder(f)}>
                            <span class="ico"><Icon icon={FolderOpen} size={15} /></span>
                            <span class="name">{basename(f)}</span>
                            <span class="hint">{tildify(dirname(f), boot.home)}</span>
                          </button>
                          <button class="rm icon-btn xs" title={t('Remove from recent folders')} aria-label={t('Remove {name} from recent folders', { name: basename(f) })} onclick={() => settings.removeRecentFolder(f)}><Icon icon={X} size={12} /></button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </section>

            {#if settings.value.pinned.length}
              <section class="list">
                <button class="label toggle" onclick={() => (pinnedOpen = !pinnedOpen)}>
                  <span class="chev" class:open={pinnedOpen}><Icon icon={ChevronRight} size={12} /></span>{t('Pinned')}
                </button>
                {#if pinnedOpen}
                  {#each settings.value.pinned as p (p)}
                    <button class="item" class:active={activePath === p} title={p} onclick={() => workspace.openPath(p)} oncontextmenu={(e) => listMenu(e, p, false)}>
                      <span class="ico"><Icon icon={Pin} size={14} /></span>
                      <span class="name">{basename(p)}</span>
                    </button>
                  {/each}
                {/if}
              </section>
            {/if}

            {#if recents.length}
              <section class="list">
                <button class="label toggle" onclick={() => (recentsOpen = !recentsOpen)}>
                  <span class="chev" class:open={recentsOpen}><Icon icon={ChevronRight} size={12} /></span>{t('Recents')}
                </button>
                {#if recentsOpen}
                  {#each recents as p (p)}
                    <div class="row">
                      <button class="item" class:active={activePath === p} title={p} onclick={() => workspace.openPath(p)} oncontextmenu={(e) => listMenu(e, p, true)}>
                        <span class="ico"><Icon icon={iconFor(p, kindOf(p))} size={15} /></span>
                        <span class="name">{basename(p)}</span>
                        <span class="hint">{basename(dirname(p))}</span>
                      </button>
                      <button class="rm icon-btn xs" title={t('Remove from recents')} aria-label={t('Remove {name} from recents', { name: basename(p) })} onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
                    </div>
                  {/each}
                {/if}
              </section>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resizer mf-panel-grip left" title={t('Drag to resize · drag further for icons only, or to hide')} onpointerdown={startResize} onpointermove={moveResize} onpointerup={endResize} onpointercancel={endResize} ondblclick={resetWidth}></div>
  {#if tip}
    <div class="rtip" role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px" transition:tipIn>
      <span>{tip.text}</span>{#if tip.hint}<span class="rtip-hint">{tip.hint}</span>{/if}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    height: 100%;
    background: var(--bg-sidebar);
    flex: none;
    transition: width var(--dur-3) var(--ease-out);
  }
  /* Dragged at full width: the edge follows the pointer exactly. */
  .sidebar.tracking {
    transition: none;
  }
  .clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  /* Each layer keeps its own width while the sidebar's grows or shrinks
     around it, so nothing squeezes mid-way: it's uncovered or covered. */
  .layer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 10px 8px 16px;
    height: var(--tabbar-h);
    box-sizing: content-box;
    /* Whatever the width, nothing in the header reaches over the tab bar. */
    overflow: hidden;
    --wails-draggable: drag;
  }
  .head.mac {
    padding-top: 28px;
  }
  .head .actions {
    display: flex;
    flex: none;
    gap: 2px;
    --wails-draggable: no-drag;
  }
  .title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: calc(17px * var(--ui-scale));
    color: var(--text);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
  }
  .mark {
    display: inline-flex;
    flex: none;
    width: calc(22px * var(--ui-scale));
    color: var(--text);
  }
  .mark :global(svg) {
    width: 100%;
    height: auto;
  }

  /* The icon strip. */
  .rail {
    align-items: center;
  }
  .rhead {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 10px 0 8px;
    height: var(--tabbar-h);
    box-sizing: content-box;
    flex: none;
    --wails-draggable: drag;
  }
  .rhead.mac {
    padding-top: 28px;
  }
  /* The mark turns into "expand" under the pointer. */
  .logo {
    position: relative;
    display: grid;
    place-items: center;
    width: calc(36px * var(--ui-scale));
    height: calc(36px * var(--ui-scale));
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    --wails-draggable: no-drag;
    transition:
      background var(--dur-1) var(--ease),
      transform var(--dur-1) var(--ease-out);
  }
  .logo > * {
    grid-area: 1 / 1;
    transition:
      opacity var(--dur-2) var(--ease),
      transform var(--dur-2) var(--ease-spring);
  }
  .logo .open {
    display: inline-flex;
    opacity: 0;
    transform: translateX(-4px) scale(0.8);
    color: var(--text-muted);
  }
  .logo:hover,
  .logo:focus-visible {
    background: var(--bg-hover);
  }
  .logo:hover .mark,
  .logo:focus-visible .mark {
    opacity: 0;
    transform: scale(0.7) rotate(-12deg);
  }
  .logo:hover .open,
  .logo:focus-visible .open {
    opacity: 1;
    transform: none;
    color: var(--text);
  }
  .logo:active {
    transform: scale(0.92);
  }
  .rgroup,
  .rfoot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: none;
    width: 100%;
  }
  .rfoot {
    padding: 6px 0 10px;
  }
  .rsep {
    width: calc(22px * var(--ui-scale));
    height: 1px;
    background: var(--border-soft);
    margin: 8px 0;
    flex: none;
  }
  .rfiles {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .rbtn {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: calc(36px * var(--ui-scale));
    height: calc(36px * var(--ui-scale));
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease),
      transform var(--dur-1) var(--ease-out);
  }
  .rbtn > :global(svg) {
    transition: transform var(--dur-2) var(--ease-spring);
  }
  /* A pill at the strip's edge: a hint of it on hover, full for the open file. */
  .rbtn::before {
    content: '';
    position: absolute;
    left: calc(-8px * var(--ui-scale));
    top: 50%;
    width: 3px;
    height: 0;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
    opacity: 0;
    transform: translateY(-50%);
    transition:
      height var(--dur-2) var(--ease-spring),
      opacity var(--dur-2) var(--ease);
  }
  .rbtn:hover,
  .rbtn:focus-visible {
    background: var(--bg-hover);
    color: var(--text);
  }
  .rbtn:hover > :global(svg) {
    transform: scale(1.08);
  }
  .rbtn:hover::before {
    height: 8px;
    opacity: 0.55;
  }
  .rbtn.on {
    color: var(--text);
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }
  .rbtn.on::before {
    height: 18px;
    opacity: 1;
  }
  .rbtn:active {
    transform: scale(0.92);
  }
  .badge {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: inline-flex;
    color: var(--accent);
  }
  .rtip {
    position: fixed;
    z-index: 200;
    transform: translate(0, -50%);
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 9px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    font-size: var(--fs-small);
    color: var(--text);
    white-space: nowrap;
    pointer-events: none;
    transition: top var(--dur-2) var(--ease-out);
  }
  .rtip-hint {
    color: var(--text-faint);
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sections {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
    overflow: hidden;
  }
  section.folder.has {
    flex: 1;
    min-height: calc(120px * var(--ui-scale));
    display: flex;
    flex-direction: column;
  }
  .tree-wrap {
    flex: 1;
    min-height: 0;
  }
  section.list {
    flex: none;
    max-height: 32%;
    overflow-y: auto;
    padding: 0 8px;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-weight: 500;
    padding: 6px 8px 4px;
    letter-spacing: 0.02em;
  }
  .row-label {
    padding: 4px 8px 4px 16px;
    min-height: calc(28px * var(--ui-scale));
  }
  .label-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label-actions {
    display: flex;
    flex: none;
    opacity: 0;
    transition: opacity 0.12s;
  }
  section.folder:hover .label-actions,
  .label-actions:focus-within {
    opacity: 1;
  }
  .icon-btn.sm {
    width: calc(22px * var(--ui-scale));
    height: calc(22px * var(--ui-scale));
  }
  .toggle {
    border: none;
    background: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .toggle:hover {
    color: var(--text);
  }
  .chev {
    display: inline-flex;
    transition: transform 0.12s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: calc(28px * var(--ui-scale));
    padding: 0 10px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .item:hover {
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }
  .item.active {
    background: var(--bg-hover);
  }
  .item .ico {
    display: inline-flex;
    color: var(--text-muted);
    flex: none;
  }
  .item .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }
  .item .hint {
    color: var(--text-faint);
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 0;
    min-width: 0;
    text-align: right;
  }
  /* Recent rows: an X replaces the folder hint on hover. */
  .row {
    position: relative;
  }
  .row .rm {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
  }
  .row:hover .rm,
  .row .rm:focus-visible {
    opacity: 1;
  }
  .row:hover .hint {
    visibility: hidden;
  }
  .no-folder {
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .recent-folders {
    width: 100%;
    margin-left: -8px;
  }
  .resizer {
    top: 0;
    height: 100%;
  }
</style>
