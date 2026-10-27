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
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import { tick } from 'svelte';

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
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, folded.length ? [...folded, { separator: true }, ...appMenuItems()] : appMenuItems());
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

  let resizing = false;
  function startResize(e: PointerEvent) {
    resizing = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* not an active pointer (a synthetic event): the moves still arrive here */
    }
  }
  function moveResize(e: PointerEvent) {
    if (!resizing) return;
    // Dragged well past the narrowest width: hide the sidebar (the tab bar's button brings it back).
    if (e.clientX < 110 * (settings.value.uiScale || 1)) {
      resizing = false;
      settings.update((s) => (s.sidebarVisible = false));
      return;
    }
    settings.value.sidebarWidth = Math.max(180, Math.min(560, e.clientX));
  }
  function endResize() {
    if (!resizing) return;
    resizing = false;
    settings.schedule();
  }
</script>

<aside class="sidebar" style:width="{settings.value.sidebarWidth}px">
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
      <button class="icon-btn" title={t('Hide sidebar ({shortcut})', { shortcut: formatShortcut('Mod+B') })} onclick={() => commands.execute('view.toggleSidebar')}><Icon icon={PanelLeftClose} /></button>
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resizer" onpointerdown={startResize} onpointermove={moveResize} onpointerup={endResize}></div>
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-sidebar);
    min-width: calc(180px * var(--ui-scale));
    flex: none;
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
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
  }
</style>
