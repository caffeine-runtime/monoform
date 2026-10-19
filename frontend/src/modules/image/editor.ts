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
import Konva from 'konva/lib/Core';
import { Image as KImage } from 'konva/lib/shapes/Image';
import { Rect as KRect } from 'konva/lib/shapes/Rect';
import { Ellipse as KEllipse } from 'konva/lib/shapes/Ellipse';
import { Line as KLine } from 'konva/lib/shapes/Line';
import { Arrow } from 'konva/lib/shapes/Arrow';
import { Text as KText } from 'konva/lib/shapes/Text';
import { Transformer } from 'konva/lib/shapes/Transformer';
import type { Node as KNode } from 'konva/lib/Node';
import { centered, clampZoom, fitZoom, normRect, stepZoom, zoomAt, type Rect, type View } from './geometry';
import * as raster from './raster';
import * as sel from './selection';
import type { Selection, SelectMode } from './selection';
import { Adjuster, type Adjustments } from './adjust';
import { cssFamily } from './fonts';

export type Tool =
  | 'hand'
  | 'move'
  | 'select'
  | 'ellipse'
  | 'lasso'
  | 'wand'
  | 'object'
  | 'crop'
  | 'brush'
  | 'eraser'
  | 'arrow'
  | 'rect'
  | 'oval'
  | 'text'
  | 'blur'
  | 'pixelate';
export const REGION_TOOLS: Tool[] = ['crop', 'blur', 'pixelate'];
export const SELECT_TOOLS: Tool[] = ['select', 'ellipse', 'lasso', 'wand', 'object'];

export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'difference' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light';

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: Blend;
  objects: number;
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
  version: number; // increments on every committed change
}

export interface ToolOptions {
  color: string;
  brushSize: number;
  brushOpacity: number;
  strokeWidth: number; // 0 = automatic
  filled: boolean;
  fontFamily: string;
  fontSize: number; // 0 = automatic
  bold: boolean;
  italic: boolean;
  outline: boolean;
  shadow: boolean;
  wandTolerance: number;
  wandContiguous: boolean;
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
}

const MAX_HISTORY = 40;
const MAX_HISTORY_PIXELS = 160e6;
const ACCENT = '#d97757';

let layerSeq = 0;
const newId = () => `L${Date.now().toString(36)}${(++layerSeq).toString(36)}`;

export class ImageEditor {
  stage: Konva.Stage;
  private klayer: Konva.Layer;
  private world: Konva.Group;
  private docGroup: Konva.Group;
  private overlay: Konva.Shape;
  private region: KRect;
  private regionTr: Transformer;
  private tr: Transformer;
  private lassoLine: KLine;
  private layers: LiveLayer[] = [];
  private activeId = '';
  private draft: KNode | null = null;
  private start: { x: number; y: number } | null = null;
  private lasso: number[] | null = null;
  private stroke: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; last: { x: number; y: number }; before: HTMLCanvasElement } | null = null;
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
    fontFamily: 'Inter Variable',
    fontSize: 0,
    bold: true,
    italic: false,
    outline: false,
    shadow: true,
    wandTolerance: 32,
    wandContiguous: true,
  };
  selection: Selection | null = null;
  selectMode: SelectMode = 'replace';
  private adjuster: { a: Adjuster; layer: LiveLayer } | null = null;
  private history: Snapshot[] = [];
  private index = -1;
  private savedIndex = 0;
  private version = 0;
  private fitted = true;
  private ro: ResizeObserver;
  onChange: (s: EditorState) => void = () => {};
  /** Asks the user for text (wired to the app's prompt dialog). */
  askText: (initial: string) => Promise<string | null> = async () => null;
  /** Called on a click with the wand or object tool (handled by the module, which talks to the vision worker). */
  onPick: (tool: 'wand' | 'object', x: number, y: number, mode: SelectMode) => void = () => {};

  constructor(
    private container: HTMLDivElement,
    base: HTMLCanvasElement,
  ) {
    this.docW = base.width;
    this.docH = base.height;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.klayer = new Konva.Layer();
    this.stage.add(this.klayer);
    this.world = new Konva.Group({ draggable: true });
    this.klayer.add(this.world);
    this.docGroup = new Konva.Group({ clipFunc: (ctx) => ctx.rect(0, 0, this.docW, this.docH) });
    this.world.add(this.docGroup);
    this.overlay = new Konva.Shape({ listening: false, sceneFunc: (ctx) => this.drawSelection(ctx) });
    this.world.add(this.overlay);
    this.lassoLine = new KLine({ points: [], stroke: '#fff', strokeWidth: 1, strokeScaleEnabled: false, dash: [4, 4], listening: false, closed: false });
    this.world.add(this.lassoLine);
    this.region = new KRect({ visible: false, stroke: '#ffffff', dash: [6, 4], strokeScaleEnabled: false, strokeWidth: 1.5, fill: 'rgba(217,119,87,0.12)', draggable: true, name: 'region' });
    this.world.add(this.region);
    this.regionTr = new Transformer({ rotateEnabled: false, keepRatio: false, borderStroke: ACCENT, anchorStroke: ACCENT, anchorSize: 9, anchorCornerRadius: 3, ignoreStroke: true });
    this.tr = new Transformer({ borderStroke: ACCENT, anchorStroke: ACCENT, anchorSize: 9, anchorCornerRadius: 3, rotateEnabled: true, rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315] });
    this.klayer.add(this.regionTr, this.tr);
    this.addLiveLayer({ id: newId(), name: 'Background', canvas: base, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, blend: 'source-over', objects: [] });
    this.activeId = this.layers[0].id;
    this.history = [this.snapshot()];
    this.index = 0;
    this.savedIndex = 0;
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
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
    this.klayer.imageSmoothingEnabled(this.view.zoom < 2);
    this.klayer.batchDraw();
    this.emit();
  }

  fit() {
    const z = fitZoom(this.docW, this.docH, this.stage.width(), this.stage.height());
    this.setView(centered(this.docW, this.docH, this.stage.width(), this.stage.height(), z), true);
  }

  actualSize() {
    this.setView(centered(this.docW, this.docH, this.stage.width(), this.stage.height(), 1));
  }

  zoomStep(dir: 1 | -1) {
    this.setView(zoomAt(this.view, this.stage.width() / 2, this.stage.height() / 2, stepZoom(this.view.zoom, dir)));
  }

  // ---- tools ----

  setTool(t: Tool) {
    if (this.stroke) this.endStroke();
    this.cancelRegion();
    this.select(null);
    this.tool = t;
    this.world.draggable(t === 'hand');
    this.updateDraggable();
    if (t === 'move') this.tr.nodes([this.active.group]);
    const cursors: Partial<Record<Tool, string>> = { hand: 'grab', move: 'move', text: 'text', brush: 'crosshair', eraser: 'crosshair' };
    this.container.style.cursor = cursors[t] ?? 'crosshair';
    this.klayer.batchDraw();
    this.emit();
  }

  setOptions(o: Partial<ToolOptions>) {
    Object.assign(this.opts, o);
  }

  private updateDraggable() {
    for (const L of this.layers) {
      L.group.draggable(this.tool === 'move' && L.id === this.activeId);
      L.objs.getChildren().forEach((n) => n.draggable(this.tool === 'hand'));
    }
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
      const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0025));
      this.setView(zoomAt(this.view, p.x, p.y, clampZoom(this.view.zoom * factor)));
    });
    const isWorld = (n: unknown) => n === (this.world as unknown);
    this.world.on('dragmove', (e) => {
      if (!isWorld(e.target)) return;
      this.view = { ...this.view, x: this.world.x(), y: this.world.y() };
      this.fitted = false;
    });
    this.world.on('dragstart', (e) => isWorld(e.target) && (this.container.style.cursor = 'grabbing'));
    this.world.on('dragend', (e) => isWorld(e.target) && (this.container.style.cursor = this.tool === 'hand' ? 'grab' : 'crosshair'));

    this.stage.on('mousedown touchstart', (e) => {
      const t = this.tool;
      const target = e.target;
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
      if (t === 'wand' || t === 'object') {
        this.onPick(t, p.x, p.y, mode);
        return;
      }
      if (t === 'text') {
        void this.addText(p);
        return;
      }
      this.start = p;
      const sw = this.autoStroke();
      const c = this.opts.color;
      if (t === 'arrow') {
        this.draft = new Arrow({ points: [p.x, p.y, p.x, p.y], stroke: c, fill: c, strokeWidth: sw, pointerLength: sw * 4, pointerWidth: sw * 4, lineCap: 'round', lineJoin: 'round' });
      } else if (t === 'rect') {
        this.draft = new KRect({ x: p.x, y: p.y, width: 0, height: 0, stroke: c, strokeWidth: sw, cornerRadius: sw, fill: this.opts.filled ? c : undefined });
      } else if (t === 'oval') {
        this.draft = new KEllipse({ x: p.x, y: p.y, radiusX: 0, radiusY: 0, stroke: c, strokeWidth: sw, fill: this.opts.filled ? c : undefined });
      } else if (REGION_TOOLS.includes(t) || t === 'select' || t === 'ellipse') {
        this.region.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true, cornerRadius: 0 });
        this.regionTr.nodes([]);
        return;
      } else if (t === 'lasso') {
        this.lasso = [p.x, p.y];
        this.lassoLine.points(this.lasso);
        return;
      } else if (t === 'brush' || t === 'eraser') {
        this.beginStroke(p);
        return;
      }
      if (this.draft) this.active.objs.add(this.draft as Konva.Shape);
    });

    this.stage.on('mousemove touchmove', () => {
      if (!this.start && !this.lasso) return;
      const p = this.pointer();
      if (this.stroke) {
        this.strokeTo(p);
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
      if (this.draft instanceof Arrow) this.draft.points([s.x, s.y, p.x, p.y]);
      else if (this.draft instanceof KRect) this.draft.setAttrs({ width: p.x - s.x, height: p.y - s.y });
      else if (this.draft instanceof KEllipse) this.draft.setAttrs({ x: (s.x + p.x) / 2, y: (s.y + p.y) / 2, radiusX: Math.abs(p.x - s.x) / 2, radiusY: Math.abs(p.y - s.y) / 2 });
      else if (this.region.visible()) this.region.setAttrs({ width: p.x - s.x, height: p.y - s.y });
      this.klayer.batchDraw();
    });

    this.stage.on('mouseup touchend', (e) => {
      if (this.stroke) {
        this.endStroke();
        this.start = null;
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
    this.klayer.batchDraw();
    this.emit();
  }

  cancelRegion() {
    this.region.setAttrs({ visible: false, scaleX: 1, scaleY: 1 });
    this.regionTr.nodes([]);
    this.klayer.batchDraw();
    this.emit();
  }

  applyRegion() {
    const r = this.currentRegion();
    if (!r) return;
    const tool = this.tool;
    this.cancelRegion();
    if (tool === 'crop') this.crop(r);
    else if (tool === 'blur') this.pixelOp((c) => raster.blurRegion(c, r));
    else if (tool === 'pixelate') this.pixelOp((c) => raster.pixelateRegion(c, r));
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

  private drawSelection(ctx: Konva.Context) {
    const s = this.selection;
    if (!s) return;
    const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    const lw = 1 / this.view.zoom;
    c.save();
    if (s.paths) {
      c.lineWidth = lw;
      c.strokeStyle = '#000';
      for (const p of s.paths) c.stroke(p);
      c.strokeStyle = '#fff';
      c.setLineDash([4 * lw, 4 * lw]);
      for (const p of s.paths) c.stroke(p);
    } else if (s.edges) {
      // Difference keeps the outline visible on light and dark pixels alike.
      c.imageSmoothingEnabled = false;
      c.globalCompositeOperation = 'difference';
      c.drawImage(s.edges.canvas, 0, 0, this.docW, this.docH);
    } else {
      c.lineWidth = lw;
      c.strokeStyle = '#fff';
      c.setLineDash([4 * lw, 4 * lw]);
      c.strokeRect(s.bounds.x, s.bounds.y, s.bounds.width, s.bounds.height);
    }
    c.restore();
  }

  // ---- layers ----

  private addLiveLayer(m: LayerModel, index = this.layers.length): LiveLayer {
    const group = new Konva.Group({ x: m.x, y: m.y, rotation: m.rotation, scaleX: m.scaleX, scaleY: m.scaleY, opacity: m.opacity, visible: m.visible, globalCompositeOperation: m.blend, name: 'layer' });
    const img = new KImage({ image: m.canvas, x: 0, y: 0, width: m.canvas.width, height: m.canvas.height, name: 'raster' });
    const objs = new Konva.Group({ name: 'objects' });
    group.add(img, objs);
    for (const json of m.objects) {
      const n = Konva.Node.create(json) as KNode;
      objs.add(n as Konva.Shape);
      this.decorate(n);
    }
    group.on('dragend transformend', () => this.commit());
    const L: LiveLayer = { id: m.id, name: m.name, canvas: m.canvas, group, img, objs };
    this.layers.splice(index, 0, L);
    this.docGroup.add(group);
    this.layers.forEach((l, i) => l.group.zIndex(i));
    return L;
  }

  private setCanvas(L: LiveLayer, c: HTMLCanvasElement) {
    L.canvas = c;
    L.img.image(c);
    L.img.size({ width: c.width, height: c.height });
  }

  layerInfo(): LayerInfo[] {
    return this.layers.map((L) => ({ id: L.id, name: L.name, visible: L.group.visible(), opacity: L.group.opacity(), blend: (L.group.globalCompositeOperation() || 'source-over') as Blend, objects: L.objs.getChildren().length }));
  }

  /** The layer's raster canvas. */
  layerCanvas(id: string): HTMLCanvasElement | null {
    return this.layers.find((l) => l.id === id)?.canvas ?? null;
  }

  /** Raster plus markup of a layer, for thumbnails. */
  layerPreview(id: string): HTMLCanvasElement | null {
    const L = this.layers.find((l) => l.id === id);
    if (!L) return null;
    return L.objs.getChildren().length ? this.renderLayerContentAt(L) : L.canvas;
  }

  setActive(id: string) {
    if (!this.layers.some((l) => l.id === id)) return;
    this.activeId = id;
    this.updateDraggable();
    this.select(null);
    this.emit();
  }

  addLayer(name?: string, canvas?: HTMLCanvasElement, at?: { x: number; y: number }): string {
    const c = canvas ?? raster.makeCanvas(this.docW, this.docH);
    const idx = this.layers.indexOf(this.active) + 1;
    const L = this.addLiveLayer({ id: newId(), name: name ?? `Layer ${this.layers.length + 1}`, canvas: c, x: at?.x ?? 0, y: at?.y ?? 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, blend: 'source-over', objects: [] }, idx);
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
    const N = this.addLiveLayer({ ...m, id: newId(), name: `${L.name} copy` }, idx);
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
    this.resetLayer(below, merged);
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
    const L = this.addLiveLayer({ id: newId(), name: 'Background', canvas: flat, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, blend: 'source-over', objects: [] });
    this.activeId = L.id;
    this.commit();
  }

  /** Group opacity applies per child in Konva; cache groups with markup so it applies once. */
  private refreshCache(L: LiveLayer) {
    L.group.clearCache();
    if (L.group.opacity() < 1 && L.objs.getChildren().length && L.group.visible()) L.group.cache();
  }

  // ---- rendering ----

  /** Run fn with the world at identity and overlays hidden (for exact 1:1 rendering). */
  private atIdentity<T>(fn: () => T): T {
    const saved = { ...this.view };
    const trNodes = this.tr.nodes();
    const regionVisible = this.region.visible();
    const sel0 = this.selection;
    this.tr.nodes([]);
    this.region.visible(false);
    this.regionTr.nodes([]);
    this.selection = null;
    this.world.position({ x: 0, y: 0 });
    this.world.scale({ x: 1, y: 1 });
    try {
      return fn();
    } finally {
      this.world.position({ x: saved.x, y: saved.y });
      this.world.scale({ x: saved.zoom, y: saved.zoom });
      this.selection = sel0;
      this.tr.nodes(trNodes);
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
    if (this.layers.length === 1 && this.isBaked(this.layers[0]) && this.layers[0].group.opacity() === 1 && this.layers[0].group.visible()) return this.layers[0].canvas;
    return this.atIdentity(() => this.docGroup.toCanvas({ x: 0, y: 0, width: this.docW, height: this.docH, pixelRatio: 1 }) as HTMLCanvasElement);
  }

  /** Bake a layer's transform and markup into a document-sized raster. */
  private bake(L: LiveLayer) {
    if (this.isBaked(L)) return;
    this.resetLayer(L, this.renderLayers([L], false));
  }

  private resetLayer(L: LiveLayer, c: HTMLCanvasElement) {
    L.objs.destroyChildren();
    L.group.setAttrs({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    this.setCanvas(L, c);
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
      this.setCanvas(L, op(L.canvas));
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

  /** Copy the selection into a new layer above (Ctrl+J). */
  layerFromSelection(cut = false) {
    const { canvas, x, y } = this.copySelection();
    if (cut) this.clearSelectionPixels();
    this.addLayer(`${this.active.name} (part)`, canvas, { x, y });
  }

  /** Paste an image as a new layer, at (x, y) or centred in the view. */
  pasteImage(c: HTMLCanvasElement, at?: { x: number; y: number }, name = 'Pasted') {
    const p = at ?? { x: Math.round((this.docW - c.width) / 2), y: Math.round((this.docH - c.height) / 2) };
    this.addLayer(name, c, p);
    this.deselect();
    if (this.tool !== 'move') this.setTool('move');
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
    const before = L.canvas;
    const canvas = raster.clone(before);
    const g = canvas.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = this.brushSize();
    g.strokeStyle = this.opts.color;
    g.fillStyle = this.opts.color;
    g.globalAlpha = this.tool === 'eraser' ? 1 : this.opts.brushOpacity;
    g.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    g.beginPath();
    g.arc(p.x, p.y, g.lineWidth / 2, 0, Math.PI * 2);
    g.fill();
    this.stroke = { canvas, g, last: p, before };
    this.setCanvas(L, canvas);
    this.klayer.batchDraw();
  }

  private strokeTo(p: { x: number; y: number }) {
    const s = this.stroke!;
    s.g.beginPath();
    s.g.moveTo(s.last.x, s.last.y);
    s.g.lineTo(p.x, p.y);
    s.g.stroke();
    s.last = p;
    this.active.img.image(s.canvas);
    this.klayer.batchDraw();
  }

  private endStroke() {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const L = this.active;
    if (this.selection) this.setCanvas(L, sel.blendThroughMask(s.before, s.canvas, this.selection.mask));
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
    node.setAttr('hiaFamily', o.fontFamily);
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
        fontFamily: (n.getAttr('hiaFamily') as string) ?? n.fontFamily(),
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
    if (n instanceof KRect) return { kind: 'rect', color: n.stroke() as string, strokeWidth: n.strokeWidth(), filled: !!n.fill() };
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
        n.setAttr('hiaFamily', p.fontFamily);
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
      L.img.image(a.canvas);
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  previewAdjust(a: Adjustments) {
    if (!this.adjuster) return;
    this.adjuster.a.render(a);
    this.adjuster.layer.img.image(this.adjuster.a.canvas);
    this.klayer.batchDraw();
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
    ad.layer.img.image(ad.layer.canvas);
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
    };
  }

  private snapshot(): Snapshot {
    return { width: this.docW, height: this.docH, active: this.activeId, layers: this.layers.map((L) => this.modelOf(L)) };
  }

  private commit() {
    this.version++;
    for (const L of this.layers) this.refreshCache(L);
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(this.snapshot());
    this.index = this.history.length - 1;
    // Bound memory: count each distinct raster once, drop the oldest states.
    const seen = new Set<HTMLCanvasElement>();
    let pixels = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      for (const m of this.history[i].layers) {
        if (!seen.has(m.canvas)) {
          seen.add(m.canvas);
          pixels += m.canvas.width * m.canvas.height;
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
    this.loadLayers(base.width, base.height, [{ name: 'Background', canvas: base }]);
  }

  /** Replace everything with a layered image (.ora). */
  loadLayers(w: number, h: number, layers: { name: string; canvas: HTMLCanvasElement; x?: number; y?: number; opacity?: number; visible?: boolean; blend?: Blend; objects?: string[] }[]) {
    this.cancelAdjust();
    this.tr.nodes([]);
    this.cancelRegion();
    this.selection = null;
    for (const L of this.layers) L.group.destroy();
    this.layers = [];
    this.docW = w;
    this.docH = h;
    for (const l of layers) {
      this.addLiveLayer({ id: newId(), name: l.name, canvas: l.canvas, x: l.x ?? 0, y: l.y ?? 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: l.opacity ?? 1, visible: l.visible ?? true, blend: l.blend ?? 'source-over', objects: l.objects ?? [] });
    }
    this.activeId = this.layers[this.layers.length - 1].id;
    this.updateDraggable();
    this.history = [this.snapshot()];
    this.index = 0;
    this.savedIndex = 0;
    this.version++;
    this.fit();
  }

  /** Layers for saving (.ora): raster without markup, plus markup JSON. */
  exportLayers(): { name: string; canvas: HTMLCanvasElement; x: number; y: number; opacity: number; visible: boolean; blend: Blend; objects: string[] }[] {
    return this.layers.map((L) => {
      // ORA layers can only be offset, so transformed layers are baked first.
      const g = L.group;
      const simple = g.rotation() === 0 && g.scaleX() === 1 && g.scaleY() === 1;
      if (!simple) this.bake(L);
      const objects = L.objs.getChildren().map((n) => n.toJSON());
      // Rasterise markup into the PNG too, so other apps show it.
      const canvas = objects.length ? this.renderLayerContentAt(L) : L.canvas;
      return { name: L.name, canvas, x: L.group.x(), y: L.group.y(), opacity: L.group.opacity(), visible: L.group.visible(), blend: (L.group.globalCompositeOperation() || 'source-over') as Blend, objects };
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
      const r = L.group.toCanvas({ x: 0, y: 0, width: L.canvas.width, height: L.canvas.height, pixelRatio: 1 }) as HTMLCanvasElement;
      L.img.visible(true);
      L.group.setAttrs({ x: t.x, y: t.y, opacity: t.o, visible: t.v });
      this.refreshCache(L);
      return r;
    });
    g.drawImage(c, 0, 0);
    return out;
  }

  /** Markup-free rasters of layers that have markup (null otherwise), bottom first. */
  rawLayers(): (HTMLCanvasElement | null)[] {
    return this.layers.map((L) => (L.objs.getChildren().length ? L.canvas : null));
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
      version: this.version,
    };
  }

  private emit() {
    this.onChange(this.state());
  }

  destroy() {
    this.cancelAdjust();
    this.ro.disconnect();
    this.stage.destroy();
  }
}
