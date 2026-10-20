<script lang="ts">
  // Two images: side by side (zoom and pan together), swipe, onion skin, or
  // difference (changed pixels in magenta over a dimmed original). The pixel
  // comparison runs in the worker.
  import { onMount } from 'svelte';
  import type { DiffClient } from './diffClient';

  let { client, srcA, srcB, mode, tol, onresult }: { client: DiffClient; srcA: string; srcB: string; mode: 'side' | 'swipe' | 'onion' | 'diff'; tol: number; onresult: (r: { changed: number; total: number; w: number; h: number; sizes: [string, string] } | { error: string }) => void } = $props();

  let area = $state<HTMLDivElement>();
  let maskCanvas = $state<HTMLCanvasElement>();
  let natA = $state({ w: 0, h: 0 });
  let natB = $state({ w: 0, h: 0 });
  let view = $state({ z: 1, x: 0, y: 0 });
  let split = $state(0.5);
  let opacity = $state(0.5);
  let fitted = true;
  let drag: { x: number; y: number; vx: number; vy: number; swipe: boolean } | null = null;
  let bitmaps: { a: ImageBitmap; b: ImageBitmap } | null = null;
  let seq = 0;

  const W = $derived(Math.max(natA.w, natB.w));
  const H = $derived(Math.max(natA.h, natB.h));

  async function bitmap(src: string): Promise<ImageBitmap> {
    const img = new Image();
    img.src = src;
    await img.decode();
    // SVGs have no intrinsic bitmap: draw them through a canvas.
    if (!img.naturalWidth) throw new Error('This image has no size.');
    return createImageBitmap(img);
  }

  async function load() {
    const my = ++seq;
    try {
      const [a, b] = await Promise.all([bitmap(srcA), bitmap(srcB)]);
      if (my !== seq) return;
      natA = { w: a.width, h: a.height };
      natB = { w: b.width, h: b.height };
      bitmaps?.a.close();
      bitmaps?.b.close();
      bitmaps = { a, b };
      fitted = true;
      fit();
      await compare();
    } catch (e) {
      onresult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  export async function compare() {
    if (!bitmaps) return;
    const a = await createImageBitmap(bitmaps.a);
    const b = await createImageBitmap(bitmaps.b);
    const r = await client.call<{ w: number; h: number; changed: number; mask: ImageBitmap }>({ type: 'image', a, b, tol }, );
    if (maskCanvas) {
      maskCanvas.width = r.w;
      maskCanvas.height = r.h;
      maskCanvas.getContext('2d')!.drawImage(r.mask, 0, 0);
    }
    r.mask.close();
    onresult({ changed: r.changed, total: r.w * r.h, w: r.w, h: r.h, sizes: [`${natA.w} × ${natA.h}`, `${natB.w} × ${natB.h}`] });
  }

  function fit() {
    if (!area || !W) return;
    const cols = mode === 'side' ? 2 : 1;
    const aw = area.clientWidth / cols - 24;
    const ah = area.clientHeight - 24;
    const z = Math.min(1, aw / W, ah / H);
    view = { z, x: (area.clientWidth / cols - W * z) / 2, y: (area.clientHeight - H * z) / 2 };
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = area!.getBoundingClientRect();
    const cols = mode === 'side' ? 2 : 1;
    const cw = r.width / cols;
    const sx = (e.clientX - r.left) % cw;
    const sy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
    const z = Math.min(64, Math.max(0.02, view.z * f));
    const k = z / view.z;
    view = { z, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
    fitted = false;
  }

  function down(e: PointerEvent) {
    const r = area!.getBoundingClientRect();
    const onHandle = mode === 'swipe' && Math.abs(e.clientX - r.left - (view.x + W * view.z * split)) < 12;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, swipe: onHandle };
    try {
      area!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    if (drag.swipe) {
      const r = area!.getBoundingClientRect();
      split = Math.max(0, Math.min(1, (e.clientX - r.left - view.x) / (W * view.z)));
      return;
    }
    view = { ...view, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
    fitted = false;
  }

  $effect(() => {
    void srcA;
    void srcB;
    void load();
  });
  $effect(() => {
    void mode;
    if (fitted) queueMicrotask(fit);
  });
  let lastTol = tol;
  $effect(() => {
    if (tol !== lastTol) {
      lastTol = tol;
      void compare();
    }
  });

  onMount(() => {
    const ro = new ResizeObserver(() => fitted && fit());
    if (area) ro.observe(area);
    return () => {
      ro.disconnect();
      bitmaps?.a.close();
      bitmaps?.b.close();
    };
  });

  export const setSplit = (v: number) => (split = v);
  export const zoom = () => view.z;
  const tf = $derived(`translate(${view.x}px, ${view.y}px) scale(${view.z})`);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="idiff {mode}" bind:this={area} onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={() => (drag = null)} ondblclick={() => ((fitted = true), fit())}>
  {#if mode === 'side'}
    <div class="col"><div class="layer checker" style:transform={tf} style:width="{natA.w}px" style:height="{natA.h}px"><img src={srcA} alt="Left" draggable="false" class:px={view.z >= 3} /></div><span class="tag">A</span></div>
    <div class="col"><div class="layer checker" style:transform={tf} style:width="{natB.w}px" style:height="{natB.h}px"><img src={srcB} alt="Right" draggable="false" class:px={view.z >= 3} /></div><span class="tag">B</span></div>
  {:else}
    <div class="layer checker" style:transform={tf} style:width="{W}px" style:height="{H}px">
      <img src={srcA} alt="Left" draggable="false" class:px={view.z >= 3} class:dim={mode === 'diff'} />
      {#if mode === 'swipe'}
        <div class="clip" style:clip-path="inset(0 0 0 {split * 100}%)"><img src={srcB} alt="Right" draggable="false" class:px={view.z >= 3} /></div>
      {:else if mode === 'onion'}
        <img class="over" src={srcB} alt="Right" draggable="false" class:px={view.z >= 3} style:opacity />
      {/if}
      <canvas class="mask" class:hidden={mode !== 'diff'} bind:this={maskCanvas} class:px={view.z >= 3}></canvas>
    </div>
    {#if mode === 'swipe'}
      <div class="handle" style:left="{view.x + W * view.z * split}px"></div>
      <span class="tag l">A</span><span class="tag r">B</span>
    {/if}
  {/if}
  {#if mode === 'onion'}
    <label class="slider">A <input type="range" min="0" max="1" step="0.01" bind:value={opacity} aria-label="Opacity of B" /> B</label>
  {/if}
</div>

<style>
  .idiff {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: var(--pasteboard);
    display: flex;
    cursor: grab;
    touch-action: none;
  }
  .col {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .col + .col {
    border-left: 1px solid var(--border);
  }
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .checker {
    background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 16px 16px;
  }
  .layer img,
  .layer canvas,
  .clip {
    position: absolute;
    left: 0;
    top: 0;
  }
  .clip {
    width: 100%;
    height: 100%;
  }
  .px {
    image-rendering: pixelated;
  }
  .dim {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .hidden {
    display: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    cursor: ew-resize;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }
  .handle::after {
    content: '⇔';
    position: absolute;
    top: 50%;
    left: -11px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
  }
  .tag {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    font-size: var(--fs-small);
  }
  .tag.r {
    left: auto;
    right: 8px;
  }
  .slider {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
</style>
