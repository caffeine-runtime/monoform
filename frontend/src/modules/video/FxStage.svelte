<script lang="ts">
  // Boxes over the preview for the layers visible now: drag to move, the
  // corner to scale, the knob to rotate. The selected layer also shows its
  // motion path with a dot per keyframe.
  import { stateAt, visibleAt, type Layer, type State } from './project';

  let {
    W,
    H,
    stageW,
    stageH,
    layers,
    selected,
    time,
    onselect,
    onchange,
  }: {
    W: number;
    H: number;
    stageW: number;
    stageH: number;
    layers: Layer[];
    selected: string | null;
    time: number;
    onselect: (id: string | null) => void;
    /** Live change while dragging (done = pointer released). */
    onchange: (l: Layer, s: Partial<State>, done: boolean) => void;
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
    <div
      class="box"
      class:sel={l.id === selected}
      class:blur={l.kind === 'blur'}
      class:ghost={!visibleAt(l, time)}
      class:round={l.blur?.shape === 'ellipse'}
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
      ondblclick={(e) => e.stopPropagation()}
    >
      {#if l.id === selected}
        <span class="h scale" role="presentation" onpointerdown={(e) => start(e, l, 'scale')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
        <span class="h rot" role="presentation" onpointerdown={(e) => start(e, l, 'rotate')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
        <span class="tag">{l.name}</span>
      {/if}
    </div>
  {/each}
</div>

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
    font-size: 10.5px;
    background: var(--accent);
    color: #fff;
    padding: 0 5px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
