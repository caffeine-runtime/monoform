<script lang="ts">
  // Visual SVG editing on a sanitized inline copy of the document. The source
  // text stays the truth: every change becomes a minimal text change
  // (svgdoc.ts) applied through the editor, so undo, saving and the source
  // view all just work. Dragging previews on the inline copy and commits once
  // on release.
  import { aboutPoint, appendChild, formatTransform, mul, parseTransform, point, sanitize, setAttr, setContent, type Change, type El, type M } from './svgdoc';
  import Icon from '../../shell/Icon.svelte';
  import MousePointer from '@lucide/svelte/icons/mouse-pointer-2';
  import SquareIcon from '@lucide/svelte/icons/square';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import Slash from '@lucide/svelte/icons/slash';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import TypeIcon from '@lucide/svelte/icons/type';
  import Hand from '@lucide/svelte/icons/hand';
  import { clampZoom, fitZoom, centered, zoomAt, type View } from '../image/geometry';
  import { ui } from '../../core/ui.svelte';
  import type { Transfer } from '../../core/transfer.svelte';

  export type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text';

  let {
    text,
    els,
    selected = $bindable(),
    style,
    onchange,
    bg,
  }: {
    text: string;
    els: El[];
    selected: number | null;
    /** Defaults for new shapes. */
    style: { fill: string; stroke: string; strokeWidth: number };
    onchange: (changes: Change[], select?: number | null) => void;
    bg: string;
  } = $props();

  let tool = $state<Tool>('select');
  let host = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let pv = $state<View>({ zoom: 1, x: 0, y: 0 });
  let fitted = true;
  let size = $state({ w: 300, h: 150 });
  let root: SVGSVGElement | null = null;
  let parseError = $state('');
  let box = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let version = $state(0); // bumps when the inline copy is rebuilt

  // ---- inline copy ----
  function measure(svg: Element): { w: number; h: number } {
    const num = (v: string | null) => {
      const m = v ? /^\s*([\d.]+)\s*(px)?\s*$/.exec(v) : null;
      return m ? Number(m[1]) : 0;
    };
    const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    let w = num(svg.getAttribute('width'));
    let h = num(svg.getAttribute('height'));
    if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (w && !h) h = (w * vb[3]) / vb[2];
      else if (h && !w) w = (h * vb[2]) / vb[3];
      else [w, h] = [vb[2], vb[3]];
    }
    return { w: w || 300, h: h || 150 };
  }

  function rebuild() {
    if (!stage) return;
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const rootEl = doc.documentElement;
    if (doc.querySelector('parsererror') || rootEl.localName !== 'svg') {
      parseError = 'Fix the SVG source to edit visually.';
      return;
    }
    parseError = '';
    const all = [rootEl, ...Array.from(rootEl.getElementsByTagName('*'))];
    all.forEach((e, i) => e.setAttribute('data-mf-i', String(i)));
    sanitize(rootEl);
    size = measure(rootEl);
    const node = document.importNode(rootEl, true) as unknown as SVGSVGElement;
    node.removeAttribute('width');
    node.removeAttribute('height');
    if (!node.getAttribute('viewBox')) node.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    node.classList.add('art');
    stage.replaceChildren(node);
    root = node;
    if (fitted) fit();
    place();
    version++;
  }

  $effect(() => {
    void text;
    rebuild();
  });

  function place() {
    if (!root) return;
    root.style.left = `${pv.x}px`;
    root.style.top = `${pv.y}px`;
    root.style.width = `${size.w * pv.zoom}px`;
    root.style.height = `${size.h * pv.zoom}px`;
    measureBox();
  }

  $effect(() => {
    void pv;
    place();
  });

  export function fit() {
    if (!host) return;
    const z = fitZoom(size.w, size.h, host.clientWidth, host.clientHeight, 32, true);
    pv = centered(size.w, size.h, host.clientWidth, host.clientHeight, z);
    fitted = true;
  }

  export function zoomBy(dir: 1 | -1) {
    if (!host) return;
    pv = zoomAt(pv, host.clientWidth / 2, host.clientHeight / 2, clampZoom(pv.zoom * (dir > 0 ? 1.25 : 0.8)));
    fitted = false;
  }
  export const zoom = () => pv.zoom;

  const inline = (i: number | null) => (i === null || !root ? null : root.querySelector<SVGGraphicsElement>(`[data-mf-i="${i}"]`) ?? (i === 0 ? root : null));

  function measureBox() {
    const el = inline(selected);
    if (!el || !host || selected === 0) {
      box = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    box = { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
  }

  $effect(() => {
    void selected;
    void version;
    measureBox();
  });

  // ---- coordinates ----
  type Mat = DOMMatrix;
  /**
   * getScreenCTM, corrected: WebKit leaves out the CSS offset of an absolutely
   * positioned outer <svg>. The root's real placement (its client rect and
   * viewBox, preserveAspectRatio "meet") tells how far off it is.
   */
  function screenCTM(el: SVGGraphicsElement | SVGSVGElement): Mat | null {
    const m = el.getScreenCTM();
    const rm = root?.getScreenCTM();
    if (!m || !root || !rm) return m ? DOMMatrix.fromMatrix(m) : null;
    const vb = root.viewBox.baseVal;
    const r = root.getBoundingClientRect();
    const k = vb && vb.width && vb.height ? Math.min(r.width / vb.width, r.height / vb.height) : 1;
    const ex = r.left + (r.width - (vb?.width ?? 0) * k) / 2;
    const ey = r.top + (r.height - (vb?.height ?? 0) * k) / 2;
    const at = DOMMatrix.fromMatrix(rm).transformPoint(new DOMPoint(vb?.x ?? 0, vb?.y ?? 0));
    return new DOMMatrix().translate(ex - at.x, ey - at.y).multiply(DOMMatrix.fromMatrix(m));
  }
  const toLocal = (m: Mat, x: number, y: number) => {
    const p = m.inverse().transformPoint(new DOMPoint(x, y));
    return [p.x, p.y] as [number, number];
  };

  /** What a click on `target` selects: the top-level shape, then one level deeper per click inside the selection. */
  function pick(target: Element, deep: boolean): number | null {
    const hit = target.closest('[data-mf-i]');
    if (!hit || hit === root) return null;
    const chain: number[] = [];
    for (let e: Element | null = hit; e && e !== root; e = e.parentElement) chain.unshift(Number(e.getAttribute('data-mf-i')));
    if (deep) return chain[chain.length - 1];
    // Inside the current selection: keep it (so it can be dragged); else the top-level shape.
    return selected !== null && chain.includes(selected) ? selected : chain[0];
  }

  // ---- interactions ----
  type Drag =
    | { kind: 'pan'; x: number; y: number; vx: number; vy: number }
    | { kind: 'move' | 'scale' | 'rotate'; el: SVGGraphicsElement; idx: number; parent: Mat; start: [number, number]; centre: [number, number]; m0: M; moved: boolean }
    | { kind: 'draw'; tool: Tool; start: [number, number]; draft: SVGElement; points: [number, number][] };
  let drag: Drag | null = null;

  /** Capture the pointer (fails harmlessly for synthetic events). */
  function capture(e: PointerEvent) {
    try {
      host?.setPointerCapture(e.pointerId);
    } catch {
      /* not an active pointer */
    }
  }

  function down(e: PointerEvent) {
    if (!root || !host) return;
    if (e.button === 1 || tool === 'hand' || (e.button === 0 && e.altKey && tool === 'select')) {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: pv.x, vy: pv.y };
      capture(e);
      return;
    }
    if (e.button !== 0) return;
    capture(e);
    if (tool === 'select') {
      const idx = pick(e.target as Element, e.ctrlKey || e.metaKey);
      if (idx === null) {
        selected = null;
        drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: pv.x, vy: pv.y };
        return;
      }
      selected = idx;
      beginTransform(e, 'move');
      return;
    }
    // Drawing tools work in the root's coordinates.
    const rm = screenCTM(root);
    if (!rm) return;
    const p = toLocal(rm, e.clientX, e.clientY);
    if (tool === 'text') {
      void addText(p);
      return;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const draft = document.createElementNS(ns, tool === 'rect' ? 'rect' : tool === 'ellipse' ? 'ellipse' : tool === 'line' ? 'line' : 'path');
    draft.setAttribute('fill', tool === 'line' || tool === 'pen' ? 'none' : style.fill);
    draft.setAttribute('stroke', tool === 'line' || tool === 'pen' ? style.stroke === 'none' ? '#000000' : style.stroke : style.stroke);
    draft.setAttribute('stroke-width', String(style.strokeWidth || (tool === 'line' || tool === 'pen' ? 2 : 0)));
    root.appendChild(draft);
    drag = { kind: 'draw', tool, start: p, draft, points: [p] };
    drawTo(p, e.shiftKey);
  }

  function beginTransform(e: PointerEvent, kind: 'move' | 'scale' | 'rotate') {
    const el = inline(selected);
    if (!el || selected === null || selected === 0) return;
    const parentEl = (el.parentElement as unknown as SVGGraphicsElement) ?? root!;
    const parent = screenCTM(parentEl);
    if (!parent) return;
    const m0 = parseTransform(el.getAttribute('transform'));
    let centre: [number, number] = toLocal(parent, e.clientX, e.clientY);
    try {
      const b = el.getBBox();
      centre = point(m0, b.x + b.width / 2, b.y + b.height / 2);
    } catch {
      /* not rendered */
    }
    drag = { kind, el, idx: selected, parent, start: toLocal(parent, e.clientX, e.clientY), centre, m0, moved: false };
  }

  function handleDown(e: PointerEvent, kind: 'scale' | 'rotate') {
    e.stopPropagation();
    capture(e);
    beginTransform(e, kind);
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;

  function drawTo(p: [number, number], square: boolean) {
    if (!drag || drag.kind !== 'draw') return;
    const [x0, y0] = drag.start;
    let [x1, y1] = p;
    if (square && drag.tool !== 'pen') {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    }
    const el = drag.draft;
    const set = (o: Record<string, number | string>) => Object.entries(o).forEach(([k, v]) => el.setAttribute(k, typeof v === 'number' ? String(r2(v)) : v));
    if (drag.tool === 'rect') set({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) });
    else if (drag.tool === 'ellipse') set({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2 });
    else if (drag.tool === 'line') set({ x1: x0, y1: y0, x2: x1, y2: y1 });
    else {
      drag.points.push(p);
      set({ d: pathOf(drag.points) });
    }
  }

  /** Freehand points → a compact path (drop points closer than ~1.5 units, round). */
  function pathOf(pts: [number, number][]): string {
    const kept: [number, number][] = [];
    for (const q of pts) {
      const last = kept[kept.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1.5 / pv.zoom) kept.push(q);
    }
    return kept.map((q, i) => `${i ? 'L' : 'M'}${r2(q[0])} ${r2(q[1])}`).join(' ');
  }

  function move(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    if (d.kind === 'pan') {
      pv = { ...pv, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y };
      fitted = false;
      return;
    }
    if (d.kind === 'draw') {
      const rm = root && screenCTM(root);
      if (rm) drawTo(toLocal(rm, e.clientX, e.clientY), e.shiftKey);
      return;
    }
    const p = toLocal(d.parent, e.clientX, e.clientY);
    d.moved = true;
    d.el.setAttribute('transform', formatTransform(next(d, p, e.shiftKey)) ?? '');
    measureBox();
  }

  function next(d: Extract<Drag, { kind: 'move' | 'scale' | 'rotate' }>, p: [number, number], snap: boolean): M {
    const [cx, cy] = d.centre;
    if (d.kind === 'move') return mul([1, 0, 0, 1, p[0] - d.start[0], p[1] - d.start[1]], d.m0);
    if (d.kind === 'scale') {
      const k = Math.max(0.02, Math.hypot(p[0] - cx, p[1] - cy) / (Math.hypot(d.start[0] - cx, d.start[1] - cy) || 1));
      return mul(aboutPoint(cx, cy, k, 0), d.m0);
    }
    let deg = ((Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(d.start[1] - cy, d.start[0] - cx)) * 180) / Math.PI;
    if (snap) deg = Math.round(deg / 15) * 15;
    return mul(aboutPoint(cx, cy, 1, deg), d.m0);
  }

  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d || d.kind === 'pan') return;
    if (d.kind === 'draw') {
      const el = d.draft;
      el.remove();
      // Geometry first, then style; leave out what is the default anyway.
      const ORDER = ['x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'fill', 'stroke', 'stroke-width'];
      const attrs = Array.from(el.attributes)
        .filter((a) => !(a.name === 'stroke' && a.value === 'none') && !(a.name === 'stroke-width' && (a.value === '0' || el.getAttribute('stroke') === 'none')))
        .sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
        .map((a) => `${a.name}="${a.value}"`)
        .join(' ');
      const rect = el.localName === 'rect' && (+el.getAttribute('width')! < 1 || +el.getAttribute('height')! < 1);
      const ell = el.localName === 'ellipse' && (+el.getAttribute('rx')! < 0.5 || +el.getAttribute('ry')! < 0.5);
      const line = el.localName === 'line' && Math.hypot(+el.getAttribute('x2')! - +el.getAttribute('x1')!, +el.getAttribute('y2')! - +el.getAttribute('y1')!) < 1;
      if (rect || ell || line || (d.tool === 'pen' && d.points.length < 3)) return;
      onchange([appendChild(text, els[0], `<${el.localName} ${attrs}/>`, els)], els.length);
      tool = 'select';
      return;
    }
    if (!d.moved) return;
    const t = formatTransform(next(d, toLocal(d.parent, e.clientX, e.clientY), e.shiftKey));
    const c = setAttr(text, els[d.idx], 'transform', t);
    if (c) onchange([c], d.idx);
  }

  async function addText(p: [number, number]) {
    const t = await ui.prompt('Text', 'Text', 'Add');
    if (!t) return;
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    onchange([appendChild(text, els[0], `<text x="${r2(p[0])}" y="${r2(p[1])}" font-family="sans-serif" font-size="${Math.max(8, Math.round(size.h / 12))}" fill="${style.fill === 'none' ? '#000000' : style.fill}">${esc}</text>`, els)], els.length);
    tool = 'select';
  }

  /** The drawing is on screen and can take things. */
  export function ready(): boolean {
    return !!root && els.length > 0;
  }

  /** From another tab: a picture (embedded as PNG) or text, at the drop point or in the middle. */
  export function insert(t: Transfer, at?: { x: number; y: number }): boolean {
    if (!root || !els.length || t.kind === 'files') return false;
    const rm = screenCTM(root);
    const p: [number, number] = at && rm ? toLocal(rm, at.x, at.y) : [size.w / 2, size.h / 2];
    if (t.kind === 'text') {
      const esc = t.text.trim().slice(0, 2000).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      onchange([appendChild(text, els[0], `<text x="${r2(p[0])}" y="${r2(p[1])}" font-family="sans-serif" font-size="${Math.max(8, Math.round(size.h / 12))}" fill="${style.fill === 'none' ? '#000000' : style.fill}">${esc}</text>`, els)], els.length);
      return true;
    }
    // Fitted into half the drawing, centred on the point.
    const k = Math.min(1, (size.w * 0.5) / t.image.width, (size.h * 0.5) / t.image.height);
    const w = t.image.width * k;
    const h = t.image.height * k;
    const href = t.image.toDataURL('image/png');
    onchange([appendChild(text, els[0], `<image x="${r2(p[0] - w / 2)}" y="${r2(p[1] - h / 2)}" width="${r2(w)}" height="${r2(h)}" href="${href}"/>`, els)], els.length);
    return true;
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = host!.getBoundingClientRect();
    pv = zoomAt(pv, e.clientX - r.left, e.clientY - r.top, clampZoom(pv.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
    fitted = false;
  }

  function dbl(e: MouseEvent) {
    if (tool !== 'select') return;
    // Double-click goes one level deeper into a group (or edits text).
    const hit = (e.target as Element).closest('[data-mf-i]');
    if (!hit || hit === root || selected === null) return;
    const chain: number[] = [];
    for (let el: Element | null = hit; el && el !== root; el = el.parentElement) chain.unshift(Number(el.getAttribute('data-mf-i')));
    const at = chain.indexOf(selected);
    if (at >= 0 && at < chain.length - 1) selected = chain[at + 1];
    else if (els[selected]?.tag === 'text') void editText(selected);
  }

  async function editText(i: number) {
    const el = els[i];
    const cur = text.slice(el.tagEnd, el.closeStart).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const t = await ui.prompt('Edit text', cur, 'Update');
    if (t === null || t === undefined) return;
    const c = setContent(text, el, t);
    if (c) onchange([c], i);
  }

  const TOOLS: { id: Tool; icon: any; label: string }[] = [
    { id: 'select', icon: MousePointer, label: 'Select and move (V) — click a shape; click again inside a group to go deeper (or Ctrl+click); drag handles to scale/rotate (Shift snaps)' },
    { id: 'hand', icon: Hand, label: 'Pan (H) — or drag empty space / middle mouse; scroll to zoom' },
    { id: 'rect', icon: SquareIcon, label: 'Rectangle (R) — drag; Shift for a square' },
    { id: 'ellipse', icon: CircleIcon, label: 'Ellipse (E) — drag; Shift for a circle' },
    { id: 'line', icon: Slash, label: 'Line (L) — drag' },
    { id: 'pen', icon: PenLine, label: 'Pencil (P) — draw freehand' },
    { id: 'text', icon: TypeIcon, label: 'Text (T) — click where the text goes' },
  ];

  export function setTool(t: Tool) {
    tool = t;
  }

  // Keep the outline and the selection box in step with the view size.
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => (fitted ? fit() : measureBox()));
    ro.observe(host);
    return () => ro.disconnect();
  });

  export const test = { rootEl: () => root, inline, pv: () => pv, box: () => box, tool: () => tool };
</script>

<div class="design">
  <div class="tools" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
    {#each TOOLS as t (t.id)}
      <button class="icon-btn" class:on={tool === t.id} title={t.label} aria-label={t.label} onclick={() => (tool = t.id)}><Icon icon={t.icon} size={16} /></button>
    {/each}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="canvas {bg}"
    class:drawing={tool !== 'select' && tool !== 'hand'}
    class:hand={tool === 'hand'}
    bind:this={host}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onwheel={wheel}
    ondblclick={dbl}
  >
    <div class="stage" bind:this={stage}></div>
    {#if box && tool === 'select'}
      <div class="sel" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.w}px" style:height="{box.h}px">
        <span class="h scale" role="presentation" title="Drag to scale" onpointerdown={(e) => handleDown(e, 'scale')}></span>
        <span class="h rot" role="presentation" title="Drag to rotate (Shift snaps to 15°)" onpointerdown={(e) => handleDown(e, 'rotate')}></span>
      </div>
    {/if}
    {#if parseError}<div class="err">{parseError}</div>{/if}
  </div>
</div>

<style>
  .design {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-soft);
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .canvas {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
    cursor: default;
    background: var(--pasteboard);
  }
  .canvas.drawing {
    cursor: crosshair;
  }
  .canvas.hand {
    cursor: grab;
  }
  .stage :global(svg.art) {
    position: absolute;
    overflow: visible;
    box-shadow: 0 0 0 1px var(--canvas-edge);
  }
  .canvas.checker .stage :global(svg.art) {
    background-color: var(--checker-b);
    background-image: linear-gradient(45deg, var(--checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  }
  .canvas.light .stage :global(svg.art) {
    background: #fff;
  }
  .canvas.dark .stage :global(svg.art) {
    background: #1b1b1b;
  }
  .sel {
    position: absolute;
    outline: 1.5px solid var(--accent);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .h {
    position: absolute;
    width: 11px;
    height: 11px;
    background: var(--accent);
    border: 2px solid #fff;
    border-radius: 3px;
    pointer-events: auto;
  }
  .scale {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }
  .rot {
    left: 50%;
    top: -24px;
    margin-left: -6px;
    border-radius: 50%;
    cursor: grab;
  }
  .err {
    position: absolute;
    left: 12px;
    top: 12px;
    color: var(--danger);
    background: var(--bg-elevated);
    padding: 4px 10px;
    border-radius: 6px;
  }
</style>
