<script lang="ts">
  // Pending signatures and redaction boxes drawn over the pdf.js pages. They
  // stay editable (drag to move, corner to resize, × to remove) until they
  // are applied to the file. Positions are fractions of the page, so zooming
  // keeps them in place.
  import type { Mark } from './marks';

  let {
    container,
    marks = $bindable(),
    mode,
    placing,
    layout,
    onplaced,
  }: {
    container: HTMLDivElement;
    marks: Mark[];
    /** 'redact': drag boxes; 'sign': click to place `placing`; null: just edit marks. */
    mode: 'redact' | 'sign' | null;
    placing: { src: string; aspect: number } | null;
    /** Bumped when pages move (zoom, render, resize). */
    layout: number;
    onplaced?: () => void;
  } = $props();

  let seq = 0;
  let size = $state({ w: 0, h: 0 });
  let ghost = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let band = $state<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  let drag: { id: number; kind: 'move' | 'size'; sx: number; sy: number; m: Mark; pw: number; ph: number } | null = null;

  interface PageBox {
    n: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  /** Page rectangles in the container's content coordinates. */
  function pages(): PageBox[] {
    void layout;
    const c = container.getBoundingClientRect();
    return [...container.querySelectorAll<HTMLElement>('.page[data-page-number]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { n: Number(el.dataset.pageNumber), x: r.left - c.left + container.scrollLeft, y: r.top - c.top + container.scrollTop, w: r.width, h: r.height };
    });
  }

  let boxes = $state<PageBox[]>([]);
  $effect(() => {
    void layout;
    void marks.length;
    boxes = pages();
    size = { w: container.scrollWidth, h: container.scrollHeight };
  });

  const box = (n: number) => boxes.find((b) => b.n === n);

  function local(e: PointerEvent): [number, number] {
    const c = container.getBoundingClientRect();
    return [e.clientX - c.left + container.scrollLeft, e.clientY - c.top + container.scrollTop];
  }
  const pageAt = (x: number, y: number) => boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);

  function ghostRect(x: number, y: number, p: PageBox) {
    const w = p.w * 0.24;
    const h = w / (placing?.aspect || 3);
    return { x: x - w / 2, y: y - h / 2, w, h };
  }

  function catcherDown(e: PointerEvent) {
    if (e.button !== 0) return;
    boxes = pages();
    const [x, y] = local(e);
    const p = pageAt(x, y);
    if (!p) return;
    e.preventDefault();
    if (mode === 'sign' && placing) {
      const g = ghostRect(x, y, p);
      marks = [...marks, { id: ++seq + Date.now(), kind: 'sign', page: p.n, x: (g.x - p.x) / p.w, y: (g.y - p.y) / p.h, w: g.w / p.w, h: g.h / p.h, src: placing.src }];
      ghost = null;
      onplaced?.();
      return;
    }
    if (mode === 'redact') {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
      band = { page: p.n, x0: x, y0: y, x1: x, y1: y };
    }
  }

  function catcherMove(e: PointerEvent) {
    const [x, y] = local(e);
    if (band) {
      const p = box(band.page)!;
      band = { ...band, x1: Math.max(p.x, Math.min(p.x + p.w, x)), y1: Math.max(p.y, Math.min(p.y + p.h, y)) };
    } else if (mode === 'sign' && placing) {
      const p = pageAt(x, y);
      ghost = p ? ghostRect(x, y, p) : null;
    }
  }

  function catcherUp() {
    const b = band;
    band = null;
    if (!b) return;
    const p = box(b.page)!;
    const x0 = Math.min(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0);
    const h = Math.abs(b.y1 - b.y0);
    if (w < 4 || h < 4) return;
    marks = [...marks, { id: ++seq + Date.now(), kind: 'redact', page: p.n, x: (x0 - p.x) / p.w, y: (y0 - p.y) / p.h, w: w / p.w, h: h / p.h }];
  }

  function markDown(e: PointerEvent, m: Mark, kind: 'move' | 'size') {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = box(m.page);
    if (!p) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    drag = { id: m.id, kind, sx: e.clientX, sy: e.clientY, m: { ...m }, pw: p.w, ph: p.h };
  }

  function markMove(e: PointerEvent) {
    if (!drag) return;
    const d = drag;
    const dx = (e.clientX - d.sx) / d.pw;
    const dy = (e.clientY - d.sy) / d.ph;
    marks = marks.map((m) => {
      if (m.id !== d.id) return m;
      if (d.kind === 'move') return { ...m, x: Math.max(0, Math.min(1 - m.w, d.m.x + dx)), y: Math.max(0, Math.min(1 - m.h, d.m.y + dy)) };
      let w = Math.max(0.01, Math.min(1 - d.m.x, d.m.w + dx));
      let h = Math.max(0.005, Math.min(1 - d.m.y, d.m.h + dy));
      if (m.kind === 'sign') h = (w * d.m.h) / d.m.w; // keep the signature's shape
      if (d.m.y + h > 1) {
        h = 1 - d.m.y;
        w = (h * d.m.w) / d.m.h;
      }
      return { ...m, w, h };
    });
  }

  const remove = (id: number) => (marks = marks.filter((m) => m.id !== id));
</script>

<div class="layer" style:width="{size.w}px" style:height="{size.h}px">
  {#if mode && (mode === 'redact' || placing)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="catcher" class:redact={mode === 'redact'} onpointerdown={catcherDown} onpointermove={catcherMove} onpointerup={catcherUp} onpointerleave={() => (ghost = null)}></div>
  {/if}
  {#each marks as m (m.id)}
    {@const p = box(m.page)}
    {#if p}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mark {m.kind}"
        style:left="{p.x + m.x * p.w}px"
        style:top="{p.y + m.y * p.h}px"
        style:width="{m.w * p.w}px"
        style:height="{m.h * p.h}px"
        title={m.kind === 'sign' ? 'Signature — drag to move, drag the corner to resize' : 'Redaction — drag to move, drag the corner to resize'}
        onpointerdown={(e) => markDown(e, m, 'move')}
        onpointermove={markMove}
        onpointerup={() => (drag = null)}
      >
        {#if m.src}<img src={m.src} alt="Signature" draggable="false" />{/if}
        <button class="del" title="Remove" aria-label="Remove" onpointerdown={(e) => e.stopPropagation()} onclick={() => remove(m.id)}>×</button>
        <span class="grip" onpointerdown={(e) => markDown(e, m, 'size')} onpointermove={markMove} onpointerup={() => (drag = null)}></span>
      </div>
    {/if}
  {/each}
  {#if band}
    <div class="mark redact drawing" style:left="{Math.min(band.x0, band.x1)}px" style:top="{Math.min(band.y0, band.y1)}px" style:width="{Math.abs(band.x1 - band.x0)}px" style:height="{Math.abs(band.y1 - band.y0)}px"></div>
  {/if}
  {#if ghost && placing}
    <img class="ghost" src={placing.src} alt="" style:left="{ghost.x}px" style:top="{ghost.y}px" style:width="{ghost.w}px" style:height="{ghost.h}px" />
  {/if}
</div>

<style>
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 5;
  }
  .catcher {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: copy;
  }
  .catcher.redact {
    cursor: crosshair;
  }
  .mark {
    position: absolute;
    pointer-events: auto;
    cursor: move;
    box-sizing: border-box;
  }
  .mark.sign {
    outline: 1px dashed var(--accent);
  }
  .mark.redact {
    background: rgba(0, 0, 0, 0.78);
    outline: 1px solid #000;
  }
  .mark.drawing {
    pointer-events: none;
  }
  .mark img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .del {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 12px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    display: none;
  }
  .grip {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 2px;
    cursor: nwse-resize;
    display: none;
  }
  .mark:hover .del,
  .mark:hover .grip {
    display: block;
  }
  .ghost {
    position: absolute;
    opacity: 0.6;
    pointer-events: none;
  }
</style>
