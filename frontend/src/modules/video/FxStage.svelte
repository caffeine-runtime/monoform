<script lang="ts">
  // Boxes over the preview for the layers visible now: drag to move, the
  // corner to scale, the knob to rotate. The selected layer also shows its
  // motion path with a dot per keyframe. A freeform mask shows its outline
  // with draggable points; in drawing mode a drag over the picture draws a
  // new outline.
  import { maskOf, stateAt, visibleAt, withMask, type Layer, type Pt, type State } from './project';

  let {
    W,
    H,
    stageW,
    stageH,
    layers,
    selected,
    time,
    drawing = $bindable(false),
    onselect,
    onchange,
    onlayer,
    ondraw,
  }: {
    W: number;
    H: number;
    stageW: number;
    stageH: number;
    layers: Layer[];
    selected: string | null;
    time: number;
    onselect: (id: string | null) => void;
    drawing?: boolean;
    /** Live change while dragging (done = pointer released). */
    onchange: (l: Layer, s: Partial<State>, done: boolean) => void;
    /** The layer itself changed (outline points), live while dragging. */
    onlayer: (l: Layer, done: boolean) => void;
    /** An outline was drawn over the picture (video pixels) for the selected layer. */
    ondraw: (l: Layer, outline: Pt[]) => void;
  } = $props();

  const k = $derived(W && H ? Math.min(stageW / W, stageH / H) : 1);
  const ox = $derived((stageW - W * k) / 2);
  const oy = $derived((stageH - H * k) / 2);
  const shown = $derived(layers.filter((l) => visibleAt(l, time) || l.id === selected));
  const sel = $derived(layers.find((l) => l.id === selected) ?? null);
  const path = $derived.by(() => {
    if (!sel || sel.keys.length < 2) return '';
    const a = sel.keys[0].t;
    const b = sel.keys[sel.keys.length - 1].t;
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const s = stateAt(sel, a + ((b - a) * i) / 60);
      pts.push(`${s.x * k},${s.y * k}`);
    }
    return pts.join(' ');
  });

  type Drag = { l: Layer; mode: 'move' | 'scale' | 'rotate'; x: number; y: number; s0: State; cx: number; cy: number };
  let drag: Drag | null = null;

  function start(e: PointerEvent, l: Layer, mode: Drag['mode']) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onselect(l.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const s0 = stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, time);
    const root = (e.currentTarget as Element).closest('.fx-stage')!.getBoundingClientRect();
    drag = { l, mode, x: e.clientX, y: e.clientY, s0, cx: root.left + ox + s0.x * k, cy: root.top + oy + s0.y * k };
  }

  // ---- freeform outline: points in the box (-0.5..0.5, y down, before rotation) ----

  /** Screen point → point in the layer's box. */
  function toBox(e: { clientX: number; clientY: number }, l: Layer, root: DOMRect): Pt {
    const s = stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, time);
    const dx = e.clientX - (root.left + ox + s.x * k);
    const dy = e.clientY - (root.top + oy + s.y * k);
    const a = (-s.rotation * Math.PI) / 180;
    return [(dx * Math.cos(a) - dy * Math.sin(a)) / (l.w * s.scale * k), (dx * Math.sin(a) + dy * Math.cos(a)) / (l.h * s.scale * k)];
  }
  const rootOf = (e: Event) => (e.currentTarget as Element).closest('.fx-stage')!.getBoundingClientRect();
  const round = (p: Pt): Pt => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

  let vdrag: { l: Layer; i: number; root: DOMRect } | null = null;

  function startPoint(e: PointerEvent, l: Layer, i: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    vdrag = { l, i, root: rootOf(e) };
  }

  function movePoint(e: PointerEvent, done = false) {
    if (!vdrag) return;
    const pts = [...(maskOf(vdrag.l).points ?? [])];
    pts[vdrag.i] = round(toBox(e, vdrag.l, vdrag.root));
    onlayer(withMask(vdrag.l, { points: pts }), done);
    if (done) vdrag = null;
  }

  function removePoint(e: MouseEvent, l: Layer, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const pts = maskOf(l).points ?? [];
    if (pts.length > 3) onlayer(withMask(l, { points: pts.filter((_, j) => j !== i) }), true);
  }

  /** Double-click on a freeform layer: a new point on the nearest edge. */
  function addPoint(e: MouseEvent, l: Layer) {
    e.stopPropagation();
    const pts = maskOf(l).points ?? [];
    if (maskOf(l).shape !== 'path' || pts.length < 3) return;
    const p = toBox(e, l, rootOf(e));
    let best = 0;
    let bd = Infinity;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)));
      const d = Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    onlayer(withMask(l, { points: [...pts.slice(0, best + 1), round(p), ...pts.slice(best + 1)] }), true);
  }

  // ---- drawing a new outline ----
  let outline = $state<Pt[] | null>(null);

  function drawStart(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const r = rootOf(e);
    outline = [[(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k]];
  }

  function drawMove(e: PointerEvent) {
    if (!outline) return;
    const r = rootOf(e);
    const p: Pt = [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
    const q = outline[outline.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) * k >= 3) outline = [...outline, p];
  }

  function drawEnd() {
    const o = outline;
    outline = null;
    if (!o || !sel) return;
    drawing = false;
    if (o.length >= 3) ondraw(sel, o);
  }

  function move(e: PointerEvent, done = false) {
    if (!drag) return;
    const d = drag;
    let s: Partial<State>;
    if (d.mode === 'move') s = { x: Math.round(d.s0.x + (e.clientX - d.x) / k), y: Math.round(d.s0.y + (e.clientY - d.y) / k) };
    else if (d.mode === 'scale') {
      const r0 = Math.hypot(d.x - d.cx, d.y - d.cy) || 1;
      const r1 = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      s = { scale: Math.max(0.05, Math.round(d.s0.scale * (r1 / r0) * 100) / 100) };
    } else {
      const a0 = Math.atan2(d.y - d.cy, d.x - d.cx);
      const a1 = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
      let r = d.s0.rotation + ((a1 - a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      s = { rotation: Math.round(r * 10) / 10 };
    }
    onchange(d.l, s, done);
    if (done) drag = null;
  }
</script>

<div class="fx-stage" style:left="{ox}px" style:top="{oy}px" style:width="{W * k}px" style:height="{H * k}px">
  {#if path}<svg class="path" width={W * k} height={H * k}><polyline points={path} />{#each sel!.keys as key (key.t)}<circle cx={key.x * k} cy={key.y * k} r="3.5" />{/each}</svg>{/if}
  {#each shown as l (l.id)}
    {@const s = stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, time)}
    {@const m = maskOf(l)}
    <div
      class="box"
      class:sel={l.id === selected}
      class:blur={l.kind === 'blur'}
      class:ghost={!visibleAt(l, time)}
      class:round={m.shape === 'ellipse'}
      class:free={m.shape === 'path'}
      style:left="{s.x * k}px"
      style:top="{s.y * k}px"
      style:width="{l.w * s.scale * k}px"
      style:height="{l.h * s.scale * k}px"
      style:transform="translate(-50%, -50%) rotate({s.rotation}deg)"
      role="button"
      tabindex="-1"
      title="{l.name}: drag to move · corner to scale · knob to rotate (Shift snaps)"
      onpointerdown={(e) => start(e, l, 'move')}
      onpointermove={(e) => move(e)}
      onpointerup={(e) => move(e, true)}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      ondblclick={(e) => addPoint(e, l)}
    >
      {#if m.shape === 'path' && m.points}
        <svg class="outline" viewBox="-0.5 -0.5 1 1" preserveAspectRatio="none" aria-hidden="true"><polygon points={m.points.map((p) => p.join(',')).join(' ')} /></svg>
        {#if l.id === selected && !drawing}
          {#each m.points as p, i (i)}
            <span
              class="pt"
              role="presentation"
              style:left="{(p[0] + 0.5) * 100}%"
              style:top="{(p[1] + 0.5) * 100}%"
              onpointerdown={(e) => startPoint(e, l, i)}
              onpointermove={(e) => movePoint(e)}
              onpointerup={(e) => movePoint(e, true)}
              oncontextmenu={(e) => removePoint(e, l, i)}
            ></span>
          {/each}
        {/if}
      {/if}
      {#if l.id === selected}
        <span class="h scale" role="presentation" onpointerdown={(e) => start(e, l, 'scale')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
        <span class="h rot" role="presentation" onpointerdown={(e) => start(e, l, 'rotate')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
        <span class="tag">{l.name}</span>
      {/if}
    </div>
  {/each}
  {#if drawing && sel}
    <div class="draw" role="presentation" title="Drag around what {sel.name} should cover" onpointerdown={drawStart} onpointermove={drawMove} onpointerup={drawEnd} onclick={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      {#if outline}<svg width={W * k} height={H * k}><polyline points={outline.map(([x, y]) => `${x * k},${y * k}`).join(' ')} /></svg>{/if}
    </div>
  {/if}
</div>
<svelte:window
  onkeydown={(e) => {
    if (drawing && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      outline = null;
      drawing = false;
    }
  }}
/>

<style>
  .fx-stage {
    position: absolute;
    pointer-events: none;
  }
  .path {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .path polyline {
    fill: none;
    stroke: rgba(255, 255, 255, 0.8);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
  }
  .path circle {
    fill: var(--accent);
    stroke: #fff;
  }
  .box {
    position: absolute;
    pointer-events: auto;
    cursor: move;
    outline: 1px dashed rgba(255, 255, 255, 0.55);
    touch-action: none;
  }
  .box.round {
    border-radius: 50%;
  }
  .box.free {
    outline-color: rgba(255, 255, 255, 0.25);
  }
  .outline {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .outline polygon {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
  }
  .box.sel .outline polygon {
    stroke: var(--accent);
  }
  .pt {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--accent);
    cursor: grab;
    touch-action: none;
  }
  .draw {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: crosshair;
    touch-action: none;
    background: rgba(0, 0, 0, 0.12);
  }
  .draw svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .draw polyline {
    fill: rgba(217, 119, 87, 0.15);
    stroke: var(--accent);
    stroke-width: 2;
  }
  .box.sel {
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .box.ghost {
    opacity: 0.4;
  }
  .h {
    position: absolute;
    width: 12px;
    height: 12px;
    background: var(--accent);
    border: 2px solid #fff;
    border-radius: 3px;
  }
  .scale {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }
  .rot {
    left: 50%;
    top: -26px;
    margin-left: -6px;
    border-radius: 50%;
    cursor: grab;
  }
  .tag {
    position: absolute;
    left: 0;
    bottom: 100%;
    margin-bottom: 3px;
    font-size: calc(10.5px * var(--ui-scale));
    background: var(--accent);
    color: #fff;
    padding: 0 5px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
