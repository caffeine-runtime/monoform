<script lang="ts">
  // A document's headings as a tree (Obsidian's Outline, Word's Navigation
  // pane): click a heading to go to it, fold a branch with its arrow; the
  // heading the reader is in is highlighted.
  import { untrack } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Icon from './Icon.svelte';
  import { t } from '../core/i18n';
  import { outlineTree, type OutlineItem, type OutlineNode } from '../core/textStats';

  let { items, active = -1, onpick, empty = t('No headings') }: { items: OutlineItem[]; active?: number; onpick: (i: number) => void; empty?: string } = $props();

  type Node = OutlineNode & { i: number; children: Node[] };
  const tree = $derived.by(() => {
    const withIndex = items.map((it, i) => ({ ...it, i }));
    return outlineTree(withIndex) as Node[];
  });
  let folded = $state(new Set<string>());
  const key = (n: Node) => `${n.level}:${n.text}:${n.i}`;
  function toggle(n: Node) {
    const k = key(n);
    const s = new Set(folded);
    if (!s.delete(k)) s.add(k);
    folded = s;
  }
  function pathTo(ns: Node[], i: number, above: Node[]): Node[] | null {
    for (const n of ns) {
      if (n.i === i) return above;
      const r = pathTo(n.children, i, [...above, n]);
      if (r) return r;
    }
    return null;
  }
  // When the reader moves to another heading, the branches above it open.
  let shown = -1;
  $effect(() => {
    const above = active >= 0 && active !== shown ? pathTo(tree, active, []) : null;
    shown = active;
    untrack(() => {
      const hidden = above?.filter((n) => folded.has(key(n))) ?? [];
      if (!hidden.length) return;
      const s = new Set(folded);
      for (const n of hidden) s.delete(key(n));
      folded = s;
    });
  });
</script>

{#snippet branch(nodes: Node[], depth: number)}
  {#each nodes as n (n.i)}
    <li role="treeitem" aria-selected={n.i === active} aria-expanded={n.children.length ? !folded.has(key(n)) : undefined}>
      <div class="row" class:on={n.i === active} style:padding-left="{4 + depth * 14}px">
        {#if n.children.length}
          <button class="fold" class:open={!folded.has(key(n))} tabindex="-1" aria-label={folded.has(key(n)) ? t('Expand') : t('Collapse')} onclick={() => toggle(n)}><Icon icon={ChevronRight} size={12} /></button>
        {:else}
          <span class="fold"></span>
        {/if}
        <button class="item h{n.level}" title={n.text} onclick={() => onpick(n.i)}>{n.text || t('(untitled)')}</button>
      </div>
      {#if n.children.length && !folded.has(key(n))}
        <ul role="group">{@render branch(n.children, depth + 1)}</ul>
      {/if}
    </li>
  {/each}
{/snippet}

{#if items.length}
  <ul class="outline" role="tree" aria-label={t('Outline')}>{@render branch(tree, 0)}</ul>
{:else}
  <p class="none">{empty}</p>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .outline {
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    min-height: 24px;
    border-radius: 4px;
    margin: 0 4px;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.on {
    background: var(--bg-active);
  }
  .row.on .item {
    color: var(--accent-text);
  }
  .fold {
    flex: none;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 0;
    cursor: pointer;
  }
  .fold :global(svg) {
    transition: transform 0.12s;
  }
  .fold.open :global(svg) {
    transform: rotate(90deg);
  }
  .item {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    padding: 3px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .item.h1 {
    font-weight: 600;
  }
  .none {
    color: var(--text-muted);
    font-size: var(--fs-small);
    padding: 8px 12px;
    margin: 0;
  }
</style>
