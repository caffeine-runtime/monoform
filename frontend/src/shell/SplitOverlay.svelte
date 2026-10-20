<script lang="ts">
  // Split view chrome over the tab views: draggable dividers between panes,
  // and drop zones while a tab is dragged from the tab bar (drop on an edge
  // to split, in the middle to replace).
  import { workspace } from '../core/tabs.svelte';
  import { dividers, dropInto, paneRect, type Edge, type Rect } from '../core/split';

  let host = $state<HTMLDivElement>();
  let dragging = $state(false); // a tab is being dragged over the views
  let hover = $state<{ target: string; edge: Edge; rect: Rect } | null>(null);
  const s = $derived(workspace.split);
  const dv = $derived(s ? dividers(s) : { x: false, y: false });

  /** The pane (or whole view) under a point and the edge zone within it. */
  function zoneAt(e: DragEvent): { target: string; edge: Edge; rect: Rect } | null {
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
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

  function isTabDrag(e: DragEvent) {
    return !!e.dataTransfer?.types.includes('application/x-hia-tab');
  }

  // A tab drag from the tab bar turns the overlay on, so the views below don't take the drop.
  function onWindowDragStart(e: DragEvent) {
    if (isTabDrag(e) && workspace.tabs.length > 1) dragging = true;
  }

  function over(e: DragEvent) {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    dragging = true;
    hover = zoneAt(e);
  }

  function drop(e: DragEvent) {
    const id = e.dataTransfer?.getData('application/x-hia-tab');
    dragging = false;
    const z = hover ?? zoneAt(e);
    hover = null;
    if (!id || !z) return;
    e.preventDefault();
    const tab = workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (z.edge === 'center' && !s) workspace.activate(tab);
    else {
      workspace.setSplit(dropInto(s, id, z.target, z.edge));
      workspace.activate(tab);
    }
  }

  // ---- dividers ----
  let drag: 'x' | 'y' | null = null;
  function down(e: PointerEvent, axis: 'x' | 'y') {
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
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
</script>

<svelte:window ondragstart={onWindowDragStart} ondragend={() => ((dragging = false), (hover = null))} />

<div class="split-overlay" class:active={dragging} bind:this={host} role="presentation" ondragover={over} ondragenter={over} ondragleave={(e) => e.target === host && ((dragging = false), (hover = null))} ondrop={drop}>
  {#if s}
    {#if dv.x}
      <div class="div x" style:left={pct(s.x)} role="separator" aria-orientation="vertical" aria-label="Resize panes" title="Drag to resize" onpointerdown={(e) => down(e, 'x')} onpointermove={move} onpointerup={up}></div>
    {/if}
    {#if dv.y}
      <div
        class="div y"
        style:top={pct(s.y)}
        style:left={s.layout === 'grid' && s.panes.length === 3 ? pct(s.x) : '0'}
        style:right="0"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panes"
        title="Drag to resize"
        onpointerdown={(e) => down(e, 'y')}
        onpointermove={move}
        onpointerup={up}
      ></div>
    {/if}
  {/if}
  {#if dragging && hover}
    <div class="zone" style:left={pct(hover.rect.left)} style:top={pct(hover.rect.top)} style:width={pct(hover.rect.width)} style:height={pct(hover.rect.height)}>
      <span>{hover.edge === 'center' ? (s ? 'Show here' : 'Open') : 'Split here'}</span>
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
  .div:hover {
    background: var(--accent-soft);
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
