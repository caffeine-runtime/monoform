<script lang="ts">
  import { settings } from '../../core/settings.svelte';
  // Virtualized JSON/YAML tree. Children load lazily from the data worker;
  // big arrays/objects page in 500 entries at a time.
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import type { DataClient, TreeNode } from './dataClient';
  import { formatPath } from './jsonparse';
  import { t } from '../../core/i18n';

  let { client, root, version = 0, onselect }: { client: DataClient; root: TreeNode; version?: number; onselect?: (n: TreeNode) => void } = $props();

  // Row height follows the interface scale; CSS reads it from --row.
  const ROW = $derived(Math.round(24 * (settings.value.uiScale || 1)));
  const PAGE = 500;
  type Row = { kind: 'node'; node: TreeNode; depth: number } | { kind: 'more'; parent: string; depth: number; remaining: number; path: (string | number)[] };

  const kids = new SvelteMap<string, { nodes: TreeNode[]; total: number }>();
  const expanded = new SvelteSet<string>();
  let selected = $state<string>('[]');
  let box = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(400);
  let seenVersion = -1;

  const keyOf = (path: (string | number)[]) => JSON.stringify(path);

  $effect(() => {
    // New parse result: keep expansion state, reload children.
    if (version === seenVersion) return;
    seenVersion = version;
    kids.clear();
    if (!expanded.size) expanded.add('[]');
    for (const k of [...expanded]) void load(JSON.parse(k));
  });

  async function load(path: (string | number)[], append = false) {
    const k = keyOf(path);
    const have = kids.get(k);
    const offset = append && have ? have.nodes.length : 0;
    const r = await client.children(path, offset, PAGE);
    kids.set(k, append && have ? { nodes: [...have.nodes, ...r.nodes], total: r.total } : r);
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (n: TreeNode, depth: number) => {
      out.push({ kind: 'node', node: n, depth });
      const k = keyOf(n.path);
      if (!expanded.has(k)) return;
      const c = kids.get(k);
      if (!c) return;
      for (const child of c.nodes) walk(child, depth + 1);
      if (c.nodes.length < c.total) out.push({ kind: 'more', parent: k, depth: depth + 1, remaining: c.total - c.nodes.length, path: n.path });
    };
    walk(root, 0);
    return out;
  });

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 10));
  const end = $derived(Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 10));

  function toggle(n: TreeNode, open?: boolean) {
    if (n.type !== 'object' && n.type !== 'array') return;
    const k = keyOf(n.path);
    const want = open ?? !expanded.has(k);
    if (want) {
      expanded.add(k);
      if (!kids.has(k)) void load(n.path);
    } else expanded.delete(k);
  }

  function select(n: TreeNode) {
    selected = keyOf(n.path);
    onselect?.(n);
  }

  export async function expandAll(limit = 2000) {
    // Breadth-first, bounded so a huge document can't explode the DOM.
    let queue: TreeNode[] = [root];
    let opened = 0;
    while (queue.length && opened < limit) {
      const next: TreeNode[] = [];
      for (const n of queue) {
        if (n.type !== 'object' && n.type !== 'array') continue;
        const k = keyOf(n.path);
        expanded.add(k);
        if (!kids.has(k)) await load(n.path);
        opened++;
        next.push(...(kids.get(k)?.nodes ?? []));
        if (opened >= limit) break;
      }
      queue = next;
    }
  }

  export function collapseAll() {
    expanded.clear();
    expanded.add('[]');
  }

  export function selectedPath(): (string | number)[] {
    return JSON.parse(selected);
  }

  function key(e: KeyboardEvent) {
    const idx = rows.findIndex((r) => r.kind === 'node' && keyOf(r.node.path) === selected);
    const row = rows[idx];
    let next = idx;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'ArrowRight' && row?.kind === 'node') {
      if ((row.node.type === 'object' || row.node.type === 'array') && !expanded.has(keyOf(row.node.path))) toggle(row.node, true);
      else next = idx + 1;
    } else if (e.key === 'ArrowLeft' && row?.kind === 'node') {
      if (expanded.has(keyOf(row.node.path)) && row.node.path.length) toggle(row.node, false);
      else for (let i = idx - 1; i >= 0; i--) if (rows[i].depth < row.depth) { next = i; break; }
    } else if (e.key === 'Enter' && row?.kind === 'more') void load(row.path, true);
    else return;
    e.preventDefault();
    const r = rows[next];
    if (r?.kind === 'node') select(r.node);
    if (box) {
      const top = next * ROW;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + ROW > box.scrollTop + height) box.scrollTop = top + ROW - height;
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="tree selectable" style:--row="{ROW}px" bind:this={box} bind:clientHeight={height} onscroll={() => (scrollTop = box!.scrollTop)} tabindex="0" role="tree" onkeydown={key}>
  <div class="spacer" style:height="{rows.length * ROW}px">
    {#each rows.slice(start, end) as r, i (r.kind === 'node' ? keyOf(r.node.path) : 'more' + r.parent)}
      {#if r.kind === 'node'}
        {@const n = r.node}
        {@const container = n.type === 'object' || n.type === 'array'}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="row"
          class:sel={selected === keyOf(n.path)}
          style:top="{(start + i) * ROW}px"
          style:padding-left="{10 + r.depth * 16}px"
          role="treeitem"
          tabindex="-1"
          aria-selected={selected === keyOf(n.path)}
          aria-expanded={container ? expanded.has(keyOf(n.path)) : undefined}
          title={formatPath(n.path)}
          onclick={() => {
            select(n);
            toggle(n);
          }}
        >
          <span class="chev" class:open={expanded.has(keyOf(n.path))}>{container ? '›' : ''}</span>
          <span class="k" class:idx={typeof n.key === 'number'}>{n.path.length === 0 ? t('root') : n.key}</span>
          <span class="colon">:</span>
          <span class="v {n.type}">{n.preview}</span>
        </div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="row more" style:top="{(start + i) * ROW}px" style:padding-left="{26 + r.depth * 16}px" onclick={() => load(r.path, true)}>
          {t('Show {n} more ({remaining} remaining)', { n: Math.min(PAGE, r.remaining), remaining: r.remaining })}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .tree {
    height: 100%;
    overflow: auto;
    outline: none;
    font-family: var(--font-mono);
    font-size: calc(12.5px * var(--ui-scale));
    padding: 6px 0;
  }
  .spacer {
    position: relative;
    min-width: 100%;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--row);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: pre;
    cursor: pointer;
    padding-right: 16px;
  }
  .row:hover {
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
  }
  .row.sel {
    background: var(--bg-hover);
  }
  .chev {
    width: 12px;
    color: var(--text-faint);
    display: inline-block;
    transition: transform 0.1s;
    text-align: center;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .k {
    color: var(--syn-property);
  }
  .k.idx {
    color: var(--text-faint);
  }
  .colon {
    color: var(--text-faint);
    margin-right: 4px;
  }
  .v {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .v.string {
    color: var(--syn-string);
  }
  .v.number {
    color: var(--syn-number);
  }
  .v.boolean,
  .v.null {
    color: var(--syn-keyword);
  }
  .v.object,
  .v.array {
    color: var(--text-muted);
  }
  .more {
    color: var(--accent-text);
    font-family: var(--font-ui);
  }
</style>
