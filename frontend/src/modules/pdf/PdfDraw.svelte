<script lang="ts">
  // Shapes and the stroke eraser over the pdf.js pages. A shape dragged out
  // here becomes an ordinary pdf.js ink drawing (select, move, recolour,
  // undo, saved as an Ink annotation); the eraser removes whole drawings and
  // freehand highlights it touches, each one an undo step.
  import { bounds, densify, insidePolygon, rgb, shapeStrokes, touchesStroke, type Shape } from './ink';

  /** What we use of pdf.js's editor manager (not part of its typed API). */
  interface Editor {
    editorType: string;
    deleted?: boolean;
    parent: unknown;
    div?: HTMLElement;
    serialize(forCopying?: boolean): { thickness?: number; paths?: { points: ArrayLike<number>[] }; outlines?: ArrayLike<number>[] | { outline: ArrayLike<number> } } | null;
    remove(): void;
  }
  interface Layer {
    viewport: { rotation: number };
    deserialize(data: unknown): Promise<Editor | null>;
    addOrRebuild(e: Editor): void;
  }
  export interface EditorManager {
    getLayer(pageIndex: number): Layer | undefined;
    getEditors(pageIndex: number): Iterable<Editor>;
    addCommands(c: { cmd: () => void; undo: () => void; mustExec: boolean }): void;
    rebuild(e: Editor): void;
  }
  interface PageViewport {
    scale: number;
    convertToPdfPoint(x: number, y: number): number[];
  }

  let {
    container,
    mode,
    shape,
    color,
    width,
    eraser,
    layout,
    manager,
    viewport,
    inkType,
  }: {
    container: HTMLDivElement;
    mode: 'shape' | 'eraser';
    shape: Shape;
    color: string;
    /** Line width, as the pen's (page units). */
    width: number;
    /** Eraser radius in screen pixels. */
    eraser: number;
    /** Bumped when pages move (zoom, render, resize). */
    layout: number;
    manager: () => EditorManager | null;
    viewport: (pageIndex: number) => PageViewport | undefined;
    /** pdf.js's AnnotationEditorType.INK. */
    inkType: number;
  } = $props();

  interface PageBox {
    n: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  let size = $state({ w: 0, h: 0 });
  let drag = $state<{ p: PageBox; x0: number; y0: number; x1: number; y1: number; even: boolean } | null>(null);
  let cursor = $state<{ x: number; y: number } | null>(null);
  let erasing: { gone: Set<Editor> } | null = null;

  /** Page rectangles in the container's content coordinates. */
  function pages(): PageBox[] {
    const c = container.getBoundingClientRect();
    return [...container.querySelectorAll<HTMLElement>('.page[data-page-number]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { n: Number(el.dataset.pageNumber), x: r.left - c.left + container.scrollLeft, y: r.top - c.top + container.scrollTop, w: r.width, h: r.height };
    });
  }
  let boxes: PageBox[] = [];
  $effect(() => {
    void layout;
    boxes = pages();
    size = { w: container.scrollWidth, h: container.scrollHeight };
  });

  function local(e: PointerEvent): [number, number] {
    const c = container.getBoundingClientRect();
    return [e.clientX - c.left + container.scrollLeft, e.clientY - c.top + container.scrollTop];
  }
  const pageAt = (x: number, y: number) => boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  const scaleOf = (n: number) => viewport(n - 1)?.scale ?? 1;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    boxes = pages();
    const [x, y] = local(e);
    const p = pageAt(x, y);
    if (!p) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    if (mode === 'shape') drag = { p, x0: x, y0: y, x1: x, y1: y, even: e.shiftKey };
    else {
      erasing = { gone: new Set() };
      erase(x, y);
    }
  }

  function move(e: PointerEvent) {
    const [x, y] = local(e);
    cursor = { x, y };
    if (drag) {
      const p = drag.p;
      drag = { ...drag, x1: Math.max(p.x, Math.min(p.x + p.w, x)), y1: Math.max(p.y, Math.min(p.y + p.h, y)), even: e.shiftKey };
    } else if (erasing) erase(x, y);
  }

  function up() {
    const d = drag;
    drag = null;
    erasing = null;
    if (d && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) >= 3) void addShape(d);
  }

  // ---------- shapes ----------

  function strokesOf(d: NonNullable<typeof drag>): number[][] {
    const s = scaleOf(d.p.n);
    return shapeStrokes(shape, d.x0, d.y0, d.x1, d.y1, d.even, Math.max(8, width * 4) * s);
  }

  async function addShape(d: NonNullable<typeof drag>) {
    const ui = manager();
    const layer = ui?.getLayer(d.p.n - 1);
    const vp = viewport(d.p.n - 1);
    if (!ui || !layer || !vp) return;
    // Page CSS pixels → PDF user space, a point every 2 px (see densify).
    const points = strokesOf(d).map((stroke) => {
      const s = densify(stroke, 2);
      const out = new Float32Array(s.length);
      for (let i = 0; i < s.length; i += 2) {
        const [px, py] = vp.convertToPdfPoint(s[i] - d.p.x, s[i + 1] - d.p.y);
        out[i] = px;
        out[i + 1] = py;
      }
      return out;
    });
    const [x0, y0, x1, y1] = bounds(points);
    const m = width;
    const editor = await layer.deserialize({
      annotationType: inkType,
      color: rgb(color),
      thickness: width,
      opacity: 1,
      paths: { points },
      boxes: null,
      pageIndex: d.p.n - 1,
      rect: [x0 - m, y0 - m, x1 + m, y1 + m],
      rotation: layer.viewport.rotation,
    });
    if (!editor) return;
    ui.addCommands({ cmd: () => layer.addOrRebuild(editor), undo: () => editor.remove(), mustExec: true });
  }

  // ---------- eraser ----------

  /** Remove the drawings and freehand highlights the eraser touches at (x, y). */
  function erase(x: number, y: number) {
    const ui = manager();
    const p = pageAt(x, y);
    const vp = p && viewport(p.n - 1);
    if (!ui || !p || !vp || !erasing) return;
    const [px, py] = vp.convertToPdfPoint(x - p.x, y - p.y);
    const r = eraser / vp.scale;
    const c = container.getBoundingClientRect();
    const cx = x - container.scrollLeft + c.left;
    const cy = y - container.scrollTop + c.top;
    for (const ed of [...ui.getEditors(p.n - 1)]) {
      if (ed.deleted || !ed.parent || erasing.gone.has(ed) || !hit(ed, px, py, r, cx, cy)) continue;
      erasing.gone.add(ed);
      ui.addCommands({ cmd: () => ed.remove(), undo: () => ui.rebuild(ed), mustExec: true });
    }
  }

  function hit(ed: Editor, px: number, py: number, r: number, cx: number, cy: number): boolean {
    if (ed.editorType === 'ink') {
      const s = ed.serialize(true);
      const half = (s?.thickness ?? 1) / 2;
      return !!s?.paths?.points.some((stroke) => touchesStroke(px, py, r + half, stroke));
    }
    if (ed.editorType === 'highlight') {
      // A highlight drawn now has its outline; one already in the file only its box.
      const o = ed.serialize(false)?.outlines;
      const polys = Array.isArray(o) ? o : o?.outline ? [o.outline] : null;
      if (polys) return polys.some((poly) => insidePolygon(px, py, poly) || touchesStroke(px, py, r, poly));
      const b = ed.div?.getBoundingClientRect();
      return !!b && cx >= b.left - eraser && cx <= b.right + eraser && cy >= b.top - eraser && cy <= b.bottom + eraser;
    }
    return false;
  }
</script>

<div class="layer" style:width="{size.w}px" style:height="{size.h}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="catcher" class:eraser={mode === 'eraser'} data-draw={mode} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => (cursor = null)}></div>
  <svg class="preview" width={size.w} height={size.h} aria-hidden="true">
    {#if drag}
      {#each strokesOf(drag) as s}
        <polyline points={s.join(' ')} fill="none" stroke={color} stroke-width={width * scaleOf(drag.p.n)} stroke-linecap="round" stroke-linejoin="round" />
      {/each}
    {/if}
    {#if mode === 'eraser' && cursor}
      <circle class="ring" cx={cursor.x} cy={cursor.y} r={eraser} />
    {/if}
  </svg>
</div>

<style>
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 6;
  }
  .catcher {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: crosshair;
    touch-action: none;
  }
  .catcher.eraser {
    cursor: none;
  }
  .preview {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  .ring {
    fill: rgba(255, 255, 255, 0.35);
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 1;
  }
</style>
