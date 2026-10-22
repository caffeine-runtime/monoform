<script lang="ts">
  // Split view chrome over the tab views: draggable dividers between panes,
  // and drop zones while a tab is dragged from the tab bar (drop on an edge
  // to split, in the middle to replace).
  import { onMount } from 'svelte';
  import { t } from '../core/i18n';
  import { workspace } from '../core/tabs.svelte';
  import { tabDrag } from '../core/tabdrag.svelte';
  import { dividers, dropInto, paneRect, type Edge, type Rect } from '../core/split';

  let host = $state<HTMLDivElement>();
  // A tab is being dragged over the views (with another tab to split with).
  const dragging = $derived(!!tabDrag.id && tabDrag.zone === 'views' && workspace.tabs.length > 1);
  const hover = $derived(dragging ? zoneAt(tabDrag.x, tabDrag.y) : null);
  const s = $derived(workspace.split);
  const dv = $derived(s ? dividers(s) : { x: false, y: false });

  /** The pane (or whole view) under a point and the edge zone within it. */
  function zoneAt(x: number, y: number): { target: string; edge: Edge; rect: Rect } | null {
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const fx = (x - r.left) / r.width;
    const fy = (y - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    let target = workspace.activeId;
    let pr: Rect = { left: 0, top: 0, width: 1, height: 1 };
    if (s) {
      const i = s.panes.findIndex((_, k) => {
        const p = paneRect(s, k);
        return fx >= p.left && fx < p.left + p.width && fy >= p.top && fy < p.top + p.height;
      });
      if (i < 0) return null;
      target = s.panes[i];
      pr = paneRect(s, i);
    }
    if (!target) return null;
    const lx = (fx - pr.left) / pr.width;
    const ly = (fy - pr.top) / pr.height;
    const d = Math.min(lx, 1 - lx, ly, 1 - ly);
    const edge: Edge = d > 0.25 ? 'center' : d === lx ? 'left' : d === 1 - lx ? 'right' : d === ly ? 'top' : 'bottom';
    // Highlight the half (or the whole pane for "replace") the tab would take.
    const half: Record<Edge, Rect> = {
      left: { left: pr.left, top: pr.top, width: pr.width / 2, height: pr.height },
      right: { left: pr.left + pr.width / 2, top: pr.top, width: pr.width / 2, height: pr.height },
      top: { left: pr.left, top: pr.top, width: pr.width, height: pr.height / 2 },
      bottom: { left: pr.left, top: pr.top + pr.height / 2, width: pr.width, height: pr.height / 2 },
      center: pr,
    };
    return { target, edge, rect: half[edge] };
  }

  /** Drop a tab on the view under a point: an edge splits, the middle replaces. */
  function drop(id: string, x: number, y: number): boolean {
    const z = zoneAt(x, y);
    const tab = workspace.tabs.find((t) => t.id === id);
    if (!z || !tab || workspace.tabs.length < 2) return false;
    if (z.edge === 'center' && !s) workspace.activate(tab);
    else {
      workspace.setSplit(dropInto(s, id, z.target, z.edge));
      workspace.activate(tab);
    }
    return true;
  }
  onMount(() => {
    tabDrag.dropOnViews = drop;
    return () => {
      if (tabDrag.dropOnViews === drop) tabDrag.dropOnViews = null;
    };
  });

  // ---- dividers ----
  let drag = $state<'x' | 'y' | null>(null);
  function down(e: PointerEvent, axis: 'x' | 'y') {
    if (e.button !== 0) return;
    drag = axis;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!drag || !host || !s) return;
    const r = host.getBoundingClientRect();
    const v = drag === 'x' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    workspace.split = { ...s, [drag]: Math.min(0.85, Math.max(0.15, v)) };
  }
  function up() {
    if (!drag) return;
    drag = null;
    workspace.setSplit(workspace.split); // persist + let panes re-measure
  }
  /** Set a divider (double-click: back to the middle; arrow keys nudge it). */
  function place(axis: 'x' | 'y', v: number) {
    if (!s) return;
    workspace.setSplit({ ...s, [axis]: Math.min(0.85, Math.max(0.15, v)) });
  }
  function key(e: KeyboardEvent, axis: 'x' | 'y') {
    if (!s) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    place(axis, s[axis] + (e.key === fwd ? step : -step));
  }
  const share = (v: number) => `${Math.round(v * 100)} % · ${Math.round((1 - v) * 100)} %`;
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
</script>


<div class="split-overlay" class:active={dragging} bind:this={host} role="presentation">
  {#if s}
    {#if dv.x}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="div x"
        class:dragging={drag === 'x'}
        style:left={pct(s.x)}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Resize panes')}
        aria-valuenow={Math.round(s.x * 100)}
        tabindex="0"
        title={t('Drag to resize · double-click: equal sizes')}
        onpointerdown={(e) => down(e, 'x')}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        ondblclick={() => place('x', 0.5)}
        onkeydown={(e) => key(e, 'x')}
      >
        <span class="grip"></span>
        {#if drag === 'x'}<span class="pct">{share(s.x)}</span>{/if}
      </div>
    {/if}
    {#if dv.y}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="div y"
        class:dragging={drag === 'y'}
        style:top={pct(s.y)}
        style:left={s.layout === 'grid' && s.panes.length === 3 ? pct(s.x) : '0'}
        style:right="0"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Resize panes')}
        aria-valuenow={Math.round(s.y * 100)}
        tabindex="0"
        title={t('Drag to resize · double-click: equal sizes')}
        onpointerdown={(e) => down(e, 'y')}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        ondblclick={() => place('y', 0.5)}
        onkeydown={(e) => key(e, 'y')}
      >
        <span class="grip"></span>
        {#if drag === 'y'}<span class="pct">{share(s.y)}</span>{/if}
      </div>
    {/if}
  {/if}
  {#if dragging && hover}
    <div class="zone" style:left={pct(hover.rect.left)} style:top={pct(hover.rect.top)} style:width={pct(hover.rect.width)} style:height={pct(hover.rect.height)}>
      <span>{hover.edge === 'center' ? (s ? t('Show here') : t('Open')) : t('Split here')}</span>
    </div>
  {/if}
</div>

<style>
  .split-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
  }
  .split-overlay.active {
    pointer-events: auto;
  }
  .div {
    position: absolute;
    pointer-events: auto;
    z-index: 2;
  }
  .div.x {
    top: 0;
    bottom: 0;
    width: 8px;
    margin-left: -4px;
    cursor: col-resize;
  }
  .div.y {
    height: 8px;
    margin-top: -4px;
    cursor: row-resize;
  }
  .div {
    display: grid;
    place-items: center;
    touch-action: none;
  }
  .div:hover,
  .div.dragging,
  .div:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }
  /* A small handle in the middle so the divider can be found without hovering. */
  .grip {
    border-radius: 3px;
    background: var(--border);
    opacity: 0.9;
  }
  .div.x .grip {
    width: 4px;
    height: 32px;
  }
  .div.y .grip {
    width: 32px;
    height: 4px;
  }
  .div:hover .grip,
  .div.dragging .grip,
  .div:focus-visible .grip {
    background: var(--accent);
  }
  .pct {
    position: absolute;
    white-space: nowrap;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: var(--fs-small);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    pointer-events: none;
  }
  .div.x .pct {
    top: 40%;
  }
  .div.y .pct {
    left: 40%;
  }
  .zone {
    position: absolute;
    background: var(--accent-soft);
    border: 2px dashed var(--accent);
    border-radius: 8px;
    display: grid;
    place-items: center;
    pointer-events: none;
    transition:
      left 0.08s,
      top 0.08s,
      width 0.08s,
      height 0.08s;
  }
  .zone span {
    background: var(--bg-elevated);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: var(--fs-small);
  }
</style>
