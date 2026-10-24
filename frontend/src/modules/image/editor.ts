// Konva-based layered image editor.
//
// A document has a size and a stack of layers. Each layer is a Konva group
// holding a raster canvas and editable markup objects (arrows, shapes,
// text); the group's transform moves/rotates/scales the whole layer.
// Operations that need pixels (brush, blur, adjustments, background
// removal…) first "bake" the layer: render group + objects into a
// document-sized canvas and reset the transform. Raster canvases are never
// mutated after they enter the history, so undo snapshots can share them.
//
// Pixel selections are document-sized masks (selection.ts); markup
// selection uses Konva's transformer.
//
// A layer can have a mask: a canvas the size of its raster whose alpha says
// how much of the layer shows (like a selection: opaque = shown). The raster
// itself is never changed by it; what is drawn is raster ∘ mask (`shown`), or
// — when the layer also has markup — the cached group with the mask drawn
// over it as destination-in, so markup is masked too.
import Konva from 'konva/lib/Core';
import { Image as KImage } from 'konva/lib/shapes/Image';
import { Rect as KRect } from 'konva/lib/shapes/Rect';
import { Ellipse as KEllipse } from 'konva/lib/shapes/Ellipse';
import { Line as KLine } from 'konva/lib/shapes/Line';
import { Arrow } from 'konva/lib/shapes/Arrow';
import { Text as KText } from 'konva/lib/shapes/Text';
import { Transformer } from 'konva/lib/shapes/Transformer';
import { Label, Tag } from 'konva/lib/shapes/Label';
import type { Node as KNode } from 'konva/lib/Node';
import { centered, clampZoom, fitZoom, normRect, stepZoom, viewWith, wheelIntent, zoomAt, type Rect, type View } from './geometry';
import * as raster from './raster';
import * as sel from './selection';
import type { Selection, SelectMode } from './selection';
import { Adjuster, type Adjustments } from './adjust';
import { cssFamily } from './fonts';
import { t } from '../../core/i18n';

export type Tool =
  | 'hand'
  | 'move'
  | 'select'
  | 'ellipse'
  | 'lasso'
  | 'selbrush'
  | 'wand'
  | 'object'
  | 'crop'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'arrow'
  | 'rect'
  | 'oval'
  | 'text'
  | 'blur'
  | 'pixelate'
  | 'picker'
  | 'clone'
  | 'heal'
  | 'gradient';
export const REGION_TOOLS: Tool[] = ['crop', 'blur', 'pixelate'];
export const SELECT_TOOLS: Tool[] = ['select', 'ellipse', 'lasso', 'selbrush', 'wand', 'object'];
/** Tools whose selection gets handles: the outline itself moved, scaled and turned (not the pixels). */
const FRAMED_TOOLS: Tool[] = ['select', 'ellipse', 'lasso'];

export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'difference' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light';

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: Blend;
  objects: number;
  mask: boolean;
  maskOn: boolean;
}

export interface ObjectProps {
  kind: 'text' | 'arrow' | 'rect' | 'oval' | 'image';
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  color: string;
  outline?: boolean;
  shadow?: boolean;
  strokeWidth?: number;
  filled?: boolean;
  cornerRadius?: number;
}

export interface EditorState {
  width: number;
  height: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  hasRegion: boolean;
  hasSelection: boolean; // markup object selected
  pixelSelection: Rect | null;
  layers: LayerInfo[]; // bottom first
  activeId: string;
  object: ObjectProps | null;
  adjusting: boolean;
  /** Brush and eraser paint the active layer's mask instead of its pixels. */
  editMask: boolean;
  /** A selection lifted to be moved, scaled or rotated (applied with Enter, cancelled with Esc). */
  transforming: boolean;
  /** Degrees the view is turned (the picture isn't). */
  viewRotation: number;
  version: number; // increments on every committed change
}

export interface ToolOptions {
  color: string;
  brushSize: number;
  brushOpacity: number;
  strokeWidth: number; // 0 = automatic
  filled: boolean;
  cornerRadius: number; // rectangles, px (0 = sharp corners)
  fontFamily: string;
  fontSize: number; // 0 = automatic
  bold: boolean;
  italic: boolean;
  outline: boolean;
  shadow: boolean;
  wandTolerance: number;
  wandContiguous: boolean;
  /** On a mask the brush hides (eraser shows); false swaps them. */
  maskHide: boolean;
  /** Blur region tool: strength (1 = the usual). */
  regionBlur: number;
  /** Pixelate region tool: block size in pixels (0 = automatic, from the picture's size). */
  pixelSize: number;
  /** Gradient tool: its shape, what the colour fades to, and reversed. */
  gradType: 'linear' | 'radial';
  gradEnd: 'transparent' | 'white' | 'black';
  gradReverse: boolean;
}

interface LayerModel {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  blend: Blend;
  objects: string[];
  mask: HTMLCanvasElement | null;
  maskOn: boolean;
}

interface Snapshot {
  width: number;
  height: number;
  active: string;
  layers: LayerModel[];
}

interface LiveLayer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  group: Konva.Group;
  img: KImage;
  objs: Konva.Group;
  mask: HTMLCanvasElement | null;
  maskOn: boolean;
  /** Draws the mask over the cached group (destination-in) when the layer has markup. */
  maskNode: KImage;
  /** raster ∘ mask for the current pair. */
  shown: { canvas: HTMLCanvasElement; mask: HTMLCanvasElement; out: HTMLCanvasElement } | null;
}

const MAX_HISTORY = 40;
const MAX_HISTORY_PIXELS = 160e6;
const ACCENT = '#d97757';
/** Transformer handle size: bigger where the pointer is a finger. */
const ANCHOR = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 18 : 9;

let layerSeq = 0;
const newId = () => `L${Date.now().toString(36)}${(++layerSeq).toString(36)}`;

/** A new, untransformed, unmasked layer. */
function plainLayer(name: string, canvas: HTMLCanvasElement): LayerModel {
  return { id: newId(), name, canvas, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, blend: 'source-over', objects: [], mask: null, maskOn: true };
}

/** c with the mask's alpha applied (a new canvas). */
/** A path carried by a matrix. */
function moved(p: Path2D, m: DOMMatrix): Path2D {
  const q = new Path2D();
  q.addPath(p, m);
  return q;
}

/** A soft round brush stamped from a to b (clone stamp): full in the middle, fading over its outer half. */
function stamp(g: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, size: number) {
  const r = Math.max(1, size / 2);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const step = Math.max(1, r * 0.25);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = len ? 1 : 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function applyMask(c: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = raster.clone(c);
  const g = out.getContext('2d')!;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0, out.width, out.height);
  return out;
}

export class ImageEditor {
  stage: Konva.Stage;
  private klayer: Konva.Layer;
  private world: Konva.Group;
  private docGroup: Konva.Group;
  private overlay: Konva.Shape;
  private backdrop: Konva.Shape;
  private checker: { key: string; fill: CanvasPattern | string; base: string; edge: string } | null = null;
  private region: KRect;
  private regionTr: Transformer;
  /** Blur / pixelate region tools: the result shown inside the area before it is applied. */
  private regionPreview: KImage;
  private regionSrc: { key: string; canvas: HTMLCanvasElement } | null = null;
  private previewRaf = 0;
  /** Handles round the selection: they move, scale and turn the outline, never the pixels. */
  private selFrame: KRect;
  private selTr: Transformer;
  /** The selection the handles were put round and its box then; the frame's transform makes `result` from it. */
  private selBase: { sel: Selection; rect: Rect; result: Selection } | null = null;
  /** The frame is being dragged or turned (the outline previews). */
  private selLive = false;
  private tr: Transformer;
  /** The angle shown by the pointer while a layer or selection is being turned. */
  private angleTip: Label;
  private lassoLine: KLine;
  private layers: LiveLayer[] = [];
  private activeId = '';
  private draft: KNode | null = null;
  private start: { x: number; y: number } | null = null;
  private lasso: number[] | null = null;
  private selPaint: number[] | null = null;
  private selPaintLine: KLine;
  /** A gradient being dragged: the layer (or mask) before it, and the guide line shown meanwhile. */
  private gradient: { before: HTMLCanvasElement; onMask: boolean; from: { x: number; y: number }; to: { x: number; y: number }; raf: number } | null = null;
  private gradLine!: KLine;
  private stroke: {
    canvas: HTMLCanvasElement;
    g: CanvasRenderingContext2D;
    last: { x: number; y: number };
    before: HTMLCanvasElement;
    /** With a selection: the bare stroke, shown through the mask into `canvas` as it grows. */
    paint: HTMLCanvasElement | null;
    /** Removes (destination-out) rather than paints. */
    erase: boolean;
    /** Painting the layer's mask. */
    onMask: boolean;
    /** Clone stamp: paint is a soft mask through which the shifted layer shows. */
    clone: boolean;
  } | null = null;
  private docW: number;
  private docH: number;
  view: View = { zoom: 1, x: 0, y: 0 };
  tool: Tool = 'hand';
  opts: ToolOptions = {
    color: '#e5484d',
    brushSize: 0,
    brushOpacity: 1,
    strokeWidth: 0,
    filled: false,
    cornerRadius: 0,
    fontFamily: 'Inter Variable',
    fontSize: 0,
    bold: true,
    italic: false,
    outline: false,
    shadow: true,
    wandTolerance: 32,
    wandContiguous: true,
    maskHide: true,
    regionBlur: 1,
    pixelSize: 0,
    gradType: 'linear',
    gradEnd: 'transparent',
    gradReverse: false,
  };
  editMask = false;
  selection: Selection | null = null;
  selectMode: SelectMode = 'replace';
  private adjuster: { a: Adjuster; layer: LiveLayer } | null = null;
  private history: Snapshot[] = [];
  private index = -1;
  private savedIndex = 0;
  private version = 0;
  private fitted = true;
  private ro: ResizeObserver;
  private themeWatch: MutationObserver;
  onChange: (s: EditorState) => void = () => {};
  /** Asks the user for text (wired to the app's prompt dialog). */
  askText: (initial: string) => Promise<string | null> = async () => null;
  /** Called on a click with the wand or object tool (handled by the module, which talks to the vision worker). */
  onPick: (tool: 'wand' | 'object' | 'picker' | 'fill', x: number, y: number, mode: SelectMode) => void = () => {};
  /** Called after the selection brush changed the selection (the module draws its outline off the main thread). */
  onPainted: (s: Selection) => void = () => {};
  /** Spot healing (the module runs it in the vision worker): a crop of the layer and the painted mask → the healed crop. */
  onHeal: (crop: HTMLCanvasElement, mask: HTMLCanvasElement) => Promise<CanvasImageSource | null> = async () => null;
  /** A short message for the user (wired to the app's toasts). */
  notify: (msg: string) => void = () => {};

  // ---- clone stamp ----
  /** Where Alt-click chose to copy from, and the stroke-to-source shift once painting started (aligned). */
  private cloneSrc: { x: number; y: number } | null = null;
  private cloneOffset: { dx: number; dy: number } | null = null;
  private cloneMark: Konva.Group;
  /** Spot healing: the stroke being painted (document points). */
  private healPts: number[] | null = null;

  constructor(
    private container: HTMLDivElement,
    base: HTMLCanvasElement,
  ) {
    this.docW = base.width;
    this.docH = base.height;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.klayer = new Konva.Layer();
    this.stage.add(this.klayer);
    this.backdrop = new Konva.Shape({ listening: false, sceneFunc: (ctx) => this.drawBackdrop(ctx) });
    this.klayer.add(this.backdrop);
    this.world = new Konva.Group({ draggable: true });
    this.klayer.add(this.world);
    this.docGroup = new Konva.Group({ clipFunc: (ctx) => ctx.rect(0, 0, this.docW, this.docH) });
    this.world.add(this.docGroup);
    this.overlay = new Konva.Shape({ listening: false, sceneFunc: (ctx) => this.drawSelection(ctx) });
    this.world.add(this.overlay);
    this.lassoLine = new KLine({ points: [], stroke: '#fff', strokeWidth: 1, strokeScaleEnabled: false, dash: [4, 4], listening: false, closed: false });
    this.world.add(this.lassoLine);
    this.selPaintLine = new KLine({ points: [], stroke: 'rgba(255, 70, 70, 0.45)', lineCap: 'round', lineJoin: 'round', listening: false });
    this.world.add(this.selPaintLine);
    this.cloneMark = new Konva.Group({ visible: false, listening: false });
    for (const [stroke, dash] of [['#000', undefined], ['#fff', [3, 3]]] as const) {
      this.cloneMark.add(new KEllipse({ x: 0, y: 0, radiusX: 1, radiusY: 1, stroke, strokeWidth: 1.5, strokeScaleEnabled: false, dash: dash ? [...dash] : undefined, name: 'ring' }));
      this.cloneMark.add(new KLine({ points: [-6, 0, 6, 0], stroke, strokeWidth: 1.5, strokeScaleEnabled: false, dash: dash ? [...dash] : undefined, name: 'cross' }));
      this.cloneMark.add(new KLine({ points: [0, -6, 0, 6], stroke, strokeWidth: 1.5, strokeScaleEnabled: false, dash: dash ? [...dash] : undefined, name: 'cross' }));
    }
    this.world.add(this.cloneMark);
    this.gradLine = new KLine({ points: [], stroke: '#fff', strokeWidth: 1.5, strokeScaleEnabled: false, shadowColor: '#000', shadowBlur: 2, shadowOpacity: 0.9, listening: false });
    this.world.add(this.gradLine);
    this.region = new KRect({ visible: false, stroke: '#ffffff', dash: [6, 4], strokeScaleEnabled: false, strokeWidth: 1.5, fill: 'rgba(217,119,87,0.12)', draggable: true, name: 'region' });
    this.regionPreview = new KImage({ image: undefined, visible: false, listening: false });
    this.world.add(this.regionPreview);
    this.world.add(this.region);
    this.region.on('dragmove transform dragend transformend', () => this.schedulePreview());
    this.regionTr = new Transformer({ rotateEnabled: false, keepRatio: false, borderStroke: ACCENT, anchorStroke: ACCENT, anchorSize: ANCHOR, anchorCornerRadius: 3, ignoreStroke: true });
    this.selFrame = new KRect({ visible: false, fill: 'rgba(0,0,0,0)', draggable: true, name: 'selection-frame' });
    this.world.add(this.selFrame);
    this.selTr = new Transformer({ rotateEnabled: true, keepRatio: false, borderStroke: ACCENT, borderDash: [4, 4], anchorStroke: ACCENT, anchorSize: ANCHOR - 1, anchorCornerRadius: 2, name: 'selection-handles' });
    // Turning is free (any angle); Shift snaps to 15° steps (Konva's own).
    this.tr = new Transformer({ borderStroke: ACCENT, anchorStroke: ACCENT, anchorSize: ANCHOR, anchorCornerRadius: 3, rotateEnabled: true });
    this.angleTip = new Label({ visible: false, listening: false });
    this.angleTip.add(new Tag({ fill: 'rgba(20,20,20,0.85)', cornerRadius: 3 }), new KText({ text: '', fontSize: 12, fontFamily: 'Inter Variable, sans-serif', fill: '#fff', padding: 4 }));
    this.klayer.add(this.regionTr, this.selTr, this.tr, this.angleTip);
    for (const t of [this.tr, this.selTr]) {
      t.on('transform', () => this.showAngle(t));
      t.on('transformend', () => this.angleTip.visible(false));
    }
    this.addLiveLayer(plainLayer(t('Background'), base));
    this.activeId = this.layers[0].id;
    this.history = [this.snapshot()];
    this.index = 0;
    this.savedIndex = 0;
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    // The backdrop's colours follow the app theme.
    this.themeWatch = new MutationObserver(() => this.klayer.batchDraw());
    this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.fit();
  }

  // ---- document ----

  get width() {
    return this.docW;
  }
  get height() {
    return this.docH;
  }
  get color() {
    return this.opts.color;
  }
  set color(c: string) {
    this.opts.color = c;
  }

  private get active(): LiveLayer {
    return this.layers.find((l) => l.id === this.activeId) ?? this.layers[this.layers.length - 1];
  }

  /** The active layer's pixels in document coordinates (markup included). */
  get base(): HTMLCanvasElement {
    return this.layerDocCanvas(this.active);
  }

  // ---- view ----

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.stage.size({ width: w, height: h });
    if (this.fitted) this.fit();
    else this.apply();
  }

  setView(v: View, fitted = false) {
    this.view = v;
    this.fitted = fitted;
    this.apply();
  }

  private apply() {
    this.world.position({ x: this.view.x, y: this.view.y });
    this.world.scale({ x: this.view.zoom, y: this.view.zoom });
    this.world.rotation(this.viewRotation);
    this.klayer.imageSmoothingEnabled(this.view.zoom < 2);
    this.klayer.batchDraw();
    this.emit();
  }

  fit() {
    if (this.viewRotation) {
      // The turned picture's bounding box fits the window.
      const a = (this.viewRotation * Math.PI) / 180;
      const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
      const z = fitZoom(this.docW * c + this.docH * s, this.docW * s + this.docH * c, this.stage.width(), this.stage.height());
      return this.setView(this.centredAt(z), true);
    }
    const z = fitZoom(this.docW, this.docH, this.stage.width(), this.stage.height());
    this.setView(centered(this.docW, this.docH, this.stage.width(), this.stage.height(), z), true);
  }

  actualSize() {
    this.setView(this.viewRotation ? this.centredAt(1) : centered(this.docW, this.docH, this.stage.width(), this.stage.height(), 1));
  }

  // ---- turning the view (not the picture) ----

  /** Degrees the view is turned clockwise; the document itself is untouched. */
  viewRotation = 0;

  /** The view at zoom z with the document's centre (or a document point) in the middle of the window. */
  private centredAt(z: number, d = { x: this.docW / 2, y: this.docH / 2 }): View {
    return viewWith(z, this.viewRotation, d, { x: this.stage.width() / 2, y: this.stage.height() / 2 });
  }

  /** Turn the view by deg (or to an angle), about the middle of the window. */
  rotateView(deg: number, absolute = false) {
    const mid = this.docGroup.getAbsoluteTransform().copy().invert().point({ x: this.stage.width() / 2, y: this.stage.height() / 2 });
    let r = absolute ? deg : this.viewRotation + deg;
    r = ((((r + 180) % 360) + 360) % 360) - 180; // -180…180
    if (Math.abs(r) < 1e-9) r = 0;
    this.viewRotation = r;
    if (this.fitted) return this.fit();
    this.setView(this.centredAt(this.view.zoom, mid));
  }

  zoomStep(dir: 1 | -1) {
    this.setView(zoomAt(this.view, this.stage.width() / 2, this.stage.height() / 2, stepZoom(this.view.zoom, dir)));
  }

  // ---- tools ----

  setTool(t: Tool) {
    if (this.floating && t !== 'move') this.finishTransform(true);
    if (this.stroke) this.endStroke();
    this.cancelRegion();
    this.select(null);
    this.tool = t;
    this.world.draggable(t === 'hand');
    this.updateDraggable();
    if (t === 'move') this.tr.nodes([this.active.group]);
    this.showCloneMark(this.cloneSrc);
    const cursors: Partial<Record<Tool, string>> = { hand: 'grab', move: 'move', text: 'text', brush: 'crosshair', eraser: 'crosshair' };
    this.container.style.cursor = cursors[t] ?? 'crosshair';
    this.klayer.batchDraw();
    this.emit();
  }

  setOptions(o: Partial<ToolOptions>) {
    Object.assign(this.opts, o);
    if ('regionBlur' in o || 'pixelSize' in o) this.schedulePreview();
    if ('brushSize' in o && this.cloneMark.visible()) this.showCloneMark(this.cloneMark.position());
  }

  private updateDraggable() {
    for (const L of this.layers) {
      L.group.draggable(this.tool === 'move' && L.id === this.activeId);
      // Moving: only the active layer takes the pointer — a layer above it
      // (even a transparent one, hit as its whole rectangle) mustn't catch the drag.
      L.group.listening(this.tool !== 'move' || L.id === this.activeId);
      L.objs.getChildren().forEach((n) => n.draggable(this.tool === 'hand'));
    }
  }

  // ---- touch: two fingers pan and pinch-zoom; one finger works like the mouse ----

  /** The last touchpad pan (ms), so a gesture keeps panning. */
  private lastPan = -1e9;
  /** A two-finger gesture: zoom and document point under the fingers' middle at its start. */
  private pinch: { dist: number; zoom: number; at: { x: number; y: number } } | null = null;
  /** When the last two-finger gesture ended (a lifted finger isn't a tap). */
  private pinchEnded = -1e9;

  private bindTouch() {
    const el = this.container;
    el.style.touchAction = 'none'; // the editor handles touch itself (no page scroll or browser zoom)
    const local = (t: Touch) => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const mid = (e: TouchEvent) => {
      const [a, b] = [local(e.touches[0]), local(e.touches[1])];
      return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    // Capture phase: the canvas never sees a second finger, so it can't start a drag or a stroke.
    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        this.abortPointer();
        const { m, d } = mid(e);
        this.pinch = { dist: d, zoom: this.view.zoom, at: this.docGroup.getAbsoluteTransform().copy().invert().point(m) };
      },
      { capture: true, passive: false },
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (!this.pinch) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.touches.length < 2) return;
        const { m, d } = mid(e);
        this.setView(viewWith(clampZoom((this.pinch.zoom * d) / this.pinch.dist), this.viewRotation, this.pinch.at, m));
      },
      { capture: true, passive: false },
    );
    // Lifting fingers reaches the canvas, which ends any drag it had readied.
    el.addEventListener(
      'touchend',
      (e) => {
        if (!this.pinch) return;
        if (e.touches.length === 0) this.pinch = null;
        this.pinchEnded = performance.now();
      },
      { capture: true },
    );
    el.addEventListener('touchcancel', () => (this.pinch = null), { capture: true });
    // Safari's touchpad pinch.
    let g0 = 1;
    el.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      g0 = this.view.zoom;
    });
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const r = el.getBoundingClientRect();
      this.setView(zoomAt(this.view, ge.clientX - r.left, ge.clientY - r.top, clampZoom(g0 * ge.scale)));
    });
  }

  /** Drop what a first finger began (a stroke, a shape, a selection, a drag) when a second one comes. */
  private abortPointer() {
    if (this.stroke) {
      const s = this.stroke;
      this.stroke = null;
      if (s.onMask) this.setCanvas(this.active, this.active.canvas, s.before);
      else this.setCanvas(this.active, s.before);
    }
    if (this.draft) {
      this.draft.destroy();
      this.draft = null;
    }
    if (this.start && this.region.visible() && !this.regionTr.nodes().length) this.cancelRegion();
    this.start = null;
    this.lasso = null;
    this.lassoLine.points([]);
    this.selPaint = null;
    this.healPts = null;
    if (this.gradient) {
      const gr = this.gradient;
      cancelAnimationFrame(gr.raf);
      this.gradient = null;
      this.gradLine.points([]);
      if (gr.onMask) this.setCanvas(this.active, this.active.canvas, gr.before);
      else this.setCanvas(this.active, gr.before);
    }
    this.selPaintLine.points([]);
    for (const tr of [this.tr, this.regionTr, this.selTr]) if (tr.isTransforming()) tr.stopTransform();
    const nodes: KNode[] = [this.world, this.selFrame, this.region, ...this.layers.flatMap((L) => [L.group as KNode, ...(L.objs.getChildren() as KNode[])])];
    for (const n of nodes) if (n.isDragging()) n.stopDrag();
    this.klayer.batchDraw();
  }

  private pointer(): { x: number; y: number } {
    const p = this.docGroup.getRelativePointerPosition() ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  }

  private autoStroke(): number {
    return this.opts.strokeWidth || Math.max(3, Math.round(Math.max(this.docW, this.docH) / 220));
  }

  private brushSize(): number {
    return this.opts.brushSize || Math.max(4, Math.round(Math.max(this.docW, this.docH) / 120));
  }

  private modeFor(e: MouseEvent | TouchEvent): SelectMode {
    const m = e as MouseEvent;
    return m.shiftKey ? 'add' : m.altKey ? 'subtract' : this.selectMode;
  }

  private bindEvents() {
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const p = this.stage.getPointerPosition();
      if (!p) return;
      const w = e.evt as WheelEvent & { wheelDeltaY?: number };
      const now = performance.now();
      const intent = wheelIntent(w, now - this.lastPan < 200);
      if (intent === 'pan') {
        // Two fingers on a touchpad: the picture follows them.
        this.lastPan = now;
        this.setView({ ...this.view, x: this.view.x - w.deltaX, y: this.view.y - w.deltaY });
        return;
      }
      const factor = Math.exp(-w.deltaY * (w.ctrlKey ? 0.01 : 0.0025));
      this.setView(zoomAt(this.view, p.x, p.y, clampZoom(this.view.zoom * factor)));
    });
    this.bindTouch();
    const isWorld = (n: unknown) => n === (this.world as unknown);
    this.world.on('dragmove', (e) => {
      if (!isWorld(e.target)) return;
      this.view = { ...this.view, x: this.world.x(), y: this.world.y() };
      this.fitted = false;
    });
    this.world.on('dragstart', (e) => isWorld(e.target) && (this.container.style.cursor = 'grabbing'));
    this.world.on('dragend', (e) => isWorld(e.target) && (this.container.style.cursor = this.tool === 'hand' ? 'grab' : 'crosshair'));

    this.selFrame.on('dragmove transform', () => {
      this.selLive = true;
      this.klayer.batchDraw();
    });
    this.selFrame.on('dragend transformend', () => this.commitSelFrame());
    // A click inside (not a drag) drops it, like a click anywhere.
    this.selFrame.on('click tap', (e) => this.modeFor(e.evt) === 'replace' && performance.now() - this.pinchEnded > 400 && this.deselect());
    this.selFrame.on('mouseenter', () => (this.container.style.cursor = 'move'));
    this.selFrame.on('mouseleave', () => (this.container.style.cursor = 'crosshair'));

    this.stage.on('mousedown touchstart', (e) => {
      const t = this.tool;
      const target = e.target;
      if (target === this.selFrame) {
        // Shift / Alt (or the add / subtract mode) draws another selection there instead of moving this one.
        if (this.modeFor(e.evt) === 'replace') return;
        this.selFrame.draggable(false);
        this.selFrame.draggable(true);
      }
      const onTr = !!target.getParent()?.className?.includes('Transformer');
      if (t === 'hand') {
        const owner = this.layers.find((L) => target.getParent() === L.objs);
        if (owner) {
          this.activeId = owner.id;
          this.select(target);
        } else if (!onTr) this.select(null);
        return;
      }
      if (t === 'move') return; // the transformer handles it
      if (target === this.region || target.getParent() === this.regionTr || onTr) return;
      const p = this.pointer();
      const mode = this.modeFor(e.evt);
      if (t === 'wand' || t === 'object' || t === 'picker' || t === 'fill') {
        this.onPick(t, p.x, p.y, mode);
        return;
      }
      if (t === 'text') {
        void this.addText(p);
        return;
      }
      if (t === 'clone' && ((e.evt as MouseEvent).altKey || !this.cloneSrc)) {
        if ((e.evt as MouseEvent).altKey) this.setCloneSource(p);
        else this.askCloneSource();
        return;
      }
      this.start = p;
      const sw = this.autoStroke();
      const c = this.opts.color;
      if (t === 'arrow') {
        this.draft = new Arrow({ points: [p.x, p.y, p.x, p.y], stroke: c, fill: c, strokeWidth: sw, pointerLength: sw * 4, pointerWidth: sw * 4, lineCap: 'round', lineJoin: 'round' });
      } else if (t === 'rect') {
        this.draft = new KRect({ x: p.x, y: p.y, width: 0, height: 0, stroke: c, strokeWidth: sw, cornerRadius: this.opts.cornerRadius, fill: this.opts.filled ? c : undefined });
      } else if (t === 'oval') {
        this.draft = new KEllipse({ x: p.x, y: p.y, radiusX: 0, radiusY: 0, stroke: c, strokeWidth: sw, fill: this.opts.filled ? c : undefined });
      } else if (REGION_TOOLS.includes(t) || t === 'select' || t === 'ellipse') {
        this.region.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true, cornerRadius: 0 });
        this.regionTr.nodes([]);
        return;
      } else if (t === 'selbrush') {
        this.selPaint = [p.x, p.y, p.x, p.y];
        this.selPaintLine.setAttrs({ points: this.selPaint, strokeWidth: this.selBrushSize() });
        this.klayer.batchDraw();
        return;
      } else if (t === 'lasso') {
        this.lasso = [p.x, p.y];
        this.lassoLine.points(this.lasso);
        return;
      } else if (t === 'brush' || t === 'eraser' || t === 'clone') {
        this.beginStroke(p);
        return;
      } else if (t === 'gradient') {
        const L = this.active;
        this.bake(L);
        const onMask = this.editMask && !!L.mask;
        this.gradient = { before: onMask ? L.mask! : L.canvas, onMask, from: p, to: p, raf: 0 };
        return;
      } else if (t === 'heal') {
        this.healPts = [p.x, p.y, p.x, p.y];
        this.selPaintLine.setAttrs({ points: this.healPts, strokeWidth: this.brushSize(), stroke: 'rgba(255, 180, 40, 0.5)' });
        this.klayer.batchDraw();
        return;
      }
      if (this.draft) this.active.objs.add(this.draft as Konva.Shape);
    });

    this.stage.on('mousemove touchmove', (e) => {
      if (!this.start && !this.lasso) return;
      let p = this.pointer();
      if (this.stroke) {
        this.strokeTo(p);
        return;
      }
      if (this.gradient) {
        const g = this.gradient;
        // Shift: the angle in 45° steps.
        if ((e.evt as MouseEvent).shiftKey) {
          const a = Math.round(Math.atan2(p.y - g.from.y, p.x - g.from.x) / (Math.PI / 4)) * (Math.PI / 4);
          const d = Math.hypot(p.x - g.from.x, p.y - g.from.y);
          p = { x: g.from.x + d * Math.cos(a), y: g.from.y + d * Math.sin(a) };
        }
        g.to = p;
        this.gradLine.points([g.from.x, g.from.y, p.x, p.y]);
        cancelAnimationFrame(g.raf);
        g.raf = requestAnimationFrame(() => this.showGradient());
        return;
      }
      const painted = this.selPaint ?? this.healPts;
      if (painted) {
        const n = painted.length;
        if (Math.hypot(p.x - painted[n - 2], p.y - painted[n - 1]) * this.view.zoom > 2) {
          painted.push(p.x, p.y);
          this.selPaintLine.points(painted);
          this.klayer.batchDraw();
        }
        return;
      }
      if (this.lasso) {
        const n = this.lasso.length;
        if (Math.hypot(p.x - this.lasso[n - 2], p.y - this.lasso[n - 1]) * this.view.zoom > 3) {
          this.lasso.push(p.x, p.y);
          this.lassoLine.points(this.lasso);
          this.klayer.batchDraw();
        }
        return;
      }
      const s = this.start!;
      // Ctrl/Cmd (or Shift for shapes) keeps squares square and circles round.
      const m = e.evt as MouseEvent;
      const shape = this.draft instanceof KRect || this.draft instanceof KEllipse;
      if ((m.ctrlKey || m.metaKey || (shape && m.shiftKey)) && !(this.draft instanceof Arrow)) {
        const d = Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y));
        p = { x: s.x + (p.x < s.x ? -d : d), y: s.y + (p.y < s.y ? -d : d) };
      }
      if (this.draft instanceof Arrow) this.draft.points([s.x, s.y, p.x, p.y]);
      else if (this.draft instanceof KRect) this.draft.setAttrs({ width: p.x - s.x, height: p.y - s.y });
      else if (this.draft instanceof KEllipse) this.draft.setAttrs({ x: (s.x + p.x) / 2, y: (s.y + p.y) / 2, radiusX: Math.abs(p.x - s.x) / 2, radiusY: Math.abs(p.y - s.y) / 2 });
      else if (this.region.visible()) {
        this.region.setAttrs({ width: p.x - s.x, height: p.y - s.y });
        this.schedulePreview();
      }
      this.klayer.batchDraw();
    });

    this.stage.on('mouseup touchend', (e) => {
      if (this.stroke) {
        this.endStroke();
        this.start = null;
        return;
      }
      if (this.gradient) {
        this.start = null;
        this.endGradient();
        return;
      }
      if (this.selPaint) {
        const pts = this.selPaint;
        this.selPaint = null;
        this.start = null;
        this.selPaintLine.points([]);
        this.paintSelection(pts, (e.evt as MouseEvent).altKey ? 'subtract' : 'add');
        return;
      }
      if (this.healPts) {
        const pts = this.healPts;
        this.healPts = null;
        this.start = null;
        void this.healStroke(pts);
        return;
      }
      if (this.lasso) {
        const pts = this.lasso;
        this.lasso = null;
        this.lassoLine.points([]);
        if (pts.length >= 6) {
          const b = sel.polygonBounds(pts, this.docW, this.docH);
          this.setPixelSelection(sel.fromPath(sel.polygonPath(pts), b, this.docW, this.docH), this.modeFor(e.evt));
        }
        this.klayer.batchDraw();
        return;
      }
      if (!this.start) return;
      this.start = null;
      const d = this.draft;
      this.draft = null;
      if (d) {
        const tiny =
          d instanceof Arrow
            ? Math.hypot(d.points()[2] - d.points()[0], d.points()[3] - d.points()[1]) < 4
            : d instanceof KEllipse
              ? d.radiusX() < 2 || d.radiusY() < 2
              : Math.abs((d as KRect).width()) < 3 || Math.abs((d as KRect).height()) < 3;
        if (tiny) {
          d.destroy();
          this.klayer.batchDraw();
          return;
        }
        if (d instanceof KRect) d.setAttrs(normRect({ x: d.x(), y: d.y(), width: d.width(), height: d.height() }, Infinity, Infinity));
        this.decorate(d);
        this.commit();
        return;
      }
      if (!this.region.visible()) return;
      const r = normRect(this.regionRect(), this.docW, this.docH);
      if (r.width < 3 || r.height < 3) {
        if (this.tool === 'select' || this.tool === 'ellipse') this.deselect();
        this.cancelRegion();
        return;
      }
      if (this.tool === 'select' || this.tool === 'ellipse') {
        this.cancelRegion();
        const path = this.tool === 'select' ? sel.rectPath(r) : sel.ellipsePath(r);
        this.setPixelSelection(sel.fromPath(path, r, this.docW, this.docH), this.modeFor(e.evt));
        return;
      }
      this.region.setAttrs(r);
      this.regionTr.nodes([this.region]);
      this.schedulePreview();
      this.klayer.batchDraw();
      this.emit();
    });
  }

  // ---- region (crop / blur / pixelate) ----

  private regionRect(): Rect {
    const r = this.region;
    return { x: r.x(), y: r.y(), width: r.width() * r.scaleX(), height: r.height() * r.scaleY() };
  }

  currentRegion(): Rect | null {
    if (!this.region.visible()) return null;
    const r = normRect(this.regionRect(), this.docW, this.docH);
    return r.width >= 1 && r.height >= 1 ? r : null;
  }

  setRegion(r: Rect) {
    this.region.setAttrs({ ...r, scaleX: 1, scaleY: 1, visible: true });
    this.regionTr.nodes([this.region]);
    this.schedulePreview();
    this.klayer.batchDraw();
    this.emit();
  }

  cancelRegion() {
    this.region.setAttrs({ visible: false, scaleX: 1, scaleY: 1 });
    this.regionTr.nodes([]);
    cancelAnimationFrame(this.previewRaf);
    this.regionPreview.visible(false);
    this.regionSrc = null;
    this.klayer.batchDraw();
    this.emit();
  }

  applyRegion() {
    const r = this.currentRegion();
    if (!r) return;
    const tool = this.tool;
    this.cancelRegion();
    if (tool === 'crop') this.crop(r);
    else if (tool === 'blur') this.pixelOp((c) => raster.blurRegion(c, r, this.opts.regionBlur));
    else if (tool === 'pixelate') this.pixelOp((c) => raster.pixelateRegion(c, r, this.pixelBlock()));
  }

  /** Pixelate region: the block size (automatic: about 1/80 of the picture's longer side). */
  pixelBlock(): number {
    return this.opts.pixelSize || Math.max(6, Math.round(Math.max(this.docW, this.docH) / 80));
  }

  private schedulePreview() {
    if (this.tool !== 'blur' && this.tool !== 'pixelate') return;
    cancelAnimationFrame(this.previewRaf);
    this.previewRaf = requestAnimationFrame(() => this.drawRegionPreview());
  }

  /** The area blurred or pixelated as it will be, over the picture (only the area is worked out). */
  private drawRegionPreview() {
    const r = this.region.visible() ? normRect(this.regionRect(), this.docW, this.docH) : null;
    if (!r || r.width < 2 || r.height < 2 || (this.tool !== 'blur' && this.tool !== 'pixelate')) {
      this.regionPreview.visible(false);
      this.klayer.batchDraw();
      return;
    }
    const key = `${this.activeId}:${this.version}:${this.index}`;
    if (this.regionSrc?.key !== key) this.regionSrc = { key, canvas: this.layerDocCanvas(this.active) };
    const part = raster.crop(this.regionSrc.canvas, r);
    const all = { x: 0, y: 0, width: r.width, height: r.height };
    const out = this.tool === 'blur' ? raster.blurRegion(part, all, this.opts.regionBlur) : raster.pixelateRegion(part, all, this.pixelBlock());
    this.regionPreview.setAttrs({ image: out, x: r.x, y: r.y, width: r.width, height: r.height, visible: true });
    this.klayer.batchDraw();
  }

  // ---- pixel selection ----

  setPixelSelection(s: Selection | null, mode: SelectMode = 'replace') {
    this.selection = s ? sel.combine(this.selection, s, mode) : null;
    if (this.selection && sel.isEmpty(this.selection)) this.selection = null;
    this.klayer.batchDraw();
    this.emit();
  }

  deselect() {
    this.setPixelSelection(null);
  }

  private selBrushSize(): number {
    return this.opts.brushSize || 24;
  }

  /** Selection brush: a stroke through points (document pixels) added to or taken from the selection. */
  paintSelection(pts: number[], mode: SelectMode = 'add') {
    const size = this.selBrushSize();
    const mask = raster.makeCanvas(this.docW, this.docH);
    const g = mask.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.lineWidth = size;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
    // A click (or a stroke that didn't move): a dot — zero-length lines draw nothing in WebKit.
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(pts[0], pts[1], size / 2, 0, Math.PI * 2);
    g.fill();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]);
      y1 = Math.max(y1, pts[i + 1]);
    }
    const r = size / 2 + 1;
    const b = sel.clampRect({ x: Math.floor(x0 - r), y: Math.floor(y0 - r), width: Math.ceil(x1 - x0 + 2 * r), height: Math.ceil(y1 - y0 + 2 * r) }, this.docW, this.docH);
    this.setPixelSelection(sel.fromMask(mask, b, null), mode);
    if (this.selection) this.onPainted(this.selection);
  }

  /** The outline for a selection, once worked out (ignored if the selection has changed since). */
  setSelectionEdges(s: Selection, edges: NonNullable<Selection['edges']>) {
    if (this.selection !== s) return;
    s.edges = edges;
    this.klayer.batchDraw();
  }

  selectAll() {
    this.setPixelSelection(sel.selectAll(this.docW, this.docH));
  }

  invertSelection(edges?: Selection['edges']) {
    const s = sel.invert(this.selection, this.docW, this.docH);
    s.edges = edges ?? null;
    this.selection = s;
    this.klayer.batchDraw();
    this.emit();
  }

  /** Pasteboard view of the document: checkerboard inside, thin edge and soft shadow outside. */
  private drawBackdrop(ctx: Konva.Context) {
    const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    const look = this.backdropLook(c);
    const { zoom } = this.view;
    const x = Math.round(this.view.x);
    const y = Math.round(this.view.y);
    const w = Math.round(this.docW * zoom);
    const h = Math.round(this.docH * zoom);
    // Drawn from the document's corner, turned with the view (the whole canvas turns, not just its layers).
    c.save();
    c.translate(x, y);
    if (this.viewRotation) c.rotate((this.viewRotation * Math.PI) / 180);
    // A few faint rings instead of shadowBlur, which is slow on software-rendered canvases.
    c.lineWidth = 1;
    for (let i = 2; i <= 6; i += 2) {
      c.strokeStyle = `rgba(0,0,0,${0.24 / i})`;
      c.strokeRect(-0.5 - i, -0.5 - i, w + 1 + 2 * i, h + 1 + 2 * i);
    }
    c.fillStyle = look.base;
    c.fillRect(0, 0, w, h);
    c.fillStyle = look.fill; // checker squares stay put relative to the image while panning
    c.fillRect(0, 0, w, h);
    c.strokeStyle = look.edge;
    c.strokeRect(-0.5, -0.5, w + 1, h + 1);
    c.restore();
  }

  private backdropLook(c: CanvasRenderingContext2D) {
    const key = document.documentElement.dataset.theme ?? '';
    if (this.checker?.key === key) return this.checker;
    const css = getComputedStyle(this.container);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const a = v('--checker-a', '#2a2926');
    const tile = document.createElement('canvas');
    tile.width = tile.height = 20;
    const g = tile.getContext('2d')!;
    g.fillStyle = a;
    g.fillRect(0, 0, 10, 10);
    g.fillRect(10, 10, 10, 10);
    this.checker = { key, fill: c.createPattern(tile, 'repeat') ?? a, base: v('--checker-b', '#1f1e1c'), edge: v('--canvas-edge', 'rgba(255,255,255,0.25)') };
    return this.checker;
  }

  private drawSelection(ctx: Konva.Context) {
    const s = this.selection;
    if (!s) return;
    const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    const lw = 1 / this.view.zoom;
    c.save();
    // While the handles move it (and until a moved mask's outline is worked
    // out) the outline drawn is the original one, carried by the frame.
    const B = this.selBase;
    const carried = B && (this.selLive || (s === B.result && s !== B.sel && !s.paths && !s.edges));
    const m = carried ? this.selDelta() : null;
    const o = carried ? B.sel : s;
    const ants = (paths: Path2D[]) => {
      c.lineWidth = lw;
      c.strokeStyle = '#000';
      for (const p of paths) c.stroke(p);
      c.strokeStyle = '#fff';
      c.setLineDash([4 * lw, 4 * lw]);
      for (const p of paths) c.stroke(p);
    };
    if (o.paths) {
      ants(m ? o.paths.map((p) => moved(p, m)) : o.paths);
    } else if (o.edges) {
      // Difference keeps the outline visible on light and dark pixels alike.
      c.imageSmoothingEnabled = false;
      c.globalCompositeOperation = 'difference';
      if (m) c.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      c.drawImage(o.edges.canvas, 0, 0, this.docW, this.docH);
    } else {
      const p = sel.rectPath(o.bounds);
      c.lineWidth = lw;
      c.strokeStyle = '#fff';
      c.setLineDash([4 * lw, 4 * lw]);
      c.stroke(m ? moved(p, m) : p);
    }
    c.restore();
  }

  // ---- moving, scaling and turning the selection's outline ----

  /** Handles round the selection with the select, ellipse and lasso tools; kept while the selection is the one they made. */
  private syncSelFrame() {
    const s = this.selection;
    if (!s || !FRAMED_TOOLS.includes(this.tool) || this.floating) {
      if (this.selBase || this.selFrame.visible()) {
        this.selBase = null;
        this.selLive = false;
        this.selFrame.visible(false);
        this.selTr.nodes([]);
        this.klayer.batchDraw();
      }
      return;
    }
    if (this.selBase?.result === s) return;
    const b = s.bounds;
    this.selBase = { sel: s, rect: { ...b }, result: s };
    this.selFrame.setAttrs({ x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, visible: true });
    this.selTr.nodes([this.selFrame]);
    this.klayer.batchDraw();
  }

  /** Document → document: where the frame has taken the original selection. */
  private selDelta(): DOMMatrix {
    const b = this.selBase!.rect;
    const [a, bb, c, d, e, f] = this.selFrame.getTransform().copy().multiply(new Konva.Transform([1, 0, 0, 1, -b.x, -b.y])).getMatrix();
    return new DOMMatrix([a, bb, c, d, e, f]);
  }

  /** The selection moved, scaled or turned with the handles: its mask redrawn, the pixels untouched. */
  private commitSelFrame() {
    const B = this.selBase;
    this.selLive = false;
    if (!B || this.selection !== B.result) return;
    const m = this.selDelta();
    const base = B.sel;
    let next: Selection = base;
    if (!m.isIdentity) {
      const mask = raster.makeCanvas(this.docW, this.docH);
      const g = mask.getContext('2d')!;
      g.setTransform(m);
      g.drawImage(base.mask, 0, 0);
      const r = B.rect;
      const pts = [m.transformPoint(new DOMPoint(r.x, r.y)), m.transformPoint(new DOMPoint(r.x + r.width, r.y)), m.transformPoint(new DOMPoint(r.x, r.y + r.height)), m.transformPoint(new DOMPoint(r.x + r.width, r.y + r.height))];
      const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
      const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
      const bounds = sel.clampRect({ x: x0, y: y0, width: Math.ceil(Math.max(...pts.map((p) => p.x))) - x0, height: Math.ceil(Math.max(...pts.map((p) => p.y))) - y0 }, this.docW, this.docH);
      next = { mask, bounds, paths: base.paths ? base.paths.map((p) => moved(p, m)) : null, edges: null };
      if (sel.isEmpty(next)) return this.deselect(); // moved off the picture
    }
    B.result = next;
    this.selection = next;
    if (!next.paths && next !== base) this.onPainted(next);
    this.klayer.batchDraw();
    this.emit();
  }

  // ---- layers ----

  private addLiveLayer(m: LayerModel, index = this.layers.length): LiveLayer {
    const group = new Konva.Group({ x: m.x, y: m.y, rotation: m.rotation, scaleX: m.scaleX, scaleY: m.scaleY, opacity: m.opacity, visible: m.visible, globalCompositeOperation: m.blend, name: 'layer' });
    const img = new KImage({ image: m.canvas, x: 0, y: 0, width: m.canvas.width, height: m.canvas.height, name: 'raster' });
    const objs = new Konva.Group({ name: 'objects' });
    const maskNode = new KImage({ image: m.mask ?? undefined, x: 0, y: 0, globalCompositeOperation: 'destination-in', visible: false, listening: false, name: 'mask' });
    group.add(img, objs, maskNode);
    for (const json of m.objects) {
      const n = Konva.Node.create(json) as KNode;
      objs.add(n as Konva.Shape);
      this.decorate(n);
    }
    group.on('dragend transformend', () => this.commit());
    const L: LiveLayer = { id: m.id, name: m.name, canvas: m.canvas, group, img, objs, mask: m.mask, maskOn: m.maskOn, maskNode, shown: null };
    this.layers.splice(index, 0, L);
    this.docGroup.add(group);
    this.layers.forEach((l, i) => l.group.zIndex(i));
    this.refreshCache(L);
    return L;
  }

  private setCanvas(L: LiveLayer, c: HTMLCanvasElement, mask: HTMLCanvasElement | null = L.mask) {
    L.canvas = c;
    L.mask = mask && mask.width === c.width && mask.height === c.height ? mask : null;
    L.img.size({ width: c.width, height: c.height });
    this.refreshCache(L);
  }

  /** The layer's raster with its mask applied (kept until either changes). */
  private shownOf(L: LiveLayer): HTMLCanvasElement {
    const m = L.mask!;
    if (L.shown?.canvas === L.canvas && L.shown.mask === m) return L.shown.out;
    const out = raster.clone(L.canvas);
    L.shown = { canvas: L.canvas, mask: m, out };
    this.reshow(L, 0, 0, out.width, out.height);
    return out;
  }

  /** Recompose part of `shown` after the raster or the mask changed there in place (strokes). */
  private reshow(L: LiveLayer, x: number, y: number, w: number, h: number) {
    if (!L.shown || !L.mask) return;
    const g = L.shown.out.getContext('2d')!;
    // destination-in clears everything outside what is drawn, so keep it to the rectangle.
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.clearRect(x, y, w, h);
    g.drawImage(L.canvas, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(L.mask, 0, 0);
    g.restore();
  }

  layerInfo(): LayerInfo[] {
    return this.layers.map((L) => ({ id: L.id, name: L.name, visible: L.group.visible(), opacity: L.group.opacity(), blend: (L.group.globalCompositeOperation() || 'source-over') as Blend, objects: L.objs.getChildren().length, mask: !!L.mask, maskOn: L.maskOn }));
  }

  /** A layer's mask (null if it has none). */
  layerMask(id: string): HTMLCanvasElement | null {
    return this.layers.find((l) => l.id === id)?.mask ?? null;
  }

  /** The layer's raster canvas. */
  layerCanvas(id: string): HTMLCanvasElement | null {
    return this.layers.find((l) => l.id === id)?.canvas ?? null;
  }

  /** Raster plus markup of a layer, for thumbnails. */
  layerPreview(id: string): HTMLCanvasElement | null {
    const L = this.layers.find((l) => l.id === id);
    if (!L) return null;
    const c = L.objs.getChildren().length ? this.renderLayerContentAt(L) : L.canvas;
    return L.mask && L.maskOn ? applyMask(c, L.mask) : c;
  }

  setActive(id: string) {
    if (!this.layers.some((l) => l.id === id)) return;
    if (this.floating && id !== this.floating.id) this.finishTransform(true);
    if (id !== this.activeId) this.editMask = false;
    this.activeId = id;
    this.updateDraggable();
    this.select(null);
    this.emit();
  }

  addLayer(name?: string, canvas?: HTMLCanvasElement, at?: { x: number; y: number }): string {
    const c = canvas ?? raster.makeCanvas(this.docW, this.docH);
    const idx = this.layers.indexOf(this.active) + 1;
    const L = this.addLiveLayer({ ...plainLayer(name ?? t('Layer {n}', { n: this.layers.length + 1 }), c), x: at?.x ?? 0, y: at?.y ?? 0 }, idx);
    this.activeId = L.id;
    this.updateDraggable();
    if (this.tool === 'move') this.tr.nodes([L.group]);
    this.commit();
    return L.id;
  }

  duplicateLayer(id = this.activeId) {
    const L = this.layers.find((l) => l.id === id);
    if (!L) return;
    const m = this.modelOf(L);
    const idx = this.layers.indexOf(L) + 1;
    const N = this.addLiveLayer({ ...m, id: newId(), name: t('{name} copy', { name: L.name }) }, idx);
    this.activeId = N.id;
    this.commit();
  }

  deleteLayer(id = this.activeId) {
    if (this.layers.length < 2) return;
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [L] = this.layers.splice(i, 1);
    L.group.destroy();
    this.activeId = this.layers[Math.max(0, i - 1)].id;
    this.select(null);
    this.commit();
  }

  moveLayer(id: string, dir: 1 | -1) {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return;
    [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
    this.layers.forEach((l, k) => l.group.zIndex(k));
    this.commit();
  }

  /** Put a layer at a position in the stack (0 = bottom), e.g. after dragging it in the layer list. */
  placeLayer(id: string, index: number) {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = Math.max(0, Math.min(this.layers.length - 1, index));
    if (i < 0 || i === j) return;
    const [L] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, L);
    this.layers.forEach((l, k) => l.group.zIndex(k));
    this.activeId = id;
    this.commit();
  }

  setLayerProps(id: string, p: Partial<{ name: string; visible: boolean; opacity: number; blend: Blend }>, commit = true) {
    const L = this.layers.find((l) => l.id === id);
    if (!L) return;
    if (p.name !== undefined) L.name = p.name;
    if (p.visible !== undefined) L.group.visible(p.visible);
    if (p.opacity !== undefined) L.group.opacity(Math.max(0, Math.min(1, p.opacity)));
    if (p.blend !== undefined) L.group.globalCompositeOperation(p.blend);
    this.refreshCache(L);
    this.klayer.batchDraw();
    if (commit) this.commit();
    else this.emit();
  }

  /** Merge a layer into the one below it. */
  mergeDown(id = this.activeId) {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i <= 0) return;
    const top = this.layers[i];
    const below = this.layers[i - 1];
    const merged = this.renderLayers([below, top], true);
    this.layers.splice(i, 1);
    top.group.destroy();
    this.resetLayer(below, merged, null); // both masks are in the merged pixels
    below.group.opacity(1);
    below.group.globalCompositeOperation('source-over');
    this.activeId = below.id;
    this.commit();
  }

  /** Merge every visible layer into one. */
  flatten() {
    if (this.layers.length < 2) return;
    const flat = this.composite();
    for (const L of this.layers) L.group.destroy();
    this.layers = [];
    const L = this.addLiveLayer(plainLayer(t('Background'), flat));
    this.activeId = L.id;
    this.editMask = false;
    this.commit();
  }

  /**
   * Show the raster (masked if the layer has a mask). Group opacity applies
   * per child in Konva, and a mask must cover markup too: groups with markup
   * that are translucent or masked are cached, so either applies once.
   */
  private refreshCache(L: LiveLayer) {
    L.group.clearCache();
    const masked = !!L.mask && L.maskOn;
    const markup = L.objs.getChildren().length > 0;
    const viaCache = masked && markup;
    L.maskNode.visible(viaCache);
    if (viaCache) L.maskNode.setAttrs({ image: L.mask!, width: L.mask!.width, height: L.mask!.height });
    L.img.image(masked && !viaCache ? this.shownOf(L) : L.canvas);
    if (L.group.visible() && markup && (viaCache || L.group.opacity() < 1)) L.group.cache();
  }

  // ---- masks ----

  /** Give the active layer a mask: everything shown, everything hidden, or the selection shown. */
  addMask(from: 'show' | 'hide' | 'selection' = 'show') {
    const L = this.active;
    if (L.mask) return;
    if (from === 'selection' && !this.selection) from = 'show';
    // The mask lives in the layer's own pixels; a selection is in document pixels.
    if (from === 'selection') this.bake(L);
    const m = raster.makeCanvas(L.canvas.width, L.canvas.height);
    const g = m.getContext('2d')!;
    if (from === 'selection') g.drawImage(this.selection!.mask, 0, 0);
    else if (from === 'show') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, m.width, m.height);
    }
    L.maskOn = true;
    this.setCanvas(L, L.canvas, m);
    this.editMask = true;
    this.commit();
  }

  /** Show or hide the selection (or, without one, everything) on the active layer's mask. */
  fillMask(show: boolean) {
    const L = this.active;
    if (!L.mask) return;
    if (this.selection) this.bake(L);
    const m = raster.clone(L.mask!);
    const g = m.getContext('2d')!;
    g.globalCompositeOperation = show ? 'source-over' : 'destination-out';
    if (this.selection) g.drawImage(this.selection.mask, 0, 0);
    else {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, m.width, m.height);
    }
    this.setCanvas(L, L.canvas, m);
    this.commit();
  }

  invertMask() {
    const L = this.active;
    if (!L.mask) return;
    const m = raster.makeCanvas(L.mask.width, L.mask.height);
    const g = m.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, m.width, m.height);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(L.mask, 0, 0);
    this.setCanvas(L, L.canvas, m);
    this.commit();
  }

  /** Turn the mask off and on without losing it. */
  toggleMask(on = !this.active.maskOn) {
    const L = this.active;
    if (!L.mask) return;
    L.maskOn = on;
    this.refreshCache(L);
    this.commit();
  }

  /** Make the mask permanent: hidden pixels are erased and the mask goes. */
  applyMask() {
    const L = this.active;
    if (!L.mask) return;
    this.bake(L);
    const out = L.maskOn ? applyMask(L.canvas, L.mask!) : L.canvas;
    this.editMask = false;
    this.setCanvas(L, out, null);
    this.commit();
  }

  deleteMask() {
    const L = this.active;
    if (!L.mask) return;
    this.editMask = false;
    this.setCanvas(L, L.canvas, null);
    this.commit();
  }

  /** On a mask, the brush hides (true) or shows. */
  setMaskHide(hide: boolean) {
    this.opts.maskHide = hide;
    this.emit();
  }

  /** Brush and eraser work on the mask (true) or the pixels. */
  setEditMask(on: boolean) {
    this.editMask = on && !!this.active.mask;
    this.emit();
  }

  // ---- rendering ----

  /** Run fn with the world at identity and overlays hidden (for exact 1:1 rendering). */
  private atIdentity<T>(fn: () => T): T {
    const saved = { ...this.view };
    const trNodes = this.tr.nodes();
    const regionVisible = this.region.visible();
    const previewVisible = this.regionPreview.visible();
    this.regionPreview.visible(false);
    const sel0 = this.selection;
    const selNodes = this.selTr.nodes();
    this.tr.nodes([]);
    this.region.visible(false);
    this.regionTr.nodes([]);
    this.selTr.nodes([]);
    this.selection = null;
    this.world.position({ x: 0, y: 0 });
    this.world.scale({ x: 1, y: 1 });
    this.world.rotation(0);
    try {
      return fn();
    } finally {
      this.world.position({ x: saved.x, y: saved.y });
      this.world.scale({ x: saved.zoom, y: saved.zoom });
      this.world.rotation(this.viewRotation);
      this.selection = sel0;
      this.tr.nodes(trNodes);
      this.selTr.nodes(selNodes);
      this.regionPreview.visible(previewVisible);
      if (regionVisible) {
        this.region.visible(true);
        this.regionTr.nodes([this.region]);
      }
      this.klayer.batchDraw();
    }
  }

  /** A layer (transform + markup, full opacity) as a document-sized canvas. */
  private layerDocCanvas(L: LiveLayer): HTMLCanvasElement {
    if (this.isBaked(L)) return L.canvas;
    return this.renderLayers([L], false);
  }

  private isBaked(L: LiveLayer): boolean {
    const g = L.group;
    return !L.objs.getChildren().length && g.x() === 0 && g.y() === 0 && g.rotation() === 0 && g.scaleX() === 1 && g.scaleY() === 1 && L.canvas.width === this.docW && L.canvas.height === this.docH;
  }

  /** Render layers into a document-sized canvas. withProps keeps opacity/blend (merging); otherwise each is drawn opaque and normal. */
  private renderLayers(list: LiveLayer[], withProps: boolean): HTMLCanvasElement {
    return this.atIdentity(() => {
      const out = raster.makeCanvas(this.docW, this.docH);
      const g = out.getContext('2d')!;
      for (const L of list) {
        const props = { o: L.group.opacity(), b: L.group.globalCompositeOperation(), v: L.group.visible() };
        if (!withProps) {
          L.group.opacity(1);
          L.group.globalCompositeOperation('source-over');
        }
        L.group.visible(true);
        L.group.clearCache();
        const c = L.group.toCanvas({ x: 0, y: 0, width: this.docW, height: this.docH, pixelRatio: 1 }) as HTMLCanvasElement;
        L.group.opacity(props.o);
        L.group.globalCompositeOperation(props.b);
        L.group.visible(props.v);
        this.refreshCache(L);
        if (withProps && !props.v) continue;
        g.globalCompositeOperation = withProps ? (props.b as GlobalCompositeOperation) || 'source-over' : 'source-over';
        g.drawImage(c, 0, 0);
      }
      return out;
    });
  }

  /** Visible layers flattened at 1:1. */
  composite(): HTMLCanvasElement {
    // One plain layer is its own composite (not with a mask on: that has to be applied).
    const L0 = this.layers[0];
    if (this.layers.length === 1 && this.isBaked(L0) && L0.group.opacity() === 1 && L0.group.visible() && !(L0.mask && L0.maskOn)) return L0.canvas;
    return this.atIdentity(() => this.docGroup.toCanvas({ x: 0, y: 0, width: this.docW, height: this.docH, pixelRatio: 1 }) as HTMLCanvasElement);
  }

  /** Bake a layer's transform and markup into a document-sized raster. */
  private bake(L: LiveLayer) {
    if (this.isBaked(L)) return;
    let mask: HTMLCanvasElement | null = null;
    if (L.mask) {
      // The mask goes through the same transform, as a picture of its own.
      L.maskNode.visible(false);
      L.objs.visible(false);
      L.img.image(L.mask);
      L.img.size({ width: L.mask.width, height: L.mask.height });
      mask = this.renderLayers([L], false);
      L.objs.visible(true);
    }
    L.maskNode.visible(false);
    L.img.image(L.canvas);
    const c = this.renderLayers([L], false);
    this.resetLayer(L, c, mask);
  }

  private resetLayer(L: LiveLayer, c: HTMLCanvasElement, mask: HTMLCanvasElement | null = L.mask) {
    L.objs.destroyChildren();
    L.group.setAttrs({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    this.setCanvas(L, c, mask);
    if (this.tr.nodes().some((n) => n === L.group || n.getParent() === L.objs)) this.tr.nodes(this.tool === 'move' ? [L.group] : []);
    this.refreshCache(L);
  }

  /** Apply a pixel operation to the active layer (restricted to the selection, if any). */
  pixelOp(op: (c: HTMLCanvasElement) => HTMLCanvasElement, opts: { ignoreSelection?: boolean } = {}) {
    const L = this.active;
    this.bake(L);
    const before = L.canvas;
    let next = op(before);
    if (this.selection && !opts.ignoreSelection) next = sel.blendThroughMask(before, next, this.selection.mask);
    this.setCanvas(L, next);
    this.commit();
  }

  /** Apply an operation to every layer (whole-document transforms). */
  private documentOp(op: (c: HTMLCanvasElement) => HTMLCanvasElement) {
    for (const L of this.layers) {
      this.bake(L);
      this.setCanvas(L, op(L.canvas), L.mask && op(L.mask));
    }
    const c = this.layers[0].canvas;
    this.docW = c.width;
    this.docH = c.height;
    this.selection = null;
    this.commit();
    this.fit();
  }

  crop(r: Rect) {
    for (const L of this.layers) L.group.setAttrs({ x: L.group.x() - r.x, y: L.group.y() - r.y });
    this.docW = r.width;
    this.docH = r.height;
    this.selection = null;
    for (const L of this.layers) this.bake(L);
    this.commit();
    this.fit();
  }

  cropToSelection() {
    if (this.selection) this.crop(this.selection.bounds);
  }

  rotate(clockwise: boolean) {
    this.documentOp((c) => raster.rotate(c, clockwise));
  }

  flip(horizontal: boolean) {
    this.documentOp((c) => raster.flip(c, horizontal));
  }

  resizeTo(w: number, h: number) {
    this.documentOp((c) => raster.resize(c, w, h));
  }

  /**
   * Canvas size: the picture stays as it is, the canvas grows (or shrinks,
   * cutting) to w × h around it. The anchor (0..1 each way) says where the
   * old picture sits: 0, 0 top left, 0.5, 0.5 the middle. New space is
   * transparent, or filled with a colour in the bottom layer.
   */
  canvasSize(w: number, h: number, anchor: { x: number; y: number } = { x: 0.5, y: 0.5 }, fill: string | null = null) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.docW && h === this.docH) return;
    const ox = Math.round((w - this.docW) * anchor.x);
    const oy = Math.round((h - this.docH) * anchor.y);
    const old = { x: ox, y: oy, width: this.docW, height: this.docH };
    for (const L of this.layers) L.group.setAttrs({ x: L.group.x() + ox, y: L.group.y() + oy });
    this.docW = w;
    this.docH = h;
    this.selection = null;
    for (const L of this.layers) this.bake(L);
    const bottom = this.layers[0];
    if (fill && bottom && (w > old.width || h > old.height)) {
      const g = bottom.canvas.getContext('2d')!;
      g.save();
      g.fillStyle = fill;
      g.beginPath();
      g.rect(0, 0, w, h);
      g.rect(old.x, old.y, old.width, old.height);
      g.fill('evenodd');
      g.restore();
      if (bottom.mask) {
        // The new space shows in the bottom layer even where it has a mask.
        const m = bottom.mask.getContext('2d')!;
        m.save();
        m.fillStyle = '#fff';
        m.beginPath();
        m.rect(0, 0, w, h);
        m.rect(old.x, old.y, old.width, old.height);
        m.fill('evenodd');
        m.restore();
      }
      this.refreshCache(bottom);
    }
    this.commit();
    this.fit();
  }

  /** Rotate the whole image by any angle; expand grows the canvas so nothing is cut off. */
  rotateBy(degrees: number, expand = true) {
    if (!degrees) return;
    this.previewRotation(0);
    this.documentOp((c) => raster.rotateAny(c, degrees, expand));
  }

  /** Visual-only rotation while the user drags the angle slider. */
  previewRotation(degrees: number) {
    this.docGroup.setAttrs({ rotation: degrees, offsetX: this.docW / 2, offsetY: this.docH / 2, x: this.docW / 2, y: this.docH / 2 });
    if (!degrees) this.docGroup.setAttrs({ rotation: 0, offsetX: 0, offsetY: 0, x: 0, y: 0 });
    this.klayer.batchDraw();
  }

  // ---- selection operations ----

  /** Selected pixels (active layer, or all visible layers when merged), cropped to the selection; whole layer without a selection. */
  copySelection(merged = false): { canvas: HTMLCanvasElement; x: number; y: number } {
    const src = merged ? this.composite() : this.layerDocCanvas(this.active);
    if (!this.selection) return { canvas: raster.clone(src), x: 0, y: 0 };
    return { canvas: sel.extract(src, this.selection), x: this.selection.bounds.x, y: this.selection.bounds.y };
  }

  clearSelectionPixels() {
    if (!this.selection) return;
    const s = this.selection;
    this.pixelOp((c) => sel.clearInside(c, s), { ignoreSelection: true });
  }

  fillSelection(color = this.opts.color) {
    const s = this.selection ?? sel.selectAll(this.docW, this.docH);
    this.pixelOp((c) => sel.fillInside(c, s, color), { ignoreSelection: true });
  }

  /** Paint bucket: fill the mask's pixels of the active layer with a colour (inside the selection, if any). */
  bucketFill(mask: HTMLCanvasElement, color = this.opts.color) {
    this.pixelOp((c) => {
      const fill = raster.makeCanvas(c.width, c.height);
      const g = fill.getContext('2d')!;
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      return sel.blendThroughMask(c, fill, mask);
    });
  }

  blurSelection() {
    const s = this.selection;
    if (!s) return;
    this.pixelOp((c) => raster.blurRegion(c, s.bounds));
  }

  pixelateSelection() {
    const s = this.selection;
    if (!s) return;
    this.pixelOp((c) => raster.pixelateRegion(c, s.bounds));
  }

  /** Turn a layer by deg (clockwise) about its middle; the pixels stay as they are until baked. */
  rotateLayer(deg: number, id = this.activeId) {
    const L = this.layers.find((l) => l.id === id);
    if (!L || !deg) return;
    this.turnAboutMiddle(L.group, deg);
    if (this.tool === 'move' && L.id === this.activeId) this.tr.nodes([L.group]);
    this.commit();
    this.klayer.batchDraw();
    this.emit();
  }

  /** Turn a layer's group about the middle of what it shows (it stays where it is). */
  private turnAboutMiddle(g: Konva.Group, deg: number) {
    const box = g.getClientRect({ relativeTo: this.docGroup, skipShadow: true, skipStroke: true });
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const local = g.getTransform().copy().invert().point(mid);
    g.rotation(g.rotation() + deg);
    const now = g.getTransform().point(local);
    g.position({ x: g.x() + mid.x - now.x, y: g.y() + mid.y - now.y });
  }

  private layerTurn: { id: string; rotation: number; x: number; y: number } | null = null;

  /** Show the active layer turned by deg from where it was when the preview started (the "by angle" slider). */
  previewLayerRotation(deg: number) {
    const L = this.active;
    const g = L.group;
    if (!this.layerTurn || this.layerTurn.id !== L.id) this.layerTurn = { id: L.id, rotation: g.rotation(), x: g.x(), y: g.y() };
    g.setAttrs({ rotation: this.layerTurn.rotation, x: this.layerTurn.x, y: this.layerTurn.y });
    if (deg) this.turnAboutMiddle(g, deg);
    this.klayer.batchDraw();
  }

  /** Keep the previewed turn (one undo step) or put the layer back. */
  endLayerRotation(apply: boolean) {
    const s = this.layerTurn;
    if (!s) return;
    this.layerTurn = null;
    const L = this.layers.find((l) => l.id === s.id);
    if (!L) return;
    if (!apply) {
      L.group.setAttrs({ rotation: s.rotation, x: s.x, y: s.y });
      this.klayer.batchDraw();
      return;
    }
    if (this.tool === 'move') this.tr.nodes([L.group]);
    this.commit();
    this.emit();
  }

  // ---- transforming a selection ----

  /** The selected pixels lifted onto a layer of their own above the one they came from, until applied. */
  private floating: { id: string; from: string; at: number } | null = null;

  /**
   * Move, scale or rotate the selection (Ctrl+T): its pixels are cut onto a
   * floating layer with the move tool's handles; Enter puts them back into
   * the layer they came from, Esc puts everything back as it was.
   */
  transformSelection() {
    if (this.floating || !this.selection) return;
    const from = this.activeId;
    const at = this.index;
    this.layerFromSelection(true);
    const id = this.activeId;
    this.deselect();
    this.setTool('move');
    this.floating = { id, from, at };
    this.emit();
  }

  /** Put the lifted pixels back (apply) or undo the lift (cancel); one undo step either way. */
  finishTransform(apply = true) {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    const F = this.layers.find((l) => l.id === f.id);
    const into = this.layers.find((l) => l.id === f.from);
    if (!F || !into || !apply) {
      if (!apply) {
        this.history = this.history.slice(0, f.at + 1);
        this.index = f.at;
        this.restore(this.history[f.at]);
      } else this.emit();
      return;
    }
    const pic = this.renderLayers([F], true);
    this.tr.nodes([]);
    this.layers.splice(this.layers.indexOf(F), 1);
    F.group.destroy();
    this.activeId = into.id;
    this.bake(into);
    const c = raster.clone(into.canvas);
    c.getContext('2d')!.drawImage(pic, 0, 0);
    this.setCanvas(into, c);
    // The lift, the moves and this: one step to undo.
    this.history = this.history.slice(0, f.at + 1);
    this.index = f.at;
    this.commit();
    if (this.tool === 'move') this.tr.nodes([this.active.group]);
    this.klayer.batchDraw();
    this.emit();
  }

  /** Copy the selection into a new layer above (Ctrl+J). */
  layerFromSelection(cut = false) {
    const { canvas, x, y } = this.copySelection();
    if (cut) this.clearSelectionPixels();
    this.addLayer(`${this.active.name} (part)`, canvas, { x, y });
  }

  /** Paste an image as a new layer, at (x, y) or centred in the view. */
  /** A window point in document pixels. */
  docPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.stage.container().getBoundingClientRect();
    return this.docGroup.getAbsoluteTransform().copy().invert().point({ x: clientX - r.left, y: clientY - r.top });
  }

  pasteImage(c: HTMLCanvasElement, at?: { x: number; y: number }, name = t('Pasted')) {
    const p = at ?? { x: Math.round((this.docW - c.width) / 2), y: Math.round((this.docH - c.height) / 2) };
    this.addLayer(name, c, p);
    this.deselect();
    if (this.tool !== 'move') this.setTool('move');
  }

  /** Paint a patch (object removal: a fill with a soft edge) over the active layer at (x, y), as one undo step. */
  paintPatch(patch: CanvasImageSource, x: number, y: number) {
    this.pixelOp(
      (c) => {
        const out = raster.clone(c);
        out.getContext('2d')!.drawImage(patch, x, y);
        return out;
      },
      { ignoreSelection: true },
    );
  }

  /** Replace the active layer's pixels with a picture of the same size (inside the selection, if any), as one undo step. */
  replacePixels(img: CanvasImageSource) {
    this.pixelOp((c) => {
      const out = raster.makeCanvas(c.width, c.height);
      out.getContext('2d')!.drawImage(img, 0, 0);
      return out;
    });
  }

  /** Keep only the masked part of the active layer (background removal). */
  applyMaskToLayer(mask: HTMLCanvasElement) {
    this.pixelOp(
      (c) => {
        const out = raster.clone(c);
        const g = out.getContext('2d')!;
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(mask, 0, 0, c.width, c.height);
        return out;
      },
      { ignoreSelection: true },
    );
  }

  // ---- brush / eraser ----

  private beginStroke(p: { x: number; y: number }) {
    const L = this.active;
    this.bake(L);
    const onMask = this.editMask && !!L.mask;
    const before = onMask ? L.mask! : L.canvas;
    const canvas = raster.clone(before);
    // On a mask, painting shows and erasing hides — unless the brush is set to hide.
    const eraser = (this.tool === 'eraser') !== (onMask && this.opts.maskHide);
    // Inside a selection the stroke is drawn on its own canvas and shown only
    // through the selection mask, so painting never leaks outside it.
    const clone = this.tool === 'clone';
    const paint = this.selection || clone ? raster.makeCanvas(before.width, before.height) : null;
    if (clone && !this.cloneOffset) this.cloneOffset = { dx: this.cloneSrc!.x - p.x, dy: this.cloneSrc!.y - p.y };
    const g = (paint ?? canvas).getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = this.brushSize();
    g.strokeStyle = onMask ? '#fff' : this.opts.color;
    g.fillStyle = g.strokeStyle;
    g.globalAlpha = eraser && !onMask ? 1 : clone ? 1 : this.opts.brushOpacity;
    g.globalCompositeOperation = eraser && !paint ? 'destination-out' : 'source-over';
    if (clone) stamp(g, p, p, g.lineWidth);
    else {
      g.beginPath();
      g.arc(p.x, p.y, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
    }
    this.stroke = { canvas, g, last: p, before, paint, erase: eraser && !clone, onMask, clone };
    this.showStroke(p, p);
    if (onMask) this.setCanvas(L, L.canvas, canvas);
    else this.setCanvas(L, canvas);
    this.klayer.batchDraw();
  }

  private strokeTo(p: { x: number; y: number }) {
    const s = this.stroke!;
    if (s.clone) {
      stamp(s.g, s.last, p, s.g.lineWidth);
      const o = this.cloneOffset!;
      this.cloneMark.position({ x: p.x + o.dx, y: p.y + o.dy });
    } else {
      s.g.beginPath();
      s.g.moveTo(s.last.x, s.last.y);
      s.g.lineTo(p.x, p.y);
      s.g.stroke();
    }
    this.showStroke(s.last, p);
    const L = this.active;
    if (L.mask && L.maskOn) {
      // The canvas changed in place: recompose just this segment of the masked view.
      const pad = Math.ceil(s.g.lineWidth / 2) + 2;
      const x = Math.max(0, Math.floor(Math.min(s.last.x, p.x) - pad));
      const y = Math.max(0, Math.floor(Math.min(s.last.y, p.y) - pad));
      this.reshow(L, x, y, Math.min(L.canvas.width, Math.ceil(Math.max(s.last.x, p.x) + pad)) - x, Math.min(L.canvas.height, Math.ceil(Math.max(s.last.y, p.y) + pad)) - y);
    }
    s.last = p;
    this.klayer.batchDraw();
  }

  /** Recompose the area a segment touched: before + stroke ∩ selection (only with a selection). */
  private showStroke(a: { x: number; y: number }, b: { x: number; y: number }) {
    const s = this.stroke!;
    if (!s.paint || (!this.selection && !s.clone)) return;
    const pad = Math.ceil(s.g.lineWidth / 2) + 2;
    const x = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad));
    const y = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
    const w = Math.min(s.canvas.width, Math.ceil(Math.max(a.x, b.x) + pad)) - x;
    const h = Math.min(s.canvas.height, Math.ceil(Math.max(a.y, b.y) + pad)) - y;
    if (w <= 0 || h <= 0) return;
    const t = raster.makeCanvas(w, h);
    const tg = t.getContext('2d')!;
    if (s.clone) {
      // The layer as it was, shifted from the source, through the brush's soft mask.
      const o = this.cloneOffset!;
      tg.drawImage(s.before, x + o.dx, y + o.dy, w, h, 0, 0, w, h);
      tg.globalCompositeOperation = 'destination-in';
    }
    tg.drawImage(s.paint, x, y, w, h, 0, 0, w, h);
    tg.globalCompositeOperation = 'destination-in';
    if (this.selection) tg.drawImage(this.selection.mask, x, y, w, h, 0, 0, w, h);
    const g = s.canvas.getContext('2d')!;
    g.clearRect(x, y, w, h);
    g.drawImage(s.before, x, y, w, h, x, y, w, h);
    g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    if (s.clone) g.globalAlpha = this.opts.brushOpacity;
    g.drawImage(t, x, y);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** Clone stamp: Alt-click chose where to copy from (the next stroke aligns to it). */
  setCloneSource(p: { x: number; y: number }) {
    this.cloneSrc = { ...p };
    this.cloneOffset = null;
    this.showCloneMark(p);
  }

  private askCloneSource() {
    this.notify(t('Alt-click where to copy from first.'));
  }

  private showCloneMark(p: { x: number; y: number } | null) {
    const on = this.tool === 'clone' && !!p;
    this.cloneMark.visible(on);
    if (on) {
      const r = this.brushSize() / 2;
      this.cloneMark.position(p!);
      this.cloneMark.find('.ring').forEach((n) => n.setAttrs({ radiusX: r, radiusY: r }));
    }
    this.klayer.batchDraw();
  }

  // ---- gradient ----

  /** Draw a gradient from a to b into a w×h canvas (the colours from the tool options; on a mask, shown → hidden: opaque → clear). */
  private gradientCanvas(w: number, h: number, a: { x: number; y: number }, b: { x: number; y: number }, onMask: boolean): HTMLCanvasElement {
    const c = raster.makeCanvas(w, h);
    const g = c.getContext('2d')!;
    const o = this.opts;
    const rgb = (hex: string) => {
      const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [r0, g0, b0] = rgb(onMask ? '#ffffff' : o.color);
    let start = `rgba(${r0},${g0},${b0},1)`;
    let end = onMask ? 'rgba(255,255,255,0)' : o.gradEnd === 'white' ? 'rgba(255,255,255,1)' : o.gradEnd === 'black' ? 'rgba(0,0,0,1)' : `rgba(${r0},${g0},${b0},0)`;
    if (o.gradReverse) [start, end] = [end, start];
    const grad = o.gradType === 'radial' ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) : g.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, start);
    grad.addColorStop(1, end);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    if (this.selection) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.selection.mask, 0, 0);
    }
    return c;
  }

  /** The layer (or mask) as it would be with the gradient dragged so far. */
  private gradientResult(): HTMLCanvasElement {
    const gr = this.gradient!;
    const { before } = gr;
    const out = raster.clone(before);
    const g = out.getContext('2d')!;
    const grad = this.gradientCanvas(before.width, before.height, gr.from, gr.to, gr.onMask);
    if (gr.onMask) {
      // A mask is its alpha: the gradient replaces it (inside the selection, if any).
      g.globalCompositeOperation = 'destination-out';
      if (this.selection) g.drawImage(this.selection.mask, 0, 0);
      else g.fillRect(0, 0, out.width, out.height);
      g.globalCompositeOperation = 'source-over';
    } else g.globalAlpha = this.opts.brushOpacity;
    g.drawImage(grad, 0, 0);
    return out;
  }

  private showGradient() {
    const gr = this.gradient;
    if (!gr) return;
    const L = this.active;
    if (gr.onMask) this.setCanvas(L, L.canvas, this.gradientResult());
    else this.setCanvas(L, this.gradientResult());
    this.klayer.batchDraw();
  }

  private endGradient() {
    const gr = this.gradient!;
    cancelAnimationFrame(gr.raf);
    this.gradLine.points([]);
    const L = this.active;
    if (Math.hypot(gr.to.x - gr.from.x, gr.to.y - gr.from.y) < 2) {
      // A click, not a drag: nothing.
      if (gr.onMask) this.setCanvas(L, L.canvas, gr.before);
      else this.setCanvas(L, gr.before);
      this.gradient = null;
      this.klayer.batchDraw();
      return;
    }
    this.showGradient();
    this.gradient = null;
    this.commit();
  }

  /** A gradient programmatically (tests): from a to b with the current options. */
  drawGradient(a: { x: number; y: number }, b: { x: number; y: number }) {
    const L = this.active;
    this.bake(L);
    const onMask = this.editMask && !!L.mask;
    this.gradient = { before: onMask ? L.mask! : L.canvas, onMask, from: a, to: b, raf: 0 };
    this.endGradient();
  }

  /** Spot healing: the painted stroke is replaced from nearby (one undo step). */
  async healStroke(pts: number[]) {
    const L = this.active;
    this.bake(L);
    const size = this.brushSize();
    const W = L.canvas.width;
    const H = L.canvas.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]);
      y1 = Math.max(y1, pts[i + 1]);
    }
    // The crop: the stroke and far enough around it to find a patch (heal.ts looks 2.5 sizes away).
    const span = Math.max(x1 - x0, y1 - y0) + size;
    const m = Math.ceil(span * 2.5 + size + 8);
    const cx = Math.max(0, Math.floor(x0 - m)), cy = Math.max(0, Math.floor(y0 - m));
    const cw = Math.min(W, Math.ceil(x1 + m)) - cx, ch = Math.min(H, Math.ceil(y1 + m)) - cy;
    if (cw <= 0 || ch <= 0) return this.clearHealLine();
    const crop = raster.makeCanvas(cw, ch);
    crop.getContext('2d')!.drawImage(L.canvas, -cx, -cy);
    const mask = raster.makeCanvas(cw, ch);
    const g = mask.getContext('2d')!;
    g.translate(-cx, -cy);
    g.strokeStyle = g.fillStyle = '#fff';
    g.lineWidth = size;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
    g.beginPath();
    g.arc(pts[0], pts[1], size / 2, 0, Math.PI * 2);
    g.fill();
    if (this.selection) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.selection.mask, -cx, -cy);
    }
    try {
      const healed = await this.onHeal(crop, mask);
      if (!healed || L !== this.active) return;
      this.pixelOp((c) => {
        const out = raster.clone(c);
        out.getContext('2d')!.drawImage(healed, cx, cy);
        return out;
      });
    } finally {
      this.clearHealLine();
    }
  }

  private clearHealLine() {
    this.selPaintLine.setAttrs({ points: [], stroke: 'rgba(255, 70, 70, 0.45)' });
    this.klayer.batchDraw();
  }

  private endStroke() {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.commit();
  }

  /** Paint a stroke programmatically (tests). */
  paint(points: { x: number; y: number }[], eraser = false) {
    const prev = this.tool;
    this.tool = eraser ? 'eraser' : 'brush';
    this.beginStroke(points[0]);
    for (const p of points.slice(1)) this.strokeTo(p);
    this.endStroke();
    this.tool = prev;
  }

  // ---- markup objects ----

  private decorate(n: KNode) {
    n.draggable(this.tool === 'hand');
    n.on('dragend transformend', () => this.commit());
    if (n instanceof KText) {
      n.on('dblclick dbltap', async () => {
        const t = await this.askText(n.text());
        if (t !== null && t !== n.text()) {
          if (t === '') n.destroy();
          else n.text(t);
          this.commit();
        }
      });
    }
  }

  async addText(p: { x: number; y: number }, text?: string): Promise<KText | null> {
    const t = text ?? (await this.askText(''));
    if (!t) return null;
    const o = this.opts;
    const size = o.fontSize || Math.max(16, Math.round(Math.max(this.docW, this.docH) / 32));
    const node = new KText({
      x: p.x,
      y: p.y,
      text: t,
      fontSize: size,
      fontFamily: cssFamily(o.fontFamily),
      fontStyle: [o.bold ? 'bold' : '', o.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
      fill: o.color,
      stroke: o.outline ? (o.color === '#ffffff' ? '#000000' : '#ffffff') : undefined,
      strokeWidth: o.outline ? Math.max(1, size / 16) : 0,
      fillAfterStrokeEnabled: true,
      shadowColor: 'rgba(0,0,0,0.4)',
      shadowBlur: o.shadow ? size / 8 : 0,
      shadowEnabled: o.shadow,
      name: 'text',
    });
    node.setAttr('mfFamily', o.fontFamily);
    this.active.objs.add(node);
    this.decorate(node);
    this.commit();
    return node;
  }

  addArrow(x1: number, y1: number, x2: number, y2: number) {
    const sw = this.autoStroke();
    const c = this.opts.color;
    const a = new Arrow({ points: [x1, y1, x2, y2], stroke: c, fill: c, strokeWidth: sw, pointerLength: sw * 4, pointerWidth: sw * 4, lineCap: 'round' });
    this.active.objs.add(a);
    this.decorate(a);
    this.commit();
  }

  private select(n: KNode | null) {
    this.tr.nodes(n ? [n] : this.tool === 'move' && this.layers.length ? [this.active.group] : []);
    this.klayer.batchDraw();
    this.emit();
  }

  private selectedObject(): KNode | null {
    const n = this.tr.nodes()[0];
    return n && n.getParent()?.name() === 'objects' ? n : null;
  }

  objectProps(): ObjectProps | null {
    const n = this.selectedObject();
    if (!n) return null;
    if (n instanceof KText) {
      const style = n.fontStyle();
      return {
        kind: 'text',
        text: n.text(),
        fontFamily: (n.getAttr('mfFamily') as string) ?? n.fontFamily(),
        fontSize: Math.round(n.fontSize()),
        bold: style.includes('bold'),
        italic: style.includes('italic'),
        align: n.align(),
        color: n.fill() as string,
        outline: n.strokeWidth() > 0,
        shadow: n.shadowEnabled() && n.shadowBlur() > 0,
      };
    }
    if (n instanceof Arrow) return { kind: 'arrow', color: n.stroke() as string, strokeWidth: n.strokeWidth() };
    if (n instanceof KRect) return { kind: 'rect', color: n.stroke() as string, strokeWidth: n.strokeWidth(), filled: !!n.fill(), cornerRadius: n.cornerRadius() as number };
    if (n instanceof KEllipse) return { kind: 'oval', color: n.stroke() as string, strokeWidth: n.strokeWidth(), filled: !!n.fill() };
    return null;
  }

  /** Change the selected object's properties. */
  updateObject(p: Partial<ObjectProps>) {
    const n = this.selectedObject();
    if (!n) return;
    if (n instanceof KText) {
      if (p.text !== undefined) n.text(p.text);
      if (p.fontFamily !== undefined) {
        n.fontFamily(cssFamily(p.fontFamily));
        n.setAttr('mfFamily', p.fontFamily);
      }
      if (p.fontSize !== undefined && p.fontSize > 0) n.fontSize(p.fontSize);
      if (p.bold !== undefined || p.italic !== undefined) {
        const cur = this.objectProps()!;
        const b = p.bold ?? cur.bold;
        const i = p.italic ?? cur.italic;
        n.fontStyle([b ? 'bold' : '', i ? 'italic' : ''].filter(Boolean).join(' ') || 'normal');
      }
      if (p.align !== undefined) n.align(p.align);
      if (p.color !== undefined) n.fill(p.color);
      if (p.outline !== undefined || p.color !== undefined) {
        const on = p.outline ?? n.strokeWidth() > 0;
        const fill = n.fill() as string;
        n.stroke(on ? (fill === '#ffffff' ? '#000000' : '#ffffff') : undefined);
        n.strokeWidth(on ? Math.max(1, n.fontSize() / 16) : 0);
      }
      if (p.shadow !== undefined) {
        n.shadowEnabled(p.shadow);
        n.shadowBlur(p.shadow ? n.fontSize() / 8 : 0);
        n.shadowColor('rgba(0,0,0,0.4)');
      }
    } else if (n instanceof Arrow) {
      if (p.color) n.setAttrs({ stroke: p.color, fill: p.color });
      if (p.strokeWidth) n.setAttrs({ strokeWidth: p.strokeWidth, pointerLength: p.strokeWidth * 4, pointerWidth: p.strokeWidth * 4 });
    } else if (n instanceof KRect || n instanceof KEllipse) {
      if (p.color) {
        n.stroke(p.color);
        if (n.fill()) n.fill(p.color);
      }
      if (p.strokeWidth) n.strokeWidth(p.strokeWidth);
      if (p.filled !== undefined) n.fill(p.filled ? (n.stroke() as string) : '');
      if (p.cornerRadius !== undefined && n instanceof KRect) n.cornerRadius(Math.max(0, p.cornerRadius));
    }
    this.tr.forceUpdate();
    this.commit();
  }

  deleteSelection() {
    const nodes = this.tr.nodes().filter((n) => n.getParent()?.name() === 'objects');
    if (!nodes.length) return;
    nodes.forEach((n) => n.destroy());
    this.tr.nodes([]);
    this.commit();
  }

  setColor(c: string) {
    this.opts.color = c;
    if (this.selectedObject()) this.updateObject({ color: c });
  }

  // ---- adjustments ----

  startAdjust(): boolean {
    if (this.adjuster) return true;
    const L = this.active;
    this.bake(L);
    try {
      const a = new Adjuster(L.canvas, this.selection?.mask ?? null);
      this.adjuster = { a, layer: L };
      this.showAdjusted();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  previewAdjust(a: Adjustments) {
    if (!this.adjuster) return;
    this.adjuster.a.render(a);
    this.showAdjusted();
    this.klayer.batchDraw();
  }

  /** The adjuster's live result in place of the layer's raster (masked like it). */
  private showAdjusted() {
    const { a, layer: L } = this.adjuster!;
    L.img.image(L.mask && L.maskOn ? applyMask(a.canvas, L.mask) : a.canvas);
  }

  applyAdjust(a: Adjustments) {
    const ad = this.adjuster;
    if (!ad) return;
    ad.a.render(a);
    const out = ad.a.snapshot();
    ad.a.destroy();
    this.adjuster = null;
    this.setCanvas(ad.layer, out);
    this.commit();
  }

  cancelAdjust() {
    const ad = this.adjuster;
    if (!ad) return;
    ad.a.destroy();
    this.adjuster = null;
    this.refreshCache(ad.layer);
    this.klayer.batchDraw();
    this.emit();
  }

  // ---- history ----

  private modelOf(L: LiveLayer): LayerModel {
    const g = L.group;
    return {
      id: L.id,
      name: L.name,
      canvas: L.canvas,
      x: g.x(),
      y: g.y(),
      rotation: g.rotation(),
      scaleX: g.scaleX(),
      scaleY: g.scaleY(),
      opacity: g.opacity(),
      visible: g.visible(),
      blend: (g.globalCompositeOperation() || 'source-over') as Blend,
      objects: L.objs.getChildren().map((n) => n.toJSON()),
      mask: L.mask,
      maskOn: L.maskOn,
    };
  }

  private snapshot(): Snapshot {
    return { width: this.docW, height: this.docH, active: this.activeId, layers: this.layers.map((L) => this.modelOf(L)) };
  }

  private commit() {
    this.version++;
    for (const L of this.layers) this.refreshCache(L);
    this.updateDraggable(); // (the active layer may have changed: duplicated, deleted, merged…)
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(this.snapshot());
    this.index = this.history.length - 1;
    // Bound memory: count each distinct raster once, drop the oldest states.
    const seen = new Set<HTMLCanvasElement>();
    let pixels = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      for (const m of this.history[i].layers) {
        for (const c of [m.canvas, m.mask]) {
          if (c && !seen.has(c)) {
            seen.add(c);
            pixels += c.width * c.height;
          }
        }
      }
      if ((pixels > MAX_HISTORY_PIXELS || this.history.length - i > MAX_HISTORY) && i < this.index) {
        this.history = this.history.slice(i + 1);
        this.index -= i + 1;
        this.savedIndex -= i + 1;
        break;
      }
    }
    this.klayer.batchDraw();
    this.emit();
  }

  private restore(s: Snapshot) {
    this.tr.nodes([]);
    for (const L of this.layers) L.group.destroy();
    this.layers = [];
    const sizeChanged = s.width !== this.docW || s.height !== this.docH;
    this.docW = s.width;
    this.docH = s.height;
    for (const m of s.layers) this.addLiveLayer(m);
    this.activeId = s.active;
    if (!this.active.mask) this.editMask = false;
    if (this.tool === 'move') this.tr.nodes([this.active.group]);
    this.updateDraggable();
    this.version++;
    if (sizeChanged) {
      this.selection = null;
      this.fit();
    }
    this.klayer.batchDraw();
    this.emit();
  }

  undo() {
    if (this.adjuster) this.cancelAdjust();
    if (this.floating) return this.finishTransform(false);
    if (this.index <= 0) return;
    this.index--;
    this.restore(this.history[this.index]);
  }

  redo() {
    if (this.index >= this.history.length - 1) return;
    this.index++;
    this.restore(this.history[this.index]);
  }

  markSaved() {
    this.savedIndex = this.index;
    this.emit();
  }

  /** Replace everything with a new image (navigation, reload). */
  load(base: HTMLCanvasElement) {
    this.loadLayers(base.width, base.height, [{ name: t('Background'), canvas: base }]);
  }

  /** Replace everything with a layered image (.ora). */
  loadLayers(w: number, h: number, layers: { name: string; canvas: HTMLCanvasElement; x?: number; y?: number; opacity?: number; visible?: boolean; blend?: Blend; objects?: string[]; mask?: HTMLCanvasElement | null; maskOn?: boolean }[]) {
    this.cancelAdjust();
    this.tr.nodes([]);
    this.cancelRegion();
    this.selection = null;
    for (const L of this.layers) L.group.destroy();
    this.layers = [];
    this.docW = w;
    this.docH = h;
    for (const l of layers) {
      const mask = l.mask && l.mask.width === l.canvas.width && l.mask.height === l.canvas.height ? l.mask : null;
      this.addLiveLayer({ ...plainLayer(l.name, l.canvas), x: l.x ?? 0, y: l.y ?? 0, opacity: l.opacity ?? 1, visible: l.visible ?? true, blend: l.blend ?? 'source-over', objects: l.objects ?? [], mask, maskOn: l.maskOn ?? true });
    }
    this.activeId = this.layers[this.layers.length - 1].id;
    this.editMask = false;
    this.updateDraggable();
    this.history = [this.snapshot()];
    this.index = 0;
    this.savedIndex = 0;
    this.version++;
    this.fit();
  }

  /**
   * Layers for saving (.ora): the pixels as other apps should show them
   * (markup and mask applied), plus markup JSON and the mask, so editing can
   * go on here (with rawLayers()).
   */
  exportLayers(): { name: string; canvas: HTMLCanvasElement; x: number; y: number; opacity: number; visible: boolean; blend: Blend; objects: string[]; mask?: HTMLCanvasElement; maskOn?: boolean }[] {
    return this.layers.map((L) => {
      // ORA layers can only be offset, so transformed layers are baked first.
      const g = L.group;
      const simple = g.rotation() === 0 && g.scaleX() === 1 && g.scaleY() === 1;
      if (!simple) this.bake(L);
      const objects = L.objs.getChildren().map((n) => n.toJSON());
      // Rasterise markup into the PNG too, so other apps show it.
      const content = objects.length ? this.renderLayerContentAt(L) : L.canvas;
      const canvas = L.mask && L.maskOn ? applyMask(content, L.mask) : content;
      const masked = L.mask ? { mask: L.mask, maskOn: L.maskOn } : {};
      return { name: L.name, canvas, x: L.group.x(), y: L.group.y(), opacity: L.group.opacity(), visible: L.group.visible(), blend: (L.group.globalCompositeOperation() || 'source-over') as Blend, objects, ...masked };
    });
  }

  /** Raster + markup in the layer's own (untransformed) coordinates. */
  private renderLayerContentAt(L: LiveLayer): HTMLCanvasElement {
    const out = raster.clone(L.canvas);
    const g = out.getContext('2d')!;
    const c = this.atIdentity(() => {
      const t = { x: L.group.x(), y: L.group.y(), o: L.group.opacity(), v: L.group.visible() };
      L.group.setAttrs({ x: 0, y: 0, opacity: 1, visible: true });
      L.group.clearCache();
      L.img.visible(false);
      L.maskNode.visible(false); // the mask is applied by the caller, to raster and markup alike
      const r = L.group.toCanvas({ x: 0, y: 0, width: L.canvas.width, height: L.canvas.height, pixelRatio: 1 }) as HTMLCanvasElement;
      L.img.visible(true);
      L.group.setAttrs({ x: t.x, y: t.y, opacity: t.o, visible: t.v });
      this.refreshCache(L);
      return r;
    });
    g.drawImage(c, 0, 0);
    return out;
  }

  /** Rasters without markup or mask, of layers that have either (null otherwise), bottom first. */
  rawLayers(): (HTMLCanvasElement | null)[] {
    return this.layers.map((L) => (L.objs.getChildren().length || L.mask ? L.canvas : null));
  }

  get layerCount() {
    return this.layers.length;
  }

  state(): EditorState {
    return {
      width: this.docW,
      height: this.docH,
      zoom: this.view.zoom,
      canUndo: this.index > 0,
      canRedo: this.index < this.history.length - 1,
      dirty: this.index !== this.savedIndex,
      hasRegion: this.region.visible() && this.regionTr.nodes().length > 0,
      hasSelection: !!this.selectedObject(),
      pixelSelection: this.selection ? { ...this.selection.bounds } : null,
      layers: this.layerInfo(),
      activeId: this.activeId,
      object: this.objectProps(),
      adjusting: !!this.adjuster,
      editMask: this.editMask,
      transforming: !!this.floating,
      viewRotation: this.viewRotation,
      version: this.version,
    };
  }

  /** While a transformer's round handle turns its node: the angle, by the pointer. */
  private showAngle(t: Transformer) {
    const node = t.nodes()[0];
    const p = this.stage.getPointerPosition();
    if (!node || !p || !t.getActiveAnchor()?.startsWith('rotater')) return;
    let deg = ((node.rotation() % 360) + 540) % 360 - 180; // -180…180
    if (Math.abs(deg) < 0.05) deg = 0;
    (this.angleTip.getText() as KText).text(`${Math.round(deg * 10) / 10}°`);
    this.angleTip.setAttrs({ x: p.x + 16, y: p.y + 16, visible: true });
  }

  private emit() {
    this.syncSelFrame();
    this.onChange(this.state());
  }

  destroy() {
    this.cancelAdjust();
    this.ro.disconnect();
    this.themeWatch.disconnect();
    this.stage.destroy();
  }
}
