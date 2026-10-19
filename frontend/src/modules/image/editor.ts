// Konva-based image editor: one base raster plus editable markup shapes, with
// zoom/pan, selection tools and undo. Raster operations (crop, rotate, blur…)
// first flatten the markup into the raster, so markup stays editable until the
// next raster operation.
import Konva from 'konva/lib/Core';
import { Image as KImage } from 'konva/lib/shapes/Image';
import { Rect as KRect } from 'konva/lib/shapes/Rect';
import { Arrow } from 'konva/lib/shapes/Arrow';
import { Text as KText } from 'konva/lib/shapes/Text';
import { Transformer } from 'konva/lib/shapes/Transformer';
import type { Node as KNode } from 'konva/lib/Node';
import { centered, clampZoom, fitZoom, normRect, stepZoom, zoomAt, type Rect, type View } from './geometry';
import * as raster from './raster';

export type Tool = 'hand' | 'crop' | 'arrow' | 'rect' | 'text' | 'blur' | 'pixelate';
export const REGION_TOOLS: Tool[] = ['crop', 'blur', 'pixelate'];

interface Snapshot {
  base: HTMLCanvasElement;
  shapes: string[];
}

export interface EditorState {
  width: number;
  height: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  hasRegion: boolean;
  hasSelection: boolean;
}

const MAX_HISTORY = 30;
const MAX_HISTORY_PIXELS = 250e6;

export class ImageEditor {
  stage: Konva.Stage;
  private layer: Konva.Layer;
  private world: Konva.Group;
  private bg: KImage;
  private shapes: Konva.Group;
  private tr: Transformer;
  private region: KRect;
  private regionTr: Transformer;
  private draft: KNode | null = null;
  private start: { x: number; y: number } | null = null;
  base: HTMLCanvasElement;
  view: View = { zoom: 1, x: 0, y: 0 };
  tool: Tool = 'hand';
  color = '#e5484d';
  private history: Snapshot[] = [];
  private index = -1;
  private savedIndex = 0;
  private fitted = true;
  private ro: ResizeObserver;
  onChange: (s: EditorState) => void = () => {};
  /** Asks the user for text (wired to the app's prompt dialog). */
  askText: (initial: string) => Promise<string | null> = async () => null;

  constructor(
    private container: HTMLDivElement,
    base: HTMLCanvasElement,
  ) {
    this.base = base;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.layer = new Konva.Layer();
    this.stage.add(this.layer);
    this.world = new Konva.Group({ draggable: true });
    this.layer.add(this.world);
    this.bg = new KImage({ image: base, x: 0, y: 0, listening: true, name: 'bg' });
    this.world.add(this.bg);
    this.shapes = new Konva.Group();
    this.world.add(this.shapes);
    this.region = new KRect({ visible: false, stroke: '#ffffff', dash: [6, 4], strokeScaleEnabled: false, strokeWidth: 1.5, fill: 'rgba(217,119,87,0.12)', draggable: true, name: 'region' });
    this.world.add(this.region);
    this.regionTr = new Transformer({ rotateEnabled: false, keepRatio: false, borderStroke: '#d97757', anchorStroke: '#d97757', anchorSize: 9, anchorCornerRadius: 3, ignoreStroke: true });
    this.tr = new Transformer({ borderStroke: '#d97757', anchorStroke: '#d97757', anchorSize: 9, anchorCornerRadius: 3, rotateEnabled: true });
    this.layer.add(this.regionTr, this.tr);
    this.history = [{ base, shapes: [] }];
    this.index = 0;
    this.savedIndex = 0;

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.fit();
  }

  // ---- view ----

  get width() {
    return this.base.width;
  }
  get height() {
    return this.base.height;
  }

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
    // Crisp pixels when zoomed in.
    this.layer.imageSmoothingEnabled(this.view.zoom < 2);
    this.layer.batchDraw();
    this.emit();
  }

  fit() {
    const z = fitZoom(this.width, this.height, this.stage.width(), this.stage.height());
    this.setView(centered(this.width, this.height, this.stage.width(), this.stage.height(), z), true);
  }

  actualSize() {
    this.setView(centered(this.width, this.height, this.stage.width(), this.stage.height(), 1));
  }

  zoomStep(dir: 1 | -1) {
    const cx = this.stage.width() / 2;
    const cy = this.stage.height() / 2;
    this.setView(zoomAt(this.view, cx, cy, stepZoom(this.view.zoom, dir)));
  }

  // ---- tools ----

  setTool(t: Tool) {
    this.cancelRegion();
    this.select(null);
    this.tool = t;
    this.world.draggable(t === 'hand');
    this.shapes.getChildren().forEach((n) => n.draggable(t === 'hand'));
    this.container.style.cursor = t === 'hand' ? 'grab' : t === 'text' ? 'text' : 'crosshair';
    this.emit();
  }

  private pointer(): { x: number; y: number } {
    const p = this.world.getRelativePointerPosition() ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  }

  private strokeWidth(): number {
    return Math.max(3, Math.round(Math.max(this.width, this.height) / 220));
  }

  private bindEvents() {
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const p = this.stage.getPointerPosition();
      if (!p) return;
      const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0025));
      this.setView(zoomAt(this.view, p.x, p.y, clampZoom(this.view.zoom * factor)));
    });
    this.world.on('dragmove', () => {
      this.view = { ...this.view, x: this.world.x(), y: this.world.y() };
      this.fitted = false;
    });
    this.world.on('dragstart', () => (this.container.style.cursor = 'grabbing'));
    this.world.on('dragend', () => (this.container.style.cursor = this.tool === 'hand' ? 'grab' : 'crosshair'));

    this.stage.on('mousedown touchstart', (e) => {
      if (this.tool === 'hand') {
        const target = e.target;
        if (target.getParent() === this.shapes) this.select(target);
        else if (!target.getParent()?.className?.includes('Transformer')) this.select(null);
        return;
      }
      if (e.target === this.region || e.target.getParent() === this.regionTr) return;
      const p = this.pointer();
      this.start = p;
      const sw = this.strokeWidth();
      if (this.tool === 'arrow') {
        this.draft = new Arrow({ points: [p.x, p.y, p.x, p.y], stroke: this.color, fill: this.color, strokeWidth: sw, pointerLength: sw * 4, pointerWidth: sw * 4, lineCap: 'round', lineJoin: 'round' });
      } else if (this.tool === 'rect') {
        this.draft = new KRect({ x: p.x, y: p.y, width: 0, height: 0, stroke: this.color, strokeWidth: sw, cornerRadius: sw });
      } else if (REGION_TOOLS.includes(this.tool)) {
        this.region.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true });
        this.regionTr.nodes([]);
        return;
      } else if (this.tool === 'text') {
        this.start = null;
        void this.addText(p);
        return;
      }
      if (this.draft) this.shapes.add(this.draft as Konva.Shape);
    });

    this.stage.on('mousemove touchmove', () => {
      if (!this.start) return;
      const p = this.pointer();
      if (this.draft instanceof Arrow) this.draft.points([this.start.x, this.start.y, p.x, p.y]);
      else if (this.draft instanceof KRect) this.draft.setAttrs({ width: p.x - this.start.x, height: p.y - this.start.y });
      else if (REGION_TOOLS.includes(this.tool)) this.region.setAttrs({ width: p.x - this.start.x, height: p.y - this.start.y });
      this.layer.batchDraw();
    });

    this.stage.on('mouseup touchend', () => {
      if (!this.start) return;
      this.start = null;
      const d = this.draft;
      this.draft = null;
      if (d) {
        const tiny = d instanceof Arrow ? Math.hypot(d.points()[2] - d.points()[0], d.points()[3] - d.points()[1]) < 4 : Math.abs((d as KRect).width()) < 3 || Math.abs((d as KRect).height()) < 3;
        if (tiny) {
          d.destroy();
          this.layer.batchDraw();
          return;
        }
        if (d instanceof KRect) d.setAttrs(normRect({ x: d.x(), y: d.y(), width: d.width(), height: d.height() }, Infinity, Infinity));
        this.decorate(d);
        this.commit();
      } else if (REGION_TOOLS.includes(this.tool)) {
        const r = normRect(this.regionRect(), this.width, this.height);
        if (r.width < 3 || r.height < 3) {
          this.cancelRegion();
          return;
        }
        this.region.setAttrs(r);
        this.regionTr.nodes([this.region]);
        this.layer.batchDraw();
        this.emit();
      }
    });
  }

  private regionRect(): Rect {
    const r = this.region;
    return { x: r.x(), y: r.y(), width: r.width() * r.scaleX(), height: r.height() * r.scaleY() };
  }

  /** The current crop/blur selection in image pixels, if any. */
  currentRegion(): Rect | null {
    if (!this.region.visible()) return null;
    const r = normRect(this.regionRect(), this.width, this.height);
    return r.width >= 1 && r.height >= 1 ? r : null;
  }

  /** Select a region programmatically (tests, keyboard). */
  setRegion(r: Rect) {
    this.region.setAttrs({ ...r, scaleX: 1, scaleY: 1, visible: true });
    this.regionTr.nodes([this.region]);
    this.layer.batchDraw();
    this.emit();
  }

  cancelRegion() {
    this.region.setAttrs({ visible: false, scaleX: 1, scaleY: 1 });
    this.regionTr.nodes([]);
    this.layer.batchDraw();
    this.emit();
  }

  /** Apply the active region tool (crop / blur / pixelate). */
  applyRegion() {
    const r = this.currentRegion();
    if (!r) return;
    const tool = this.tool;
    this.cancelRegion();
    if (tool === 'crop') this.rasterOp((c) => raster.crop(c, r), true);
    else if (tool === 'blur') this.rasterOp((c) => raster.blurRegion(c, r));
    else if (tool === 'pixelate') this.rasterOp((c) => raster.pixelateRegion(c, r));
  }

  // ---- markup ----

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

  async addText(p: { x: number; y: number }, text?: string) {
    const t = text ?? (await this.askText(''));
    if (!t) return;
    const size = Math.max(16, Math.round(Math.max(this.width, this.height) / 32));
    const node = new KText({ x: p.x, y: p.y, text: t, fontSize: size, fontFamily: 'Inter Variable, Inter, sans-serif', fontStyle: '600', fill: this.color, shadowColor: 'rgba(0,0,0,0.35)', shadowBlur: size / 8 });
    this.shapes.add(node);
    this.decorate(node);
    this.commit();
  }

  /** Add an arrow programmatically (tests). */
  addArrow(x1: number, y1: number, x2: number, y2: number) {
    const sw = this.strokeWidth();
    const a = new Arrow({ points: [x1, y1, x2, y2], stroke: this.color, fill: this.color, strokeWidth: sw, pointerLength: sw * 4, pointerWidth: sw * 4, lineCap: 'round' });
    this.shapes.add(a);
    this.decorate(a);
    this.commit();
  }

  private select(n: KNode | null) {
    this.tr.nodes(n ? [n] : []);
    this.layer.batchDraw();
    this.emit();
  }

  deleteSelection() {
    const nodes = this.tr.nodes();
    if (!nodes.length) return;
    nodes.forEach((n) => n.destroy());
    this.tr.nodes([]);
    this.commit();
  }

  setColor(c: string) {
    this.color = c;
    for (const n of this.tr.nodes()) {
      if (n instanceof KText) n.fill(c);
      else if (n instanceof Arrow) n.setAttrs({ stroke: c, fill: c });
      else if (n instanceof KRect) n.stroke(c);
    }
    if (this.tr.nodes().length) this.commit();
  }

  // ---- raster operations ----

  /** Flatten markup into the raster, then apply op to it. */
  rasterOp(op: (c: HTMLCanvasElement) => HTMLCanvasElement, refit = false) {
    const flat = this.shapes.getChildren().length ? this.composite() : this.base;
    this.shapes.destroyChildren();
    this.tr.nodes([]);
    const next = op(flat);
    const sizeChanged = next.width !== this.base.width || next.height !== this.base.height;
    this.setBase(next);
    this.commit();
    if (refit || sizeChanged || this.fitted) this.fit();
  }

  rotate(clockwise: boolean) {
    this.rasterOp((c) => raster.rotate(c, clockwise), true);
  }
  flip(horizontal: boolean) {
    this.rasterOp((c) => raster.flip(c, horizontal));
  }
  resizeTo(w: number, h: number) {
    this.rasterOp((c) => raster.resize(c, w, h), true);
  }

  private setBase(c: HTMLCanvasElement) {
    this.base = c;
    this.bg.image(c);
    this.bg.size({ width: c.width, height: c.height });
    this.layer.batchDraw();
  }

  /** Base raster with markup drawn on top, at 1:1. */
  composite(): HTMLCanvasElement {
    if (!this.shapes.getChildren().length) return this.base;
    const saved = { ...this.view };
    const trNodes = this.tr.nodes();
    const regionVisible = this.region.visible();
    this.tr.nodes([]);
    this.region.visible(false);
    this.regionTr.nodes([]);
    this.world.position({ x: 0, y: 0 });
    this.world.scale({ x: 1, y: 1 });
    const out = this.world.toCanvas({ x: 0, y: 0, width: this.width, height: this.height, pixelRatio: 1 }) as HTMLCanvasElement;
    this.world.position({ x: saved.x, y: saved.y });
    this.world.scale({ x: saved.zoom, y: saved.zoom });
    this.tr.nodes(trNodes);
    if (regionVisible) {
      this.region.visible(true);
      this.regionTr.nodes([this.region]);
    }
    this.layer.batchDraw();
    return out;
  }

  // ---- history ----

  private commit() {
    const snap: Snapshot = { base: this.base, shapes: this.shapes.getChildren().map((n) => n.toJSON()) };
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(snap);
    this.index = this.history.length - 1;
    // Bound memory: drop old raster snapshots.
    let pixels = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (i === this.history.length - 1 || this.history[i].base !== this.history[i + 1].base) pixels += this.history[i].base.width * this.history[i].base.height;
      if ((pixels > MAX_HISTORY_PIXELS || this.history.length - i > MAX_HISTORY) && i < this.index) {
        this.history = this.history.slice(i + 1);
        this.index -= i + 1;
        this.savedIndex -= i + 1;
        break;
      }
    }
    this.layer.batchDraw();
    this.emit();
  }

  private restore(s: Snapshot) {
    this.tr.nodes([]);
    this.shapes.destroyChildren();
    if (s.base !== this.base) {
      const sizeChanged = s.base.width !== this.base.width || s.base.height !== this.base.height;
      this.setBase(s.base);
      if (sizeChanged) this.fit();
    }
    for (const json of s.shapes) {
      const n = Konva.Node.create(json) as KNode;
      this.shapes.add(n as Konva.Shape);
      this.decorate(n);
    }
    this.layer.batchDraw();
    this.emit();
  }

  undo() {
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
    this.shapes.destroyChildren();
    this.tr.nodes([]);
    this.cancelRegion();
    this.setBase(base);
    this.history = [{ base, shapes: [] }];
    this.index = 0;
    this.savedIndex = 0;
    this.fit();
  }

  state(): EditorState {
    return {
      width: this.width,
      height: this.height,
      zoom: this.view.zoom,
      canUndo: this.index > 0,
      canRedo: this.index < this.history.length - 1,
      dirty: this.index !== this.savedIndex,
      hasRegion: this.region.visible() && this.regionTr.nodes().length > 0,
      hasSelection: this.tr.nodes().length > 0,
    };
  }

  private emit() {
    this.onChange(this.state());
  }

  destroy() {
    this.ro.disconnect();
    this.stage.destroy();
  }
}
