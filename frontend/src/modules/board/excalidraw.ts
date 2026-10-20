// Excalidraw (.excalidraw) drawings: read the JSON, draw it the way
// Excalidraw does (roughjs with each element's seed, perfect-freehand for
// pen strokes, its arrowheads, fill styles, rounded corners, fonts), and
// edit it in place. Unknown properties and elements are kept as they are;
// edited elements get a new version / versionNonce like Excalidraw writes.
import rough from 'roughjs';
import type { Drawable } from 'roughjs/bin/core';
import { getStroke } from 'perfect-freehand';
import { esc, randomId, union, type BoardAdapter, type BoardItem, type BoardStyle, type Box, type CreateOptions, type Measure, type Pt, type TextEdit, type Tool } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = Record<string, any> & { id: string; type: string; x: number; y: number; width: number; height: number };

interface ExcalidrawFile {
  type: string;
  version?: number;
  source?: string;
  elements: El[];
  appState?: Record<string, unknown>;
  files?: Record<string, { mimeType?: string; dataURL?: string }>;
}

const LINEAR = new Set(['arrow', 'line']);
const CONTAINERS = new Set(['rectangle', 'ellipse', 'diamond', 'arrow']);

/** CSS font stacks for Excalidraw's font families (Virgil/Excalifont use the bundled Virgil). */
export function fontStack(family: number): string {
  switch (family) {
    case 2:
    case 9:
      return 'Helvetica, Arial, "Liberation Sans", sans-serif';
    case 3:
      return '"Cascadia Code", "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
    case 6:
      return 'Nunito, "Segoe UI", system-ui, sans-serif';
    case 7:
      return '"Lilita One", Impact, sans-serif';
    case 8:
      return '"Comic Shanns", "Comic Sans MS", cursive';
    default:
      return 'HiaVirgil, Virgil, Excalifont, "Segoe Print", "Comic Sans MS", cursive';
  }
}

const fontOf = (el: El) => `${el.fontSize ?? 20}px ${fontStack(el.fontFamily ?? 1)}`;

function rand(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

/** Sortable fractional-index keys: a0…az, b00…bzz, c000… */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function indexKey(i: number): string {
  let len = 1;
  let span = 62;
  while (i >= span) {
    i -= span;
    len++;
    span *= 62;
  }
  let s = '';
  for (let k = 0; k < len; k++) {
    s = DIGITS[i % 62] + s;
    i = Math.floor(i / 62);
  }
  return String.fromCharCode(96 + len) + s;
}

export function parseExcalidraw(text: string): ExcalidrawFile {
  let doc: ExcalidrawFile;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`This isn't valid JSON: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements)) throw new Error('This file has no Excalidraw elements.');
  if (doc.type && doc.type !== 'excalidraw' && doc.type !== 'excalidraw/clipboard') throw new Error(`Unknown drawing type “${doc.type}”.`);
  return doc;
}

export class ExcalidrawBoard implements BoardAdapter {
  readonly tools: Tool[] = ['select', 'rect', 'ellipse', 'diamond', 'arrow', 'line', 'draw', 'text'];
  readonly styleKeys: (keyof BoardStyle)[] = ['stroke', 'fill', 'width', 'dash', 'fillStyle', 'roughness'];
  doc!: ExcalidrawFile;
  private byId = new Map<string, El>();
  private gen = rough.generator();

  constructor(
    text: string,
    private measure: Measure,
  ) {
    this.load(text);
  }

  load(text: string) {
    this.doc = parseExcalidraw(text);
    this.reindex();
  }

  private reindex() {
    this.byId.clear();
    for (const el of this.doc.elements) this.byId.set(el.id, el);
  }

  private get live(): El[] {
    return this.doc.elements.filter((e) => !e.isDeleted);
  }

  serialize(): string {
    return JSON.stringify(this.doc, null, 2);
  }

  background(): string {
    const bg = this.doc.appState?.viewBackgroundColor;
    return typeof bg === 'string' && bg ? bg : '#ffffff';
  }

  private touch(el: El) {
    el.version = (el.version ?? 1) + 1;
    el.versionNonce = rand();
    el.updated = Date.now();
  }

  /** Bound text of a container (or an arrow label). */
  private boundText(el: El): El | undefined {
    const ref = (el.boundElements ?? []).find((b: { type: string }) => b.type === 'text');
    const t = ref ? this.byId.get(ref.id) : undefined;
    return t && !t.isDeleted ? t : undefined;
  }

  private isBoundText(el: El) {
    return el.type === 'text' && el.containerId && this.byId.get(el.containerId) && !this.byId.get(el.containerId)!.isDeleted;
  }

  box(el: El): Box {
    if ((LINEAR.has(el.type) || el.type === 'freedraw') && Array.isArray(el.points) && el.points.length) {
      const xs = el.points.map((p: number[]) => p[0]);
      const ys = el.points.map((p: number[]) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return { x: el.x + x0, y: el.y + y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
    }
    return { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
  }

  items(): BoardItem[] {
    return this.live.filter((e) => !this.isBoundText(e)).map((e) => this.toItem(e));
  }

  item(id: string): BoardItem | undefined {
    const e = this.byId.get(id);
    return e && !e.isDeleted ? this.toItem(e) : undefined;
  }

  private toItem(e: El): BoardItem {
    return { id: e.id, box: this.box(e), linear: LINEAR.has(e.type), text: e.type === 'text' || CONTAINERS.has(e.type) };
  }

  bounds(): Box {
    return union(this.live.map((e) => this.box(e)));
  }

  expand(ids: string[]): string[] {
    const out = new Set(ids);
    for (const id of ids) {
      const el = this.byId.get(id);
      const groups: string[] = el?.groupIds ?? [];
      const outer = groups[groups.length - 1];
      if (outer) for (const e of this.live) if ((e.groupIds ?? []).includes(outer) && !this.isBoundText(e)) out.add(e.id);
    }
    return [...out];
  }

  // ---------- drawing ----------

  render(): string {
    return this.live.map((e) => this.renderEl(e)).join('');
  }

  private options(el: El, fill = true) {
    const sw = el.strokeWidth ?? 2;
    const dashed = el.strokeStyle === 'dashed';
    const dotted = el.strokeStyle === 'dotted';
    const b = this.box(el);
    let roughness = el.roughness ?? 1;
    if (Math.min(b.w, b.h) < 10 && !LINEAR.has(el.type)) roughness /= 3;
    const bg = el.backgroundColor;
    const o: Record<string, unknown> = {
      seed: el.seed || 1,
      strokeLineDash: dashed ? [8, 8 + sw] : dotted ? [1.5, 6 + sw] : undefined,
      disableMultiStroke: el.strokeStyle && el.strokeStyle !== 'solid',
      strokeWidth: dashed || dotted ? sw + 0.5 : sw,
      fillWeight: sw / 2,
      hachureGap: sw * 4,
      roughness,
      stroke: el.strokeColor ?? '#1e1e1e',
      preserveVertices: roughness < 2,
    };
    if (fill && bg && bg !== 'transparent') {
      o.fill = bg;
      o.fillStyle = el.fillStyle ?? 'hachure';
    }
    if (el.type === 'ellipse') o.curveFitting = 1;
    return o;
  }

  private paths(drawable: Drawable, dash: number[] | undefined): string {
    return this.gen
      .toPaths(drawable)
      .map((p) => {
        const isStroke = p.fill === undefined || p.fill === 'none';
        const da = dash && isStroke && p.stroke !== 'none' && p.strokeWidth > (drawable.options.fillWeight ?? 0) ? ` stroke-dasharray="${dash.join(' ')}"` : '';
        return `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}" stroke-linecap="round" stroke-linejoin="round"${da}/>`;
      })
      .join('');
  }

  private cornerRadius(el: El, size: number): number {
    const r = el.roundness;
    if (!r) return 0;
    if (r.type === 3) return r.value ?? (size <= 32 / 0.25 ? size * 0.25 : 32);
    return size * 0.25;
  }

  /** Drawn bodies by everything that shapes them (not position or version), so a move only re-translates. */
  private cache = new Map<string, string>();

  private renderEl(el: El): string {
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    const opacity = el.opacity !== undefined && el.opacity < 100 ? ` opacity="${el.opacity / 100}"` : '';
    const rot = el.angle ? ` rotate(${(el.angle * 180) / Math.PI} ${w / 2} ${h / 2})` : '';
    const open = `<g data-id="${esc(el.id)}" transform="translate(${el.x} ${el.y})${rot}"${opacity}>`;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { x, y, version, versionNonce, updated, index, ...shape } = el;
    const key = JSON.stringify(shape) + (el.type === 'arrow' ? this.background() : '');
    let body = this.cache.get(key);
    if (body === undefined) {
      body = this.renderBody(el);
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(key, body);
    }
    return `${open}${body}</g>`;
  }

  private renderBody(el: El): string {
    const b = this.box(el);
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    const o = this.options(el);
    const dash = o.strokeLineDash as number[] | undefined;
    let body = '';
    switch (el.type) {
      case 'rectangle':
      case 'iframe':
      case 'embeddable': {
        const r = this.cornerRadius(el, Math.min(w, h));
        const d = r ? this.gen.path(`M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`, o) : this.gen.rectangle(0, 0, w, h, o);
        body = `<rect width="${w}" height="${h}" fill="transparent"/>` + this.paths(d, dash);
        if (el.type !== 'rectangle') body += `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#888">${esc(String(el.link ?? el.type))}</text>`;
        break;
      }
      case 'diamond': {
        const pts: [number, number][] = [
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ];
        let d;
        if (el.roundness) {
          const vr = this.cornerRadius(el, Math.min(w, h) / 2) * 0.6;
          const hr = vr * (w / Math.max(1, h));
          d = this.gen.path(`M ${w / 2 + hr} ${vr} L ${w - hr} ${h / 2 - vr} C ${w} ${h / 2}, ${w} ${h / 2}, ${w - hr} ${h / 2 + vr} L ${w / 2 + hr} ${h - vr} C ${w / 2} ${h}, ${w / 2} ${h}, ${w / 2 - hr} ${h - vr} L ${hr} ${h / 2 + vr} C 0 ${h / 2}, 0 ${h / 2}, ${hr} ${h / 2 - vr} L ${w / 2 - hr} ${vr} C ${w / 2} 0, ${w / 2} 0, ${w / 2 + hr} ${vr}`, o);
        } else d = this.gen.polygon(pts, o);
        body = `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="transparent"/>` + this.paths(d, dash);
        break;
      }
      case 'ellipse':
        body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="transparent"/>` + this.paths(this.gen.ellipse(w / 2, h / 2, w, h, o), dash);
        break;
      case 'arrow':
      case 'line':
        body = this.renderLinear(el, o, dash);
        break;
      case 'freedraw':
        body = this.renderFreedraw(el);
        break;
      case 'text':
        body = this.renderText(el);
        break;
      case 'image': {
        const f = this.doc.files?.[el.fileId];
        const [sx, sy] = Array.isArray(el.scale) ? el.scale : [1, 1];
        const flip = sx < 0 || sy < 0 ? ` transform="translate(${sx < 0 ? w : 0} ${sy < 0 ? h : 0}) scale(${Math.sign(sx) || 1} ${Math.sign(sy) || 1})"` : '';
        body = f?.dataURL ? `<image href="${esc(f.dataURL)}" width="${w}" height="${h}" preserveAspectRatio="none"${flip}/>` : `<rect width="${w}" height="${h}" fill="#f1f1f1" stroke="#bbb"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#888">image missing</text>`;
        break;
      }
      case 'frame':
      case 'magicframe':
        body = `<rect width="${w}" height="${h}" rx="8" fill="transparent" stroke="#bbb" stroke-width="1"/><text x="0" y="-6" font-family="sans-serif" font-size="14" fill="#888">${esc(String(el.name ?? 'Frame'))}</text>`;
        break;
      default:
        body = `<rect width="${b.w}" height="${b.h}" fill="none" stroke="#bbb" stroke-dasharray="4 4"/>`;
    }
    return body;
  }

  private renderLinear(el: El, o: Record<string, unknown>, dash: number[] | undefined): string {
    const pts: [number, number][] = (el.points ?? []).map((p: number[]) => [p[0], p[1]] as [number, number]);
    if (pts.length < 2) return '';
    const loop = el.type === 'line' && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
    const lo = { ...o };
    if (!loop) {
      delete lo.fill;
      delete lo.fillStyle;
    }
    const curved = el.roundness && pts.length > 2 && !el.elbowed;
    const d = curved ? this.gen.curve(pts, lo) : this.gen.linearPath(pts, lo);
    let s = `<path d="M${pts.map((p) => p.join(',')).join('L')}" fill="none" stroke="transparent" stroke-width="14"/>` + this.paths(d, dash);
    if (el.type === 'arrow') {
      const head = (kind: string | null, tip: [number, number], from: [number, number]) => (kind ? this.arrowhead(kind, tip, from, el, o) : '');
      s += head(el.endArrowhead ?? null, pts[pts.length - 1], pts[pts.length - 2]);
      s += head(el.startArrowhead ?? null, pts[0], pts[1]);
    }
    return s;
  }

  private arrowhead(kind: string, tip: [number, number], from: [number, number], el: El, o: Record<string, unknown>): string {
    const [x2, y2] = tip;
    const len = Math.hypot(x2 - from[0], y2 - from[1]) || 1;
    const ux = (x2 - from[0]) / len;
    const uy = (y2 - from[1]) / len;
    const sizes: Record<string, number> = { arrow: 25, diamond: 12, diamond_outline: 12, crowfoot_many: 20, crowfoot_one: 20, crowfoot_one_or_many: 20 };
    const size = Math.min(sizes[kind] ?? 15, len * (kind.startsWith('diamond') ? 0.25 : 0.5));
    const ho = { ...o, fill: undefined, fillStyle: undefined, strokeLineDash: undefined, disableMultiStroke: false };
    const color = (el.strokeColor as string) ?? '#1e1e1e';
    const filled = { ...ho, fill: color, fillStyle: 'solid' };
    const hollow = { ...ho, fill: this.background(), fillStyle: 'solid' };
    const rotate = (deg: number, r: number): [number, number] => {
      const a = (deg * Math.PI) / 180;
      const dx = -ux * r;
      const dy = -uy * r;
      return [x2 + dx * Math.cos(a) - dy * Math.sin(a), y2 + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    switch (kind) {
      case 'bar': {
        const p1 = rotate(90, size / 2);
        const p2 = rotate(-90, size / 2);
        return this.paths(this.gen.line(p1[0], p1[1], p2[0], p2[1], ho), undefined);
      }
      case 'dot':
      case 'circle':
      case 'circle_outline': {
        const cx = x2 - (ux * size) / 2;
        const cy = y2 - (uy * size) / 2;
        return this.paths(this.gen.circle(cx, cy, size, kind === 'circle_outline' ? hollow : filled), undefined);
      }
      case 'triangle':
      case 'triangle_outline': {
        const p1 = rotate(25, size);
        const p2 = rotate(-25, size);
        return this.paths(this.gen.polygon([tip, p1, p2], kind === 'triangle' ? filled : hollow), undefined);
      }
      case 'diamond':
      case 'diamond_outline': {
        const back: [number, number] = [x2 - ux * size * 2, y2 - uy * size * 2];
        const mid: [number, number] = [x2 - ux * size, y2 - uy * size];
        const side = (s: number): [number, number] => [mid[0] - uy * size * 0.5 * s, mid[1] + ux * size * 0.5 * s];
        return this.paths(this.gen.polygon([tip, side(1), back, side(-1)], kind === 'diamond' ? filled : hollow), undefined);
      }
      default: {
        const p1 = rotate(20, size);
        const p2 = rotate(-20, size);
        return this.paths(this.gen.line(p1[0], p1[1], x2, y2, ho), undefined) + this.paths(this.gen.line(p2[0], p2[1], x2, y2, ho), undefined);
      }
    }
  }

  private renderFreedraw(el: El): string {
    const pts: number[][] = el.points ?? [];
    if (!pts.length) return '';
    const pressures: number[] = el.pressures ?? [];
    const input = pts.map((p, i) => [p[0], p[1], pressures[i] ?? 0.5]);
    const outline = getStroke(input, {
      simulatePressure: el.simulatePressure !== false,
      size: (el.strokeWidth ?? 2) * 4.25,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      easing: (t) => Math.sin((t * Math.PI) / 2),
      last: true,
    });
    if (!outline.length) return '';
    let d = `M${outline[0][0]},${outline[0][1]}Q`;
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      d += `${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2} `;
    }
    return `<path d="${d}Z" fill="${esc(el.strokeColor ?? '#1e1e1e')}" stroke="none"/>`;
  }

  private renderText(el: El): string {
    const size = el.fontSize ?? 20;
    const lh = size * (el.lineHeight ?? 1.25);
    const lines = String(el.text ?? '').split('\n');
    const align = el.textAlign ?? 'left';
    const x = align === 'center' ? (el.width ?? 0) / 2 : align === 'right' ? (el.width ?? 0) : 0;
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const base = (lh - size) / 2 + size * 0.82;
    return `<rect width="${el.width ?? 0}" height="${el.height ?? 0}" fill="transparent"/><text font-family="${esc(fontStack(el.fontFamily ?? 1))}" font-size="${size}" fill="${esc(el.strokeColor ?? '#1e1e1e')}" text-anchor="${anchor}" style="white-space: pre">${lines.map((l, i) => `<tspan x="${x}" y="${base + i * lh}">${esc(l)}</tspan>`).join('')}</text>`;
  }

  // ---------- editing ----------

  private arrowsBoundTo(id: string): El[] {
    return this.live.filter((e) => e.type === 'arrow' && (e.startBinding?.elementId === id || e.endBinding?.elementId === id));
  }

  /** Make points[0] the origin again after editing points. */
  private normalize(el: El) {
    const [ox, oy] = el.points[0];
    if (ox || oy) {
      el.x += ox;
      el.y += oy;
      el.points = el.points.map((p: number[]) => [p[0] - ox, p[1] - oy]);
    }
    const b = this.box(el);
    el.width = b.w;
    el.height = b.h;
  }

  private setEndpoint(arrow: El, end: 'start' | 'end', f: (p: Pt) => Pt) {
    const i = end === 'start' ? 0 : arrow.points.length - 1;
    const p = f({ x: arrow.x + arrow.points[i][0], y: arrow.y + arrow.points[i][1] });
    arrow.points = arrow.points.map((q: number[], k: number) => (k === i ? [p.x - arrow.x, p.y - arrow.y] : q));
    this.normalize(arrow);
    this.placeLabel(arrow);
    this.touch(arrow);
  }

  /** Centre a container's text (or an arrow's label) on it. */
  private placeLabel(c: El) {
    const t = this.boundText(c);
    if (!t) return;
    if (c.type === 'arrow') {
      const pts = c.points;
      const m = pts.length % 2 ? pts[(pts.length - 1) / 2] : [(pts[pts.length / 2 - 1][0] + pts[pts.length / 2][0]) / 2, (pts[pts.length / 2 - 1][1] + pts[pts.length / 2][1]) / 2];
      t.x = c.x + m[0] - t.width / 2;
      t.y = c.y + m[1] - t.height / 2;
    } else {
      this.wrapInto(t, c);
      t.x = c.x + (c.width - t.width) / 2;
      t.y = t.verticalAlign === 'top' ? c.y + 5 : t.verticalAlign === 'bottom' ? c.y + c.height - t.height - 5 : c.y + (c.height - t.height) / 2;
    }
    this.touch(t);
  }

  /** Lay text out: width/height from its lines (wrapped to the container if it has one). */
  private wrapInto(t: El, container?: El) {
    const font = fontOf(t);
    const src = String(t.originalText ?? t.text ?? '');
    let lines = src.split('\n');
    if (container && container.type !== 'arrow') {
      const inset = container.type === 'rectangle' ? 10 : container.width * 0.15 + 5;
      const max = Math.max(20, container.width - inset * 2);
      const out: string[] = [];
      for (const line of lines) {
        let cur = '';
        for (const word of line.split(/(\s+)/)) {
          if (cur && this.measure((cur + word).trimEnd(), font) > max) {
            out.push(cur.trimEnd());
            cur = word.trimStart();
          } else cur += word;
        }
        out.push(cur);
      }
      lines = out;
    }
    t.text = lines.join('\n');
    t.width = Math.max(1, ...lines.map((l) => this.measure(l, font)));
    t.height = lines.length * (t.fontSize ?? 20) * (t.lineHeight ?? 1.25);
  }

  move(ids: string[], dx: number, dy: number) {
    const moved = new Set<string>();
    for (const id of ids) {
      const el = this.byId.get(id);
      if (!el || el.locked) continue;
      moved.add(id);
      const t = this.boundText(el);
      if (t) moved.add(t.id);
    }
    for (const id of moved) {
      const el = this.byId.get(id)!;
      el.x += dx;
      el.y += dy;
      this.touch(el);
    }
    for (const id of ids) {
      for (const a of this.arrowsBoundTo(id)) {
        if (moved.has(a.id)) continue;
        if (a.startBinding?.elementId === id) this.setEndpoint(a, 'start', (p) => ({ x: p.x + dx, y: p.y + dy }));
        if (a.endBinding?.elementId === id) this.setEndpoint(a, 'end', (p) => ({ x: p.x + dx, y: p.y + dy }));
      }
    }
  }

  resize(id: string, nb: Box) {
    const el = this.byId.get(id);
    if (!el || el.locked) return;
    const ob = this.box(el);
    const sx = ob.w ? nb.w / ob.w : 1;
    const sy = ob.h ? nb.h / ob.h : 1;
    const map = (p: Pt): Pt => ({ x: nb.x + (p.x - ob.x) * sx, y: nb.y + (p.y - ob.y) * sy });
    if (LINEAR.has(el.type) || el.type === 'freedraw') {
      const abs = el.points.map((p: number[]) => map({ x: el.x + p[0], y: el.y + p[1] }));
      el.x = abs[0].x;
      el.y = abs[0].y;
      el.points = abs.map((p: Pt) => [p.x - el.x, p.y - el.y]);
      this.normalize(el);
      this.placeLabel(el);
    } else if (el.type === 'text') {
      el.fontSize = Math.max(4, (el.fontSize ?? 20) * sy);
      el.x = nb.x;
      el.y = nb.y;
      this.wrapInto(el);
    } else {
      el.x = nb.x;
      el.y = nb.y;
      el.width = Math.max(1, nb.w);
      el.height = Math.max(1, nb.h);
      this.placeLabel(el);
      for (const a of this.arrowsBoundTo(id)) {
        if (a.startBinding?.elementId === id) this.setEndpoint(a, 'start', map);
        if (a.endBinding?.elementId === id) this.setEndpoint(a, 'end', map);
      }
    }
    this.touch(el);
  }

  textEdit(id: string): TextEdit | null {
    const el = this.byId.get(id);
    if (!el) return null;
    const t = el.type === 'text' ? el : this.boundText(el);
    if (!t && !CONTAINERS.has(el.type)) return null;
    const src = t ?? { fontSize: 20, fontFamily: 5, textAlign: 'center', strokeColor: el.strokeColor };
    const box = t ? { x: t.x, y: t.y, w: Math.max(t.width, 20), h: Math.max(t.height, (t.fontSize ?? 20) * 1.25) } : this.box(el);
    return {
      box,
      text: String(t?.originalText ?? t?.text ?? ''),
      fontSize: src.fontSize ?? 20,
      font: fontStack(src.fontFamily ?? 1),
      align: (src.textAlign ?? 'left') as TextEdit['align'],
      color: src.strokeColor ?? '#1e1e1e',
    };
  }

  setText(id: string, text: string) {
    const el = this.byId.get(id);
    if (!el) return;
    if (el.type === 'text') {
      if (!text.trim()) return this.remove([id]);
      el.text = el.originalText = text;
      this.wrapInto(el, el.containerId ? this.byId.get(el.containerId) : undefined);
      if (el.containerId && this.byId.get(el.containerId)) this.placeLabel(this.byId.get(el.containerId)!);
      this.touch(el);
      return;
    }
    let t = this.boundText(el);
    if (!text.trim()) {
      if (t) this.remove([t.id]);
      return;
    }
    if (!t) {
      t = this.newElement('text', el.x, el.y, {
        text,
        originalText: text,
        fontSize: 20,
        fontFamily: 5,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: el.id,
        lineHeight: 1.25,
        autoResize: true,
        strokeColor: el.strokeColor ?? '#1e1e1e',
        groupIds: [...(el.groupIds ?? [])],
      });
      const at = this.doc.elements.indexOf(el);
      this.doc.elements.splice(at + 1, 0, t);
      this.byId.set(t.id, t);
      el.boundElements = [...(el.boundElements ?? []), { type: 'text', id: t.id }];
      this.touch(el);
    }
    t.originalText = text;
    this.placeLabel(el);
  }

  private nextIndex(): string | undefined {
    const idx = this.doc.elements.map((e) => e.index).filter((v): v is string => typeof v === 'string');
    if (!idx.length) return undefined;
    return idx.sort()[idx.length - 1] + 'V';
  }

  private newElement(type: string, x: number, y: number, extra: Record<string, unknown> = {}): El {
    const el: El = {
      id: randomId(),
      type,
      x,
      y,
      width: 0,
      height: 0,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: rand(),
      version: 1,
      versionNonce: rand(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      ...extra,
    };
    const index = this.nextIndex();
    if (index) el.index = index;
    if (type === 'text') this.wrapInto(el, el.containerId ? this.byId.get(el.containerId as string) : undefined);
    return el;
  }

  /** The shape a connector end attaches to (not lines, text or frames). */
  private bindable(id?: string): El | undefined {
    const el = id ? this.byId.get(id) : undefined;
    return el && !el.isDeleted && ['rectangle', 'ellipse', 'diamond', 'image', 'iframe', 'embeddable', 'frame'].includes(el.type) ? el : undefined;
  }

  create(tool: Tool, a: Pt, b: Pt, opts: CreateOptions = {}): string | null {
    let el: El;
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    switch (tool) {
      case 'rect':
        el = this.newElement('rectangle', box.x, box.y, { width: box.w, height: box.h, roundness: { type: 3 } });
        break;
      case 'ellipse':
        el = this.newElement('ellipse', box.x, box.y, { width: box.w, height: box.h });
        break;
      case 'diamond':
        el = this.newElement('diamond', box.x, box.y, { width: box.w, height: box.h, roundness: { type: 2 } });
        break;
      case 'text':
        el = this.newElement('text', a.x, a.y, { text: '', originalText: '', fontSize: 20, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true });
        break;
      case 'arrow':
      case 'line': {
        const arrow = tool === 'arrow';
        el = this.newElement(arrow ? 'arrow' : 'line', a.x, a.y, {
          points: [
            [0, 0],
            [b.x - a.x, b.y - a.y],
          ],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: arrow ? 'arrow' : null,
          roundness: arrow ? { type: 2 } : null,
          elbowed: false,
        });
        this.normalize(el);
        if (arrow) {
          for (const [end, sid] of [
            ['start', opts.startId],
            ['end', opts.endId],
          ] as const) {
            const target = this.bindable(sid);
            if (!target) continue;
            el[`${end}Binding`] = { elementId: target.id, focus: 0, gap: 4 };
            target.boundElements = [...(target.boundElements ?? []), { id: el.id, type: 'arrow' }];
            this.touch(target);
          }
        }
        break;
      }
      case 'draw': {
        const pts = opts.points?.length ? opts.points : [a, b];
        el = this.newElement('freedraw', pts[0].x, pts[0].y, { points: pts.map((p) => [p.x - pts[0].x, p.y - pts[0].y]), pressures: [], simulatePressure: true, lastCommittedPoint: null });
        this.normalize(el);
        break;
      }
      default:
        return null;
    }
    this.doc.elements.push(el);
    this.byId.set(el.id, el);
    return el.id;
  }

  remove(ids: string[]) {
    const gone = new Set<string>();
    for (const id of ids) {
      const el = this.byId.get(id);
      if (!el) continue;
      gone.add(id);
      for (const r of el.boundElements ?? []) if (r.type === 'text') gone.add(r.id);
    }
    this.doc.elements = this.doc.elements.filter((e) => !gone.has(e.id));
    for (const e of this.doc.elements) {
      if (e.boundElements?.some((r: { id: string }) => gone.has(r.id))) {
        e.boundElements = e.boundElements.filter((r: { id: string }) => !gone.has(r.id));
        if (!e.boundElements.length) e.boundElements = null;
        this.touch(e);
      }
      for (const k of ['startBinding', 'endBinding']) {
        if (e[k] && gone.has(e[k].elementId)) {
          e[k] = null;
          this.touch(e);
        }
      }
      if (e.containerId && gone.has(e.containerId)) e.containerId = null;
    }
    this.reindex();
  }

  duplicate(ids: string[]): string[] {
    const all = new Set<string>();
    for (const id of this.expand(ids)) {
      all.add(id);
      const t = this.byId.get(id) && this.boundText(this.byId.get(id)!);
      if (t) all.add(t.id);
    }
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    for (const id of all) idMap.set(id, randomId());
    const copies: El[] = [];
    for (const el of this.doc.elements) {
      if (!all.has(el.id)) continue;
      const c: El = structuredClone(el);
      c.id = idMap.get(el.id)!;
      c.x += 10;
      c.y += 10;
      c.seed = rand();
      c.version = 1;
      c.versionNonce = rand();
      c.updated = Date.now();
      c.groupIds = (el.groupIds ?? []).map((g: string) => groupMap.get(g) ?? (groupMap.set(g, randomId()), groupMap.get(g)!));
      if (c.containerId) c.containerId = idMap.get(c.containerId) ?? null;
      if (c.boundElements) {
        c.boundElements = c.boundElements.filter((r: { id: string }) => idMap.has(r.id)).map((r: { id: string; type: string }) => ({ ...r, id: idMap.get(r.id)! }));
        if (!c.boundElements.length) c.boundElements = null;
      }
      for (const k of ['startBinding', 'endBinding']) if (c[k]) c[k] = idMap.has(c[k].elementId) ? { ...c[k], elementId: idMap.get(c[k].elementId) } : null;
      delete c.index;
      const index = this.nextIndex();
      if (index) c.index = index;
      copies.push(c);
      this.doc.elements.push(c);
      this.byId.set(c.id, c);
    }
    return copies.filter((c) => !this.isBoundText(c)).map((c) => c.id);
  }

  style(ids: string[]): BoardStyle {
    const el = this.byId.get(ids[0] ?? '');
    return {
      stroke: el?.strokeColor ?? '#1e1e1e',
      fill: !el?.backgroundColor || el.backgroundColor === 'transparent' ? '' : el.backgroundColor,
      width: el?.strokeWidth ?? 2,
      dash: el?.strokeStyle ?? 'solid',
      fillStyle: el?.fillStyle ?? 'solid',
      roughness: el?.roughness ?? 1,
    };
  }

  setStyle(ids: string[], s: Partial<BoardStyle>) {
    for (const id of ids) {
      const el = this.byId.get(id);
      if (!el) continue;
      const targets = [el, this.boundText(el)].filter(Boolean) as El[];
      for (const t of targets) {
        if (s.stroke !== undefined) t.strokeColor = s.stroke;
        if (t === el) {
          if (s.fill !== undefined) t.backgroundColor = s.fill || 'transparent';
          if (s.width !== undefined) t.strokeWidth = s.width;
          if (s.dash !== undefined) t.strokeStyle = s.dash;
          if (s.fillStyle !== undefined) t.fillStyle = s.fillStyle;
          if (s.roughness !== undefined) t.roughness = s.roughness;
        }
        this.touch(t);
      }
    }
  }

  reorder(ids: string[], where: 'front' | 'back') {
    const pick = new Set<string>();
    for (const id of ids) {
      pick.add(id);
      const t = this.byId.get(id) && this.boundText(this.byId.get(id)!);
      if (t) pick.add(t.id);
    }
    const moving = this.doc.elements.filter((e) => pick.has(e.id));
    const rest = this.doc.elements.filter((e) => !pick.has(e.id));
    this.doc.elements = where === 'front' ? [...rest, ...moving] : [...moving, ...rest];
    if (this.doc.elements.some((e) => typeof e.index === 'string')) this.doc.elements.forEach((e, i) => (e.index = indexKey(i)));
    for (const e of moving) this.touch(e);
  }
}

export { indexKey };
