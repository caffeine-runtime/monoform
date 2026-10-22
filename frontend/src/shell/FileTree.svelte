<script lang="ts">
  import Icon from './Icon.svelte';
  import { ChevronRight, Folder, FolderOpen } from '../core/icons';
  import { iconFor } from '../core/fileicons';
  import { tree, type TreeItem, type TreeRow } from '../core/tree.svelte';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { openTreeItem, treeContextMenu } from './treeActions';
  import { t } from '../core/i18n';

  let { root }: { root: string } = $props();

  // Row height follows the interface scale; CSS reads it from --row.
  const ROW = $derived(Math.round(26 * (settings.value.uiScale || 1)));
  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(400);

  const rows = $derived(tree.rows(root, settings.value.showHidden));
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 8));
  const end = $derived(Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 8));
  const visible = $derived(rows.slice(start, end));
  const activePath = $derived(workspace.active?.filePath);

  function click(row: TreeRow) {
    tree.selected = row.item.id;
    if (row.item.isDir) void tree.toggle(row.item);
    else void openTreeItem(row.item);
  }

  function chevClick(row: TreeRow, e: MouseEvent) {
    if (!row.item.expandable || row.item.isDir) return;
    // Archives: the chevron browses inside, the row opens the archive view.
    e.stopPropagation();
    tree.selected = row.item.id;
    void tree.toggle(row.item);
  }

  function keydown(e: KeyboardEvent) {
    const idx = rows.findIndex((r) => r.item.id === tree.selected);
    const row = rows[idx];
    let next = idx;
    switch (e.key) {
      case 'ArrowDown':
        next = Math.min(rows.length - 1, idx + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, idx - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = rows.length - 1;
        break;
      case 'ArrowRight':
        if (row?.item.expandable && !row.expanded) void tree.toggle(row.item, true);
        else next = Math.min(rows.length - 1, idx + 1);
        break;
      case 'ArrowLeft':
        if (row?.expanded) void tree.toggle(row.item, false);
        else if (row) {
          for (let i = idx - 1; i >= 0; i--)
            if (rows[i].depth < row.depth) {
              next = i;
              break;
            }
        }
        break;
      case 'Enter':
      case ' ':
        if (row) {
          if (row.item.isDir) void tree.toggle(row.item);
          else void openTreeItem(row.item);
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== idx && rows[next]) {
      tree.selected = rows[next].item.id;
      const top = next * ROW;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + ROW > viewport.scrollTop + height) viewport.scrollTop = top + ROW - height;
    }
  }

  function iconOf(item: TreeItem, expanded: boolean) {
    if (item.isDir) return expanded ? FolderOpen : Folder;
    return iconFor(item.name, item.kind);
  }

  function dragStart(e: DragEvent, item: TreeItem) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('application/x-mf-path', item.archive ? '' : item.path);
    e.dataTransfer.setData('text/plain', item.path);
    e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<div
  class="tree"
  bind:this={viewport}
  style:--row="{ROW}px"
  bind:clientHeight={height}
  onscroll={() => (scrollTop = viewport.scrollTop)}
  tabindex="0"
  role="tree"
  aria-label={t('Folder')}
  onkeydown={keydown}
>
  <div class="spacer" style:height="{rows.length * ROW}px">
    {#each visible as row, i (row.item.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="row"
        class:selected={tree.selected === row.item.id}
        class:active={activePath === row.item.path && !row.item.archive}
        class:hidden={row.item.hidden}
        style:top="{(start + i) * ROW}px"
        style:padding-left="{8 + row.depth * 14}px"
        role="treeitem"
        aria-selected={tree.selected === row.item.id}
        aria-expanded={row.item.expandable ? row.expanded : undefined}
        tabindex="-1"
        title={row.item.archive ? row.item.entry : row.item.path}
        draggable={!row.item.isDir}
        ondragstart={(e) => dragStart(e, row.item)}
        onclick={() => click(row)}
        oncontextmenu={(e) => {
          tree.selected = row.item.id;
          treeContextMenu(e, row.item);
        }}
      >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="chev" class:open={row.expanded} onclick={(e) => chevClick(row, e)}>
          {#if row.item.expandable}
            {#if row.loading}<span class="spinner small"></span>{:else}<Icon icon={ChevronRight} size={14} />{/if}
          {/if}
        </span>
        <span class="ico"><Icon icon={iconOf(row.item, row.expanded)} size={15} /></span>
        <span class="name">{row.item.name}</span>
      </div>
    {/each}
  </div>
  {#if rows.length === 0 && !tree.loading.has(root)}
    <div class="empty muted">{t('This folder is empty')}</div>
  {/if}
</div>

<style>
  .tree {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    outline: none;
    padding: 0 8px;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--row);
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
    border-radius: var(--radius);
    color: var(--text);
    white-space: nowrap;
    cursor: pointer;
  }
  .row:hover {
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }
  .row.selected,
  .row.active {
    background: var(--bg-hover);
  }
  .tree:focus-within .row.selected {
    background: var(--bg-active);
  }
  .row.hidden .name {
    color: var(--text-muted);
  }
  .chev {
    width: calc(14px * var(--ui-scale));
    flex: none;
    display: inline-flex;
    color: var(--text-faint);
    transition: transform 0.12s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .chev .small {
    width: 10px;
    height: 10px;
    border-width: 1.5px;
  }
  .ico {
    display: inline-flex;
    color: var(--text-muted);
    flex: none;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 8px 12px;
    font-size: var(--fs-small);
  }
</style>
