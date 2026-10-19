<script lang="ts" module>
  export interface GridColumn {
    name: string;
    width: number;
  }
  export interface GridSource {
    /** Fetch rows [start, end) of the current view. */
    rows(start: number, end: number): Promise<string[][]>;
  }
</script>

<script lang="ts">
  // Virtualized, keyboard-driven table. Rows are fetched in blocks from the
  // source (a worker or Go) so only what's on screen lives on the main thread.
  // Very tall tables (millions of rows) use a scaled scrollbar because
  // browsers cap element heights.
  import { tick } from 'svelte';

  let {
    source,
    rowCount,
    columns = $bindable(),
    version = 0,
    editable = false,
    sortCol = -1,
    sortDir = 1,
    rowLabel = (i: number) => String(i + 1),
    onsort,
    onedit,
    oncursor,
    onheaderedit,
    oncontext,
  }: {
    source: GridSource;
    rowCount: number;
    columns: GridColumn[];
    version?: number;
    editable?: boolean;
    sortCol?: number;
    sortDir?: number;
    rowLabel?: (i: number) => string;
    onsort?: (col: number) => void;
    onedit?: (row: number, col: number, value: string) => Promise<void> | void;
    oncursor?: (row: number, col: number) => void;
    onheaderedit?: (col: number) => void;
    oncontext?: (e: MouseEvent, row: number, col: number) => void;
  } = $props();

  const ROW = 28;
  const HEAD = 32;
  const BLOCK = 200;
  const MAX_PX = 8_000_000;
  const NUM_W = $derived(Math.max(48, String(rowCount).length * 8 + 22));

  let scroller = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let viewH = $state(400);
  let cache = $state(new Map<number, string[][]>());
  let pending = new Set<number>();
  let cur = $state({ row: 0, col: 0 });
  let editing = $state<{ row: number; col: number; value: string } | null>(null);
  let editInput = $state<HTMLInputElement>();
  let cacheVersion = -1;

  const totalH = $derived(rowCount * ROW);
  const scaled = $derived(totalH > MAX_PX);
  const spacerH = $derived(scaled ? MAX_PX : totalH);
  const bodyH = $derived(Math.max(0, viewH - HEAD));
  const visibleCount = $derived(Math.ceil(bodyH / ROW) + 1);
  // Virtual scroll position in "real" row pixels. Rows sit at r * ROW inside
  // one container moved by a single transform, so scrolling only moves that
  // container and adds/removes a few rows.
  const virtualTop = $derived.by(() => {
    if (!scaled) return scrollTop;
    const maxScroll = Math.max(1, spacerH - bodyH);
    return (Math.min(scrollTop, maxScroll) / maxScroll) * Math.max(0, totalH - bodyH);
  });
  const first = $derived(Math.max(0, Math.floor(virtualTop / ROW)));
  const totalW = $derived(NUM_W + columns.reduce((a, c) => a + c.width, 0));
  const visibleRows = $derived(Array.from({ length: Math.max(0, Math.min(visibleCount, rowCount - first)) }, (_, i) => first + i));

  $effect(() => {
    // Source changed (sort, filter, edit): drop cached blocks.
    if (version !== cacheVersion) {
      cacheVersion = version;
      cache = new Map();
      pending.clear();
    }
    const a = Math.floor(first / BLOCK);
    const b = Math.floor((first + visibleCount) / BLOCK);
    for (let k = a; k <= b; k++) load(k, version);
  });

  function load(block: number, v: number) {
    if (cache.has(block) || pending.has(block) || block * BLOCK >= rowCount) return;
    pending.add(block);
    source
      .rows(block * BLOCK, Math.min(rowCount, (block + 1) * BLOCK))
      .then((r) => {
        if (v !== cacheVersion) return;
        const next = new Map(cache);
        next.set(block, r);
        // Keep memory bounded.
        if (next.size > 60) next.delete(next.keys().next().value!);
        cache = next;
      })
      .finally(() => pending.delete(block));
  }

  function cell(row: number, col: number): string | undefined {
    const b = cache.get(Math.floor(row / BLOCK));
    if (!b) return undefined;
    return b[row % BLOCK]?.[col] ?? '';
  }

  function rowTop(row: number): number {
    return HEAD + row * ROW - virtualTop;
  }

  /** Scroll so `row` is visible. */
  function reveal(row: number) {
    if (!scroller) return;
    if (!scaled) {
      const top = row * ROW;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + ROW > scroller.scrollTop + bodyH) scroller.scrollTop = top + ROW - bodyH;
    } else if (row < first || row >= first + visibleCount - 1) {
      const maxScroll = Math.max(1, spacerH - bodyH);
      const target = row < first ? row : row - visibleCount + 2;
      scroller.scrollTop = (Math.max(0, target) / Math.max(1, rowCount - visibleCount + 1)) * maxScroll;
    }
    scrollTop = scroller.scrollTop;
  }

  function revealCol(col: number) {
    if (!scroller) return;
    let x = NUM_W;
    for (let c = 0; c < col; c++) x += columns[c].width;
    const w = columns[col]?.width ?? 0;
    if (x - NUM_W < scroller.scrollLeft) scroller.scrollLeft = x - NUM_W;
    else if (x + w > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = x + w - scroller.clientWidth;
  }

  export function moveTo(row: number, col: number) {
    cur = { row: Math.max(0, Math.min(rowCount - 1, row)), col: Math.max(0, Math.min(columns.length - 1, col)) };
    reveal(cur.row);
    revealCol(cur.col);
    oncursor?.(cur.row, cur.col);
  }

  export function focus() {
    scroller?.focus();
  }

  export function cursor() {
    return { ...cur };
  }

  async function startEdit(initial?: string) {
    if (!editable || rowCount === 0) return;
    const v = initial ?? cell(cur.row, cur.col) ?? '';
    editing = { row: cur.row, col: cur.col, value: v };
    await tick();
    editInput?.focus();
    if (initial === undefined) editInput?.select();
  }

  async function commit(move: 'down' | 'right' | 'none' = 'none') {
    const e = editing;
    if (!e) return;
    editing = null;
    if (e.value !== (cell(e.row, e.col) ?? '')) await onedit?.(e.row, e.col, e.value);
    if (move === 'down') moveTo(e.row + 1, e.col);
    else if (move === 'right') moveTo(e.row, e.col + 1);
    scroller?.focus();
  }

  function editKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commit('down');
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      void commit('right');
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      editing = null;
      scroller?.focus();
    }
    ev.stopPropagation();
  }

  function key(ev: KeyboardEvent) {
    if (editing) return;
    const page = Math.max(1, visibleCount - 2);
    const mod = ev.ctrlKey || ev.metaKey;
    let { row, col } = cur;
    switch (ev.key) {
      case 'ArrowDown':
        row = mod ? rowCount - 1 : row + 1;
        break;
      case 'ArrowUp':
        row = mod ? 0 : row - 1;
        break;
      case 'ArrowRight':
        col = mod ? columns.length - 1 : col + 1;
        break;
      case 'ArrowLeft':
        col = mod ? 0 : col - 1;
        break;
      case 'PageDown':
        row += page;
        break;
      case 'PageUp':
        row -= page;
        break;
      case 'Home':
        if (mod) row = 0;
        col = 0;
        break;
      case 'End':
        if (mod) row = rowCount - 1;
        col = columns.length - 1;
        break;
      case 'Tab':
        col += ev.shiftKey ? -1 : 1;
        break;
      case 'Enter':
      case 'F2':
        ev.preventDefault();
        void startEdit();
        return;
      case 'Delete':
      case 'Backspace':
        if (editable && !mod) {
          ev.preventDefault();
          void onedit?.(cur.row, cur.col, '');
        }
        return;
      case 'c':
        if (mod) {
          const v = cell(cur.row, cur.col);
          if (v !== undefined) void navigator.clipboard.writeText(v);
          ev.preventDefault();
        }
        return;
      default:
        if (editable && ev.key.length === 1 && !mod && !ev.altKey) {
          ev.preventDefault();
          void startEdit(ev.key);
        }
        return;
    }
    ev.preventDefault();
    moveTo(row, col);
  }

  // Column resizing.
  let resizing: { col: number; x: number; w: number } | null = null;
  function resizeStart(e: PointerEvent, col: number) {
    e.stopPropagation();
    resizing = { col, x: e.clientX, w: columns[col].width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function resizeMove(e: PointerEvent) {
    if (!resizing) return;
    columns[resizing.col].width = Math.max(40, resizing.w + e.clientX - resizing.x);
  }
  function resizeEnd() {
    resizing = null;
  }

  function clickCell(e: MouseEvent, row: number, col: number) {
    if (editing) void commit();
    moveTo(row, col);
    if (e.detail === 2) void startEdit();
  }

  function colLeft(col: number) {
    let x = NUM_W;
    for (let c = 0; c < col; c++) x += columns[c].width;
    return x;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="grid" bind:this={scroller} bind:clientHeight={viewH} onscroll={() => (scrollTop = scroller!.scrollTop)} tabindex="0" role="grid" aria-rowcount={rowCount} onkeydown={key}>
  <div class="layer" style:height="{viewH}px" style:width="{totalW}px">
    <div class="head" style:height="{HEAD}px">
      <div class="num corner" style:width="{NUM_W}px"></div>
      {#each columns as c, i (i)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
        <div class="th" style:width="{c.width}px" role="columnheader" title="{c.name} — click to sort{editable && onheaderedit ? ', double-click to rename' : ''}" onclick={() => onsort?.(i)} ondblclick={() => onheaderedit?.(i)}>
          <span class="tn">{c.name}</span>
          {#if sortCol === i}<span class="sort">{sortDir > 0 ? '▲' : '▼'}</span>{/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="rz" onpointerdown={(e) => resizeStart(e, i)} onpointermove={resizeMove} onpointerup={resizeEnd} onclick={(e) => e.stopPropagation()}></span>
        </div>
      {/each}
    </div>
    <div class="rows" style:transform="translate3d(0, {HEAD - virtualTop}px, 0)">
    {#each visibleRows as r (r)}
      <div class="tr" class:cur-row={r === cur.row} style:top="{r * ROW}px" role="row">
        <div class="num" style:width="{NUM_W}px">{rowLabel(r)}</div>
        {#each columns as c, i (i)}
          {@const v = cell(r, i)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="td"
            class:cur={r === cur.row && i === cur.col}
            class:loading={v === undefined}
            style:width="{c.width}px"
            role="gridcell"
            tabindex="-1"
            title={v && v.length > 40 ? v : undefined}
            onclick={(e) => clickCell(e, r, i)}
            oncontextmenu={(e) => {
              moveTo(r, i);
              oncontext?.(e, r, i);
            }}
          >
            {v ?? ''}
          </div>
        {/each}
      </div>
    {/each}
    </div>
    {#if editing}
      <input
        class="editor"
        bind:this={editInput}
        bind:value={editing.value}
        onkeydown={editKey}
        onblur={() => commit()}
        style:top="{rowTop(editing.row)}px"
        style:left="{colLeft(editing.col)}px"
        style:width="{Math.max(columns[editing.col].width, 160)}px"
      />
    {/if}
  </div>
  <div style:height="{Math.max(0, spacerH + HEAD - viewH)}px"></div>
</div>

<style>
  .grid {
    position: relative;
    overflow: auto;
    height: 100%;
    outline: none;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .layer {
    position: sticky;
    top: 0;
    overflow: hidden;
  }
  .head {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    z-index: 4;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
  }
  .th {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    border-right: 1px solid var(--border-soft);
    flex: none;
  }
  .th:hover {
    background: var(--bg-hover);
  }
  .tn {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sort {
    color: var(--accent-text);
    font-size: 9px;
  }
  .rz {
    position: absolute;
    right: -3px;
    top: 0;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }
  .rows {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
  .tr {
    position: absolute;
    left: 0;
    height: 28px;
    display: flex;
    border-bottom: 1px solid var(--border-soft);
  }
  .tr.cur-row .num {
    color: var(--text);
    background: var(--bg-hover);
  }
  .num {
    flex: none;
    padding: 0 8px;
    text-align: right;
    color: var(--text-faint);
    background: var(--bg-sidebar);
    line-height: 28px;
    position: sticky;
    left: 0;
    z-index: 1;
    border-right: 1px solid var(--border-soft);
  }
  .corner {
    line-height: 32px;
  }
  .td {
    flex: none;
    padding: 0 10px;
    line-height: 27px;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    border-right: 1px solid var(--border-soft);
    cursor: cell;
  }
  .td.loading {
    color: transparent;
  }
  .td.cur {
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: 2px;
  }
  .editor {
    position: absolute;
    height: 28px;
    z-index: 3;
    padding: 0 9px;
    border: 2px solid var(--accent);
    border-radius: 3px;
    background: var(--bg-input);
    outline: none;
    font: inherit;
    box-shadow: var(--shadow);
  }
</style>
