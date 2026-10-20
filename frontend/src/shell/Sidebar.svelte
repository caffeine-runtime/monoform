<script lang="ts">
  import Icon from './Icon.svelte';
  import FileTree from './FileTree.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import { ChevronRight, Clock, FilePlus, FolderOpen, FolderPlus, ListCollapse, Menu, Pin, RefreshCw, Search, X } from '../core/icons';
  import { iconFor } from '../core/fileicons';
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
  import { extname } from '../core/paths';

  let pinnedOpen = $state(true);
  let recentsOpen = $state(true);

  const folderName = $derived(workspace.folder ? basename(workspace.folder) : '');
  const activePath = $derived(workspace.active?.filePath);
  const recents = $derived(settings.value.recents.filter((p) => !settings.value.pinned.includes(p)).slice(0, 12));

  function kindOf(p: string) {
    const e = extname(p);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(e)) return 'image';
    if (['md', 'markdown'].includes(e)) return 'markdown';
    if (e === 'pdf') return 'pdf';
    if (['json', 'yaml', 'yml'].includes(e)) return 'json';
    if (['csv', 'tsv'].includes(e)) return 'csv';
    if (['zip', 'tar', 'gz', 'tar.gz', '7z', 'rar', 'tgz'].includes(e)) return 'archive';
    return 'text';
  }

  function appMenu(e: MouseEvent) {
    const groups = new Map<string, MenuItem[]>();
    for (const c of commands.available()) {
      const g = c.category ?? 'General';
      if (!groups.has(g)) groups.set(g, []);
      const sc = commands.shortcutOf(c.id);
      groups.get(g)!.push({ label: c.title, shortcut: sc ? formatShortcut(sc) : undefined, run: () => commands.execute(c.id) });
    }
    const items: MenuItem[] = [];
    for (const g of ['File', 'Edit', 'View', 'Tabs', 'Tools']) {
      const list = groups.get(g);
      if (!list) continue;
      if (items.length) items.push({ separator: true });
      items.push(...list);
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, items);
  }

  function listMenu(e: MouseEvent, path: string, recent: boolean) {
    const items: MenuItem[] = [
      { label: 'Open', run: () => workspace.openPath(path) },
      { label: settings.isPinned(path) ? 'Unpin' : 'Pin', run: () => settings.togglePin(path) },
      { label: 'Copy path', run: () => copyText(path) },
    ];
    if (recent) items.push({ separator: true }, { label: 'Remove from recents', run: () => settings.removeRecent(path) });
    menu.show(e, items);
  }

  let resizing = false;
  function startResize(e: PointerEvent) {
    resizing = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveResize(e: PointerEvent) {
    if (!resizing) return;
    settings.value.sidebarWidth = Math.max(180, Math.min(560, e.clientX));
  }
  function endResize() {
    if (!resizing) return;
    resizing = false;
    settings.schedule();
  }
</script>

<aside class="sidebar" style:width="{settings.value.sidebarWidth}px">
  <header class="head" class:mac={boot.platform === 'darwin'}>
    <h1 class="title">Hold It All</h1>
    <div class="actions">
      <button class="icon-btn" class:on={sidebar.mode === 'search'} title="Find in folder ({formatShortcut('Mod+Shift+F')})" onclick={() => commands.execute('search.inFolder')}>
        <Icon icon={Search} />
      </button>
      <button class="icon-btn" title="Open folder ({formatShortcut('Mod+Shift+O')})" onclick={() => commands.execute('file.openFolder')}>
        <Icon icon={FolderOpen} />
      </button>
      <button class="icon-btn" title="Menu" onclick={appMenu}><Icon icon={Menu} /></button>
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
              <button class="icon-btn sm" title="New file ({formatShortcut('Mod+Alt+N')})" onclick={() => newFileOfKind(workspace.folder)}><Icon icon={FilePlus} size={14} /></button>
              <button class="icon-btn sm" title="New folder" onclick={() => newFolderIn(workspace.folder)}><Icon icon={FolderPlus} size={14} /></button>
              <button class="icon-btn sm" title="Refresh" onclick={() => tree.refreshAll()}><Icon icon={RefreshCw} size={14} /></button>
              <button class="icon-btn sm" title="Collapse all" onclick={() => tree.collapseAll(workspace.folder)}><Icon icon={ListCollapse} size={14} /></button>
              <button class="icon-btn sm" title="Close folder" onclick={() => commands.execute('folder.close')}><Icon icon={X} size={14} /></button>
            </span>
          </div>
          <div class="tree-wrap"><FileTree root={workspace.folder} /></div>
        {:else}
          <div class="no-folder">
            <button class="btn" onclick={() => commands.execute('file.openFolder')}><Icon icon={FolderOpen} /> Open folder</button>
            {#if settings.value.recentFolders.length}
              <div class="recent-folders">
                {#each settings.value.recentFolders.slice(0, 4) as f (f)}
                  <div class="row">
                    <button class="item" title={f} onclick={() => workspace.openFolder(f)}>
                      <span class="ico"><Icon icon={FolderOpen} size={15} /></span>
                      <span class="name">{basename(f)}</span>
                      <span class="hint">{tildify(dirname(f), boot.home)}</span>
                    </button>
                    <button class="rm icon-btn xs" title="Remove from recent folders" aria-label="Remove {basename(f)} from recent folders" onclick={() => settings.removeRecentFolder(f)}><Icon icon={X} size={12} /></button>
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
            <span class="chev" class:open={pinnedOpen}><Icon icon={ChevronRight} size={12} /></span>Pinned
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
            <span class="chev" class:open={recentsOpen}><Icon icon={ChevronRight} size={12} /></span>Recents
          </button>
          {#if recentsOpen}
            {#each recents as p (p)}
              <div class="row">
                <button class="item" class:active={activePath === p} title={p} onclick={() => workspace.openPath(p)} oncontextmenu={(e) => listMenu(e, p, true)}>
                  <span class="ico"><Icon icon={iconFor(p, kindOf(p))} size={15} /></span>
                  <span class="name">{basename(p)}</span>
                  <span class="hint">{basename(dirname(p))}</span>
                </button>
                <button class="rm icon-btn xs" title="Remove from recents" aria-label="Remove {basename(p)} from recents" onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
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
    padding: 10px 10px 8px 16px;
    height: var(--tabbar-h);
    box-sizing: content-box;
    --wails-draggable: drag;
  }
  .head.mac {
    padding-top: 28px;
  }
  .head .actions {
    display: flex;
    gap: 2px;
    --wails-draggable: no-drag;
  }
  .title {
    margin: 0;
    font-size: calc(17px * var(--ui-scale));
    color: var(--text);
    white-space: nowrap;
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
