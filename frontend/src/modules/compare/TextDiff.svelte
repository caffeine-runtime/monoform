<script lang="ts">
  // Side-by-side text diff. Only the rows on screen are rendered; their line
  // text is fetched from the worker in windows. Changed lines show the
  // changed words; an overview strip marks every change and jumps on click.
  import { onMount, untrack } from 'svelte';
  import { ADDED, CHANGE, REMOVED, SAME, wordDiff, type Seg } from './diff';
  import type { DiffClient } from './diffClient';
  import { t, tn } from '../../core/i18n';

  let {
    client,
    rows,
    disp,
    gaps,
    widths,
    current = $bindable(-1),
    hunks,
    onexpand,
  }: {
    client: DiffClient;
    rows: Int32Array;
    /** Displayed entries: row index, or -1 - g for a folded gap. */
    disp: Int32Array;
    gaps: [number, number][];
    widths: [number, number];
    current: number;
    hunks: [number, number][];
    onexpand: (g: number) => void;
  } = $props();

  const ROW = 20;
  let vs = $state<HTMLDivElement>();
  let strip = $state<HTMLCanvasElement>();
  let top = $state(0);
  let height = $state(400);
  let version = $state(0);
  const cache: [Map<number, string>, Map<number, string>] = [new Map(), new Map()];
  const inflight: [boolean, boolean] = [false, false];
  const words = new Map<number, [Seg[], Seg[]]>();

  const first = $derived(Math.max(0, Math.floor(top / ROW)));
  const count = $derived(Math.ceil(height / ROW) + 1);
  const visible = $derived.by(() => {
    void version;
    const out: { d: number; row: number; gap: number }[] = [];
    for (let i = first; i < Math.min(disp.length, first + count); i++) {
      const v = disp[i];
      out.push(v >= 0 ? { d: i, row: v, gap: -1 } : { d: i, row: -1, gap: -1 - v });
    }
    return out;
  });

  // New diff: forget cached text and word diffs (before anything reads them).
  let seenRows: Int32Array | null = null;
  $effect.pre(() => {
    if (rows === seenRows) return;
    seenRows = rows;
    cache[0].clear();
    cache[1].clear();
    words.clear();
    untrack(() => version++);
  });

  // Fetch the line text the visible rows need.
  $effect(() => {
    const need: [number[], number[]] = [[], []];
    for (const v of visible) {
      if (v.row < 0) continue;
      const a = rows[v.row * 3 + 1];
      const b = rows[v.row * 3 + 2];
      if (a >= 0 && !cache[0].has(a)) need[0].push(a);
      if (b >= 0 && !cache[1].has(b)) need[1].push(b);
    }
    for (const side of [0, 1] as const) {
      if (!need[side].length || inflight[side]) continue;
      inflight[side] = true;
      const lo = Math.max(0, Math.min(...need[side]) - 200);
      const hi = Math.max(...need[side]) + 200;
      void client
        .call<{ lines: string[] }>({ type: 'lines', side, start: lo, end: hi })
        .then((r) => {
          if (cache[side].size > 200_000) cache[side].clear();
          r.lines.forEach((l, i) => cache[side].set(lo + i, l));
          untrack(() => version++);
        })
        .finally(() => (inflight[side] = false));
    }
  });

  function segs(row: number): [Seg[], Seg[]] | null {
    const k = rows[row * 3];
    const a = cache[0].get(rows[row * 3 + 1]);
    const b = cache[1].get(rows[row * 3 + 2]);
    if (k !== CHANGE || a === undefined || b === undefined) return null;
    let w = words.get(row);
    if (!w) {
      w = a.length + b.length < 4000 ? wordDiff(a, b) : [[{ text: a, changed: true }], [{ text: b, changed: true }]];
      words.set(row, w);
    }
    return w;
  }

  const kindClass = (k: number) => (k === SAME ? '' : k === CHANGE ? 'chg' : k === REMOVED ? 'del' : 'add');

  /** Scroll so a row (by row index) is near the top third. */
  export function reveal(row: number) {
    if (!vs) return;
    const d = disp.findIndex((v) => v === row || (v < 0 && gaps[-1 - v][0] <= row && row < gaps[-1 - v][0] + gaps[-1 - v][1]));
    if (d >= 0) vs.scrollTop = Math.max(0, d * ROW - height / 3);
  }

  function wheel(e: WheelEvent) {
    if (!vs) return;
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dx = e.deltaX || e.deltaY;
      const pane = (e.target as HTMLElement).closest('.pane') as HTMLElement | null;
      if (pane) pane.scrollLeft += dx;
    } else vs.scrollTop += e.deltaY;
  }

  function drawStrip() {
    const c = strip;
    if (!c) return;
    const h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = 10 * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const total = rows.length / 3 || 1;
    for (const [s, e] of hunks) {
      const k = rows[s * 3];
      ctx.fillStyle = k === ADDED ? '#3fb950' : k === REMOVED ? '#f85149' : '#d29922';
      const y = (s / total) * h;
      ctx.fillRect(0, y, 10, Math.max(2, ((e - s) / total) * h));
    }
  }

  function stripClick(e: MouseEvent) {
    const r = strip!.getBoundingClientRect();
    const row = Math.floor(((e.clientY - r.top) / r.height) * (rows.length / 3));
    reveal(row);
  }

  $effect(() => {
    void hunks;
    void rows;
    drawStrip();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      height = vs?.clientHeight ?? 400;
      drawStrip();
    });
    if (vs) ro.observe(vs);
    return () => ro.disconnect();
  });

  const lineNo = (n: number) => (n >= 0 ? String(n + 1) : '');
  const curRange = $derived(current >= 0 ? hunks[current] : null);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tdiff" onwheel={wheel}>
  {#each [0, 1] as side (side)}
    <div class="pane" data-side={side}>
      <div class="rows" style:transform="translateY({first * ROW - top}px)" style:min-width="calc({widths[side] + 8}ch + 56px)">
        {#each visible as v (v.d)}
          {#if v.gap >= 0}
            <button class="row gap" style:height="{ROW}px" onclick={() => onexpand(v.gap)}>⋯ {tn('{n} unchanged line — click to show', '{n} unchanged lines — click to show', gaps[v.gap][1])}</button>
          {:else}
            {@const k = rows[v.row * 3]}
            {@const ln = rows[v.row * 3 + 1 + side]}
            {@const s = segs(v.row)}
            <div class="row {ln < 0 ? 'blank' : kindClass(k)}" class:cur={curRange && v.row >= curRange[0] && v.row < curRange[1]} style:height="{ROW}px">
              <span class="ln">{lineNo(ln)}</span>
              <span class="tx">{#if ln >= 0}{#if s}{#each s[side] as g, gi (gi)}<span class:w={g.changed}>{g.text}</span>{/each}{:else}{cache[side].get(ln) ?? ''}{/if}{/if}</span>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/each}
  <canvas class="strip" bind:this={strip} onclick={stripClick} title={t('Overview of the changes — click to jump')}></canvas>
  <div class="vs" bind:this={vs} onscroll={() => (top = vs!.scrollTop)}>
    <div style:height="{disp.length * ROW}px"></div>
  </div>
</div>

<style>
  .tdiff {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    font-family: var(--font-mono);
    font-size: calc(12.5px * var(--ui-scale));
    background: var(--bg);
  }
  .pane {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;
  }
  .pane + .pane {
    border-left: 1px solid var(--border);
  }
  .rows {
    position: absolute;
    left: 0;
    top: 0;
    width: max-content;
  }
  .row {
    display: flex;
    align-items: center;
    white-space: pre;
    line-height: 20px;
  }
  .ln {
    width: 48px;
    flex: none;
    text-align: right;
    padding-right: 8px;
    color: var(--text-faint);
    user-select: none;
    position: sticky;
    left: 0;
    background: inherit;
  }
  .tx {
    padding-right: 16px;
  }
  .row.chg {
    background: rgba(210, 153, 34, 0.14);
  }
  .row.del {
    background: rgba(248, 81, 73, 0.16);
  }
  .row.add {
    background: rgba(63, 185, 80, 0.16);
  }
  .row.blank {
    background: repeating-linear-gradient(-45deg, transparent 0 6px, var(--bg-hover) 6px 8px);
  }
  .row.cur {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .pane[data-side='0'] .row.chg .w {
    background: rgba(248, 81, 73, 0.4);
    border-radius: 2px;
  }
  .pane[data-side='1'] .row.chg .w {
    background: rgba(63, 185, 80, 0.4);
    border-radius: 2px;
  }
  .row.gap {
    width: 100%;
    border: none;
    background: var(--bg-sidebar);
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    justify-content: center;
  }
  .row.gap:hover {
    color: var(--text);
  }
  .strip {
    width: 10px;
    flex: none;
    cursor: pointer;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border-soft);
  }
  .vs {
    width: 14px;
    flex: none;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
