// draw.io / diagrams.net (.drawio) diagrams: every page of the file
// (compressed or plain), drawn from its mxGraph cells — the common shapes,
// containers and swimlanes, HTML labels, and edges routed straight,
// orthogonally or curved with draw.io's arrowheads and labels — and edited
// in place: only the cells an edit touches change. Pages are written back
// uncompressed (draw.io's default, and it reads both).
import { esc, randomId, union, type BoardAdapter, type BoardItem, type BoardStyle, type Box, type CreateOptions, type Measure, type Pt, type TextEdit, type Tool } from './types';

export type Style = Map<string, string>;

export function parseStyle(s: string | null): Style {
  const m: Style = new Map();
  for (const part of (s ?? '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) m.set(part, '');
    else m.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return m;
}

export function styleString(m: Style): string {
  let s = '';
  for (const [k, v] of m) s += v === '' && !['fillColor', 'strokeColor', 'fontColor', 'image', 'label'].includes(k) ? `${k};` : `${k}=${v};`;
  return s;
}

/** Inflate a compressed page (base64 of raw deflate of the URI-encoded XML). */
export async function inflatePage(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const stream = new Response(bin).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  const text = await new Response(stream).text();
  return decodeURIComponent(text);
}

/** Expand every compressed page so the file can be edited synchronously. */
export async function expandFile(text: string): Promise<{ text: string; compressed: boolean }> {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) throw new Error("This isn't a valid draw.io file (the XML can't be read).");
  let compressed = false;
  for (const d of Array.from(doc.getElementsByTagName('diagram'))) {
    if (d.getElementsByTagName('mxGraphModel')[0]) continue;
    const raw = d.textContent?.trim();
    if (!raw) continue;
    compressed = true;
    const xml = await inflatePage(raw);
    const page = new DOMParser().parseFromString(xml, 'application/xml');
    if (page.getElementsByTagName('parsererror')[0]) throw new Error(`Page “${d.getAttribute('name') ?? ''}” can't be read.`);
    d.textContent = '';
    d.append(doc.importNode(page.documentElement, true));
  }
  return { text: compressed ? new XMLSerializer().serializeToString(doc) : text, compressed };
}

/** Plain text of an HTML label. */
export function htmlToText(v: string): string {
  if (!/[<&]/.test(v)) return v;
  const withBreaks = v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const t = new DOMParser().parseFromString(`<!doctype html><body>${withBreaks.replace(/</g, '&lt;')}`, 'text/html').body.textContent ?? '';
  return t.replace(/ /g, ' ').replace(/\n+$/, '');
}

interface Cell {
  el: Element; // the mxCell
  wrap: Element | null; // <object>/<UserObject> around it, which holds id and label
  id: string;
  parent: string;
  vertex: boolean;
  edge: boolean;
  style: Style;
}

const NUM = (v: string | null | undefined, d = 0) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export class DrawioBoard implements BoardAdapter {
  readonly tools: Tool[] = ['select', 'rect', 'ellipse', 'diamond', 'arrow', 'line', 'text'];
  readonly styleKeys: (keyof BoardStyle)[] = ['stroke', 'fill', 'width', 'dash'];
  xml!: XMLDocument;
  page = 0;
  private pagesEls: Element[] = [];
  private model!: Element;
  private rootEl!: Element;
  private cells = new Map<string, Cell>();
  private order: string[] = [];

  constructor(
    text: string,
    private measure: Measure,
  ) {
    this.load(text);
  }

  load(text: string) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror')[0]) throw new Error("This isn't a valid draw.io file (the XML can't be read).");
    this.xml = xml;
    const root = xml.documentElement;
    if (root.localName === 'mxGraphModel') this.pagesEls = [root];
    else if (root.localName === 'mxfile') this.pagesEls = Array.from(root.getElementsByTagName('diagram'));
    else throw new Error("This isn't a draw.io diagram.");
    if (!this.pagesEls.length) throw new Error('This draw.io file has no pages.');
    this.setPage(Math.min(this.page, this.pagesEls.length - 1));
  }

  pages(): string[] {
    return this.pagesEls.map((p, i) => (p.localName === 'diagram' ? p.getAttribute('name') || `Page ${i + 1}` : 'Page 1'));
  }

  setPage(i: number) {
    this.page = i;
    const p = this.pagesEls[i];
    const model = p.localName === 'mxGraphModel' ? p : p.getElementsByTagName('mxGraphModel')[0];
    if (!model) throw new Error('This page is compressed and needs expanding first.');
    this.model = model;
    let root = model.getElementsByTagName('root')[0];
    if (!root) {
      root = this.xml.createElement('root');
      model.append(root);
    }
    this.rootEl = root;
    this.reindex();
  }

  private reindex() {
    this.cells.clear();
    this.order = [];
    for (const n of Array.from(this.rootEl.children)) {
      let el = n;
      let wrap: Element | null = null;
      if (n.localName !== 'mxCell') {
        const inner = n.getElementsByTagName('mxCell')[0];
        if (!inner) continue;
        wrap = n;
        el = inner;
      }
      const id = (wrap ?? el).getAttribute('id') ?? '';
      if (!id) continue;
      const c: Cell = { el, wrap, id, parent: el.getAttribute('parent') ?? '', vertex: el.getAttribute('vertex') === '1', edge: el.getAttribute('edge') === '1', style: parseStyle(el.getAttribute('style')) };
      this.cells.set(id, c);
      this.order.push(id);
    }
  }

  serialize(): string {
    let s = new XMLSerializer().serializeToString(this.xml);
    if (!s.startsWith('<?xml') && this.xml.documentElement.localName === 'mxGraphModel') s = s.trimStart();
    return s;
  }

  background(): string {
    const bg = this.model.getAttribute('background');
    return bg && bg !== 'none' ? bg : '#ffffff';
  }

  // ---------- geometry ----------

  private geo(c: Cell): Element | null {
    for (const g of Array.from(c.el.children)) if (g.localName === 'mxGeometry') return g;
    return null;
  }

  private isLayer(id: string): boolean {
    const c = this.cells.get(id);
    if (!c) return false;
    const p = this.cells.get(c.parent);
    return !c.vertex && !c.edge && (!c.parent || (p !== undefined && !p.parent));
  }

  /** Absolute origin of a cell's children (sum of ancestor vertex positions). */
  private origin(parentId: string): Pt {
    let x = 0;
    let y = 0;
    let p = this.cells.get(parentId);
    for (let i = 0; p && p.vertex && i < 64; i++) {
      const g = this.geo(p);
      x += NUM(g?.getAttribute('x'));
      y += NUM(g?.getAttribute('y'));
      p = this.cells.get(p.parent);
    }
    return { x, y };
  }

  vbox(c: Cell): Box {
    const g = this.geo(c);
    const o = this.origin(c.parent);
    return { x: o.x + NUM(g?.getAttribute('x')), y: o.y + NUM(g?.getAttribute('y')), w: NUM(g?.getAttribute('width')), h: NUM(g?.getAttribute('height')) };
  }

  private isEdgeLabel(c: Cell): boolean {
    return c.vertex && !!this.cells.get(c.parent)?.edge;
  }

  private visible(c: Cell): boolean {
    for (let p: Cell | undefined = c, i = 0; p && i < 64; p = this.cells.get(p.parent), i++) {
      if (p.el.getAttribute('visible') === '0') return false;
      if (p !== c && p.vertex && p.el.getAttribute('collapsed') === '1') return false;
    }
    return true;
  }

  /** In a group (style "group"): selected with the group. */
  private groupOf(c: Cell): Cell | undefined {
    let top: Cell | undefined;
    for (let p = this.cells.get(c.parent), i = 0; p && p.vertex && i < 64; p = this.cells.get(p.parent), i++) if (p.style.has('group')) top = p;
    return top;
  }

  // ---------- edges ----------

  private perimeterPoint(c: Cell, toward: Pt): Pt {
    const b = this.vbox(c);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const shape = this.shapeName(c);
    if (shape === 'ellipse' || shape === 'doubleEllipse') {
      const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2 || 1) + (dy * dy) / ((b.h / 2) ** 2 || 1));
      return { x: cx + dx * t, y: cy + dy * t };
    }
    if (shape === 'rhombus') {
      const t = 1 / (Math.abs(dx) / (b.w / 2 || 1) + Math.abs(dy) / (b.h / 2 || 1));
      return { x: cx + dx * t, y: cy + dy * t };
    }
    const t = Math.min(Math.abs(dx) > 1e-9 ? b.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? b.h / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  private fixedPoint(c: Cell, fx: string | undefined, fy: string | undefined): Pt | null {
    if (fx === undefined || fy === undefined) return null;
    const b = this.vbox(c);
    return { x: b.x + NUM(fx) * b.w, y: b.y + NUM(fy) * b.h };
  }

  /** The polyline of an edge, in absolute coordinates. */
  edgePoints(c: Cell): Pt[] {
    const g = this.geo(c);
    const o = this.origin(c.parent);
    const pt = (as: string): Pt | null => {
      const p = g ? Array.from(g.children).find((e) => e.localName === 'mxPoint' && e.getAttribute('as') === as) : undefined;
      return p ? { x: o.x + NUM(p.getAttribute('x')), y: o.y + NUM(p.getAttribute('y')) } : null;
    };
    const arr = g ? Array.from(g.children).find((e) => e.localName === 'Array' && e.getAttribute('as') === 'points') : undefined;
    const way: Pt[] = arr ? Array.from(arr.children).map((p) => ({ x: o.x + NUM(p.getAttribute('x')), y: o.y + NUM(p.getAttribute('y')) })) : [];
    const src = this.cells.get(c.el.getAttribute('source') ?? '');
    const tgt = this.cells.get(c.el.getAttribute('target') ?? '');
    const st = c.style;
    const center = (x: Cell) => {
      const b = this.vbox(x);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    };
    const sFixed = src ? this.fixedPoint(src, st.get('exitX'), st.get('exitY')) : null;
    const tFixed = tgt ? this.fixedPoint(tgt, st.get('entryX'), st.get('entryY')) : null;
    const style = st.get('edgeStyle') ?? '';
    const orth = /orthogonal|elbow|entityRelation|segment/i.test(style);
    let s: Pt;
    let t: Pt;
    const sAim = way[0] ?? tFixed ?? (tgt ? center(tgt) : pt('targetPoint')) ?? { x: 0, y: 0 };
    const tAim = way[way.length - 1] ?? sFixed ?? (src ? center(src) : pt('sourcePoint')) ?? { x: 0, y: 0 };
    if (src) {
      if (sFixed) s = sFixed;
      else if (orth) {
        const b = this.vbox(src);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const horiz = style.includes('elbow') && st.get('elbow') === 'vertical' ? false : Math.abs(sAim.x - cx) * b.h >= Math.abs(sAim.y - cy) * b.w;
        s = horiz ? { x: sAim.x >= cx ? b.x + b.w : b.x, y: way.length ? Math.min(Math.max(sAim.y, b.y), b.y + b.h) : cy } : { x: way.length ? Math.min(Math.max(sAim.x, b.x), b.x + b.w) : cx, y: sAim.y >= cy ? b.y + b.h : b.y };
      } else s = this.perimeterPoint(src, sAim);
    } else s = pt('sourcePoint') ?? sAim;
    if (tgt) {
      if (tFixed) t = tFixed;
      else if (orth) {
        const b = this.vbox(tgt);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const from = way[way.length - 1] ?? s;
        const horiz = style.includes('elbow') && st.get('elbow') === 'vertical' ? false : Math.abs(from.x - cx) * b.h >= Math.abs(from.y - cy) * b.w;
        t = horiz ? { x: from.x >= cx ? b.x + b.w : b.x, y: way.length ? Math.min(Math.max(from.y, b.y), b.y + b.h) : cy } : { x: way.length ? Math.min(Math.max(from.x, b.x), b.x + b.w) : cx, y: from.y >= cy ? b.y + b.h : b.y };
      } else t = this.perimeterPoint(tgt, tAim);
    } else t = pt('targetPoint') ?? tAim;
    const pts = [s, ...way, t];
    if (!orth) return pts;
    // Orthogonal: add corners between points that aren't aligned.
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1];
      const b = pts[i];
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
        const horizontalFirst = i === 1 ? Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) || (src !== undefined && (a.x === this.vbox(src).x || a.x === this.vbox(src).x + this.vbox(src).w)) : out.length >= 2 && out[out.length - 2].x === a.x;
        if (horizontalFirst && i === pts.length - 1 && pts.length === 2) {
          const mx = (a.x + b.x) / 2;
          out.push({ x: mx, y: a.y }, { x: mx, y: b.y });
        } else if (!horizontalFirst && i === pts.length - 1 && pts.length === 2) {
          const my = (a.y + b.y) / 2;
          out.push({ x: a.x, y: my }, { x: b.x, y: my });
        } else out.push(horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
      }
      out.push(b);
    }
    return out;
  }

  private pathD(pts: Pt[], style: Style): string {
    if (style.get('curved') === '1' && pts.length > 2) {
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
        d += `Q${pts[i].x},${pts[i].y} ${i === pts.length - 2 ? `${pts[i + 1].x},${pts[i + 1].y}` : `${m.x},${m.y}`}`;
      }
      return d;
    }
    if (style.get('rounded') === '1' && pts.length > 2) {
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const a = pts[i - 1];
        const b = pts[i + 1];
        const r = Math.min(10, Math.hypot(p.x - a.x, p.y - a.y) / 2, Math.hypot(b.x - p.x, b.y - p.y) / 2);
        const ua = { x: (a.x - p.x) / (Math.hypot(a.x - p.x, a.y - p.y) || 1), y: (a.y - p.y) / (Math.hypot(a.x - p.x, a.y - p.y) || 1) };
        const ub = { x: (b.x - p.x) / (Math.hypot(b.x - p.x, b.y - p.y) || 1), y: (b.y - p.y) / (Math.hypot(b.x - p.x, b.y - p.y) || 1) };
        d += `L${p.x + ua.x * r},${p.y + ua.y * r}Q${p.x},${p.y} ${p.x + ub.x * r},${p.y + ub.y * r}`;
      }
      return d + `L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
    }
    return `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`;
  }

  private marker(kind: string, tip: Pt, from: Pt, filled: boolean, color: string, sw: number, size: number): { svg: string; back: number } {
    const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const ux = (tip.x - from.x) / len;
    const uy = (tip.y - from.y) / len;
    const nx = -uy;
    const ny = ux;
    const L = size;
    const W = size / 2;
    const P = (along: number, side: number) => `${tip.x - ux * along + nx * side},${tip.y - uy * along + ny * side}`;
    const fill = filled ? color : '#ffffff';
    const poly = (pts: string[], f = fill) => `<polygon points="${pts.join(' ')}" fill="${f}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    const line = (a: string, b: string) => `<path d="M${a}L${b}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
    switch (kind) {
      case 'none':
      case '':
        return { svg: '', back: 0 };
      case 'block':
        return { svg: poly([P(0, 0), P(L, W), P(L, -W)]), back: L };
      case 'open':
        return { svg: `<path d="M${P(L, W)}L${P(0, 0)}L${P(L, -W)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`, back: 0 };
      case 'oval':
        return { svg: `<circle cx="${tip.x - (ux * L) / 2}" cy="${tip.y - (uy * L) / 2}" r="${L / 2}" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`, back: L };
      case 'diamond':
      case 'diamondThin': {
        const w = kind === 'diamond' ? W : W / 2;
        return { svg: poly([P(0, 0), P(L, w), P(2 * L, 0), P(L, -w)]), back: 2 * L };
      }
      case 'dash':
        return { svg: line(P(L / 2, W), P(L / 2 + 0.01, -W)), back: 0 };
      case 'cross':
        return { svg: line(P(L * 0.25, W), P(L, -W)) + line(P(L * 0.25, -W), P(L, W)), back: 0 };
      case 'ERone':
        return { svg: line(P(L, W), P(L, -W)), back: 0 };
      case 'ERmandOne':
        return { svg: line(P(L, W), P(L, -W)) + line(P(L * 1.5, W), P(L * 1.5, -W)), back: 0 };
      case 'ERmany':
      case 'ERoneToMany':
      case 'ERzeroToMany':
      case 'ERzeroToOne': {
        let s = kind === 'ERzeroToOne' ? line(P(L * 0.6, W), P(L * 0.6, -W)) : line(P(0, W), P(L, 0)) + line(P(0, -W), P(L, 0)) + line(P(0, 0), P(L, 0));
        if (kind === 'ERoneToMany') s += line(P(L * 1.4, W), P(L * 1.4, -W));
        if (kind === 'ERzeroToMany' || kind === 'ERzeroToOne') s += `<circle cx="${tip.x - ux * L * 1.6}" cy="${tip.y - uy * L * 1.6}" r="${W * 0.6}" fill="#fff" stroke="${color}" stroke-width="${sw}"/>`;
        return { svg: s, back: 0 };
      }
      default:
        // classic / classicThin / async …: a notched arrow
        return { svg: poly([P(0, 0), P(L, W), P(L * 0.7, 0), P(L, -W)]), back: L * 0.7 };
    }
  }

  // ---------- labels ----------

  private labelOf(c: Cell): string {
    if (c.wrap) return c.wrap.getAttribute('label') ?? '';
    return c.el.getAttribute('value') ?? '';
  }

  private plainLabel(c: Cell): string {
    const v = this.labelOf(c);
    return c.style.get('html') === '1' ? htmlToText(v) : v;
  }

  private fontOf(st: Style): { size: number; family: string; css: string; weight: string; italic: boolean; underline: boolean; color: string } {
    const size = NUM(st.get('fontSize'), 12);
    const fsBits = NUM(st.get('fontStyle'), 0);
    const family = st.get('fontFamily') || 'Helvetica';
    const fam = `"${family}", Helvetica, Arial, sans-serif`;
    const weight = fsBits & 1 ? 'bold' : 'normal';
    return { size, family: fam, css: `${fsBits & 2 ? 'italic ' : ''}${weight} ${size}px ${fam}`, weight, italic: !!(fsBits & 2), underline: !!(fsBits & 4), color: st.get('fontColor') && st.get('fontColor') !== 'default' ? st.get('fontColor')! : '#000000' };
  }

  private wrapLines(text: string, font: string, max: number): string[] {
    const out: string[] = [];
    for (const line of text.split('\n')) {
      let cur = '';
      for (const word of line.split(/(\s+)/)) {
        if (cur && this.measure((cur + word).trimEnd(), font) > max) {
          out.push(cur.trimEnd());
          cur = word.trimStart();
        } else cur += word;
      }
      out.push(cur);
    }
    return out;
  }

  private textSvg(text: string, st: Style, box: Box, bg?: string): string {
    if (!text || st.get('noLabel') === '1') return '';
    const f = this.fontOf(st);
    const sp = NUM(st.get('spacing'), 2);
    const inner = { x: box.x + sp + NUM(st.get('spacingLeft')), y: box.y + sp + NUM(st.get('spacingTop')), w: box.w - 2 * sp - NUM(st.get('spacingLeft')) - NUM(st.get('spacingRight')), h: box.h - 2 * sp - NUM(st.get('spacingTop')) - NUM(st.get('spacingBottom')) };
    const lines = st.get('whiteSpace') === 'wrap' && inner.w > 10 ? this.wrapLines(text, f.css, inner.w) : text.split('\n');
    const lh = f.size * 1.2;
    const align = st.get('align') ?? 'center';
    const valign = st.get('verticalAlign') ?? 'middle';
    // Labels placed outside the shape (e.g. under an actor).
    let ax = inner;
    const lp = st.get('labelPosition');
    const vlp = st.get('verticalLabelPosition');
    if (lp === 'left') ax = { ...inner, x: box.x - box.w, w: box.w };
    if (lp === 'right') ax = { ...inner, x: box.x + box.w, w: box.w };
    if (vlp === 'top') ax = { ...ax, y: box.y - box.h, h: box.h };
    if (vlp === 'bottom') ax = { ...ax, y: box.y + box.h, h: box.h };
    const x = align === 'left' ? ax.x : align === 'right' ? ax.x + ax.w : ax.x + ax.w / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const total = lines.length * lh;
    const top = valign === 'top' ? ax.y : valign === 'bottom' ? ax.y + ax.h - total : ax.y + (ax.h - total) / 2;
    let s = '';
    if (bg && bg !== 'none') {
      const w = Math.max(...lines.map((l) => this.measure(l, f.css))) + 4;
      const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      s += `<rect x="${bx}" y="${top}" width="${w}" height="${total}" fill="${esc(bg === 'default' ? this.background() : bg)}"/>`;
    }
    const deco = f.underline ? ' text-decoration="underline"' : '';
    s += `<text font-family="${esc(f.family)}" font-size="${f.size}" font-weight="${f.weight}"${f.italic ? ' font-style="italic"' : ''}${deco} fill="${esc(f.color)}" text-anchor="${anchor}" style="white-space: pre">${lines.map((l, i) => `<tspan x="${x}" y="${top + i * lh + f.size * 0.9}">${esc(l)}</tspan>`).join('')}</text>`;
    return s;
  }

  // ---------- drawing ----------

  private shapeName(c: Cell): string {
    const st = c.style;
    const sh = st.get('shape');
    if (sh) return sh;
    for (const k of ['ellipse', 'rhombus', 'triangle', 'hexagon', 'cylinder', 'cloud', 'swimlane', 'text', 'label', 'image', 'line', 'doubleEllipse', 'actor', 'process', 'document', 'parallelogram', 'trapezoid', 'step', 'card', 'note', 'callout', 'cross', 'umlActor', 'group', 'edgeLabel']) if (st.has(k)) return k;
    return 'rectangle';
  }

  render(): string {
    const out: string[] = [];
    // Edge labels are drawn with their edge.
    const labels = new Map<string, Cell[]>();
    for (const id of this.order) {
      const c = this.cells.get(id)!;
      if (this.isEdgeLabel(c)) {
        const list = labels.get(c.parent) ?? [];
        list.push(c);
        labels.set(c.parent, list);
      }
    }
    for (const id of this.order) {
      const c = this.cells.get(id)!;
      if (!this.visible(c) || this.isEdgeLabel(c)) continue;
      if (c.vertex) out.push(this.renderVertex(c));
      else if (c.edge) out.push(this.renderEdge(c, labels.get(id) ?? []));
    }
    return out.join('');
  }

  private paint(st: Style) {
    const fill = st.get('fillColor');
    const stroke = st.get('strokeColor');
    const sw = NUM(st.get('strokeWidth'), 1);
    const dash = st.get('dashed') === '1' ? ` stroke-dasharray="${esc(st.get('dashPattern') ?? `${3 * sw} ${3 * sw}`)}"` : '';
    const op = [st.get('opacity'), st.get('fillOpacity'), st.get('strokeOpacity')].map((v) => (v === undefined ? 1 : NUM(v, 100) / 100));
    return {
      fill: fill === undefined || fill === 'default' ? '#ffffff' : fill === 'none' ? 'none' : fill,
      stroke: stroke === undefined || stroke === 'default' ? '#000000' : stroke === 'none' ? 'none' : stroke,
      sw,
      attrs: `stroke-width="${sw}"${dash}${op[1] < 1 ? ` fill-opacity="${op[1]}"` : ''}${op[2] < 1 ? ` stroke-opacity="${op[2]}"` : ''}`,
      opacity: op[0],
    };
  }

  private renderVertex(c: Cell): string {
    const st = c.style;
    const b = this.vbox(c);
    const shape = this.shapeName(c);
    const p = this.paint(st);
    const text = this.plainLabel(c);
    const { x, y, w, h } = b;
    const common = `fill="${esc(p.fill)}" stroke="${esc(p.stroke)}" ${p.attrs}`;
    const poly = (pts: [number, number][]) => `<polygon points="${pts.map(([px, py]) => `${x + px * w},${y + py * h}`).join(' ')}" ${common}/>`;
    const rounded = st.get('rounded') === '1';
    const arc = st.get('absoluteArcSize') === '1' ? NUM(st.get('arcSize'), 10) / 2 : (Math.min(w, h) * NUM(st.get('arcSize'), 15)) / 100;
    let s = '';
    let labelBox = b;
    switch (shape) {
      case 'text':
      case 'label':
      case 'edgeLabel':
      case 'group':
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>`;
        if (shape === 'label' && p.stroke !== 'none' && st.has('strokeColor')) s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/>`;
        break;
      case 'ellipse':
        s = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
        break;
      case 'doubleEllipse':
        s = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 - 4}" ry="${h / 2 - 4}" fill="none" stroke="${esc(p.stroke)}" ${p.attrs}/>`;
        break;
      case 'rhombus':
        s = poly([
          [0.5, 0],
          [1, 0.5],
          [0.5, 1],
          [0, 0.5],
        ]);
        break;
      case 'triangle': {
        const dir = st.get('direction') ?? 'east';
        const pts: Record<string, [number, number][]> = {
          east: [
            [0, 0],
            [1, 0.5],
            [0, 1],
          ],
          west: [
            [1, 0],
            [0, 0.5],
            [1, 1],
          ],
          north: [
            [0, 1],
            [0.5, 0],
            [1, 1],
          ],
          south: [
            [0, 0],
            [1, 0],
            [0.5, 1],
          ],
        };
        s = poly(pts[dir] ?? pts.east);
        break;
      }
      case 'hexagon':
        s = poly([
          [0.25, 0],
          [0.75, 0],
          [1, 0.5],
          [0.75, 1],
          [0.25, 1],
          [0, 0.5],
        ]);
        break;
      case 'parallelogram':
        s = poly([
          [0.2, 0],
          [1, 0],
          [0.8, 1],
          [0, 1],
        ]);
        break;
      case 'trapezoid':
        s = poly([
          [0.2, 0],
          [0.8, 0],
          [1, 1],
          [0, 1],
        ]);
        break;
      case 'step':
        s = poly([
          [0, 0],
          [0.8, 0],
          [1, 0.5],
          [0.8, 1],
          [0, 1],
          [0.2, 0.5],
        ]);
        break;
      case 'card':
        s = poly([
          [0.2, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0.3],
        ]);
        break;
      case 'cross':
        s = poly([
          [0.35, 0],
          [0.65, 0],
          [0.65, 0.35],
          [1, 0.35],
          [1, 0.65],
          [0.65, 0.65],
          [0.65, 1],
          [0.35, 1],
          [0.35, 0.65],
          [0, 0.65],
          [0, 0.35],
          [0.35, 0.35],
        ]);
        break;
      case 'cylinder':
      case 'cylinder3': {
        const ry = Math.min(15, h * 0.15);
        s = `<path d="M${x},${y + ry}A${w / 2},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${w / 2},${ry} 0 0 1 ${x},${y + h - ry}Z" ${common}/><path d="M${x},${y + ry}A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}" fill="none" stroke="${esc(p.stroke)}" ${p.attrs}/>`;
        break;
      }
      case 'document': {
        const wave = h * 0.15;
        s = `<path d="M${x},${y}H${x + w}V${y + h - wave}C${x + w * 0.75},${y + h - wave * 2.2} ${x + w * 0.25},${y + h + wave * 0.6} ${x},${y + h - wave * 0.4}Z" ${common}/>`;
        break;
      }
      case 'process':
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/><path d="M${x + w * 0.1},${y}V${y + h}M${x + w * 0.9},${y}V${y + h}" stroke="${esc(p.stroke)}" ${p.attrs} fill="none"/>`;
        break;
      case 'note': {
        const f = Math.min(30, w * 0.3, h * 0.3);
        s = `<path d="M${x},${y}H${x + w - f}L${x + w},${y + f}V${y + h}H${x}Z" ${common}/><path d="M${x + w - f},${y}V${y + f}H${x + w}" fill="none" stroke="${esc(p.stroke)}" ${p.attrs}/>`;
        break;
      }
      case 'callout': {
        const bh = h * 0.7;
        s = `<path d="M${x},${y}H${x + w}V${y + bh}H${x + w * 0.5}L${x + w * 0.3},${y + h}L${x + w * 0.3},${y + bh}H${x}Z" ${common}/>`;
        labelBox = { x, y, w, h: bh };
        break;
      }
      case 'cloud':
        s = `<path d="M${x + w * 0.25},${y + h * 0.25}C${x + w * 0.05},${y + h * 0.25} ${x},${y + h * 0.5} ${x + w * 0.16},${y + h * 0.55}C${x},${y + h * 0.6} ${x + w * 0.02},${y + h * 0.9} ${x + w * 0.3},${y + h * 0.8}C${x + w * 0.35},${y + h} ${x + w * 0.65},${y + h} ${x + w * 0.7},${y + h * 0.8}C${x + w * 0.98},${y + h * 0.8} ${x + w},${y + h * 0.5} ${x + w * 0.85},${y + h * 0.4}C${x + w},${y + h * 0.15} ${x + w * 0.75},${y} ${x + w * 0.6},${y + h * 0.1}C${x + w * 0.5},${y - h * 0.05} ${x + w * 0.3},${y} ${x + w * 0.25},${y + h * 0.25}Z" ${common}/>`;
        break;
      case 'actor':
      case 'umlActor': {
        const cx = x + w / 2;
        const hr = Math.min(w, h) / 6;
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/><circle cx="${cx}" cy="${y + hr}" r="${hr}" ${common}/><path d="M${cx},${y + 2 * hr}V${y + h * 0.7}M${x},${y + h * 0.4}H${x + w}M${cx},${y + h * 0.7}L${x},${y + h}M${cx},${y + h * 0.7}L${x + w},${y + h}" fill="none" stroke="${esc(p.stroke)}" ${p.attrs}/>`;
        break;
      }
      case 'line':
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/><line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="${esc(p.stroke)}" ${p.attrs}/>`;
        break;
      case 'image': {
        const src = st.get('image') ?? '';
        const ok = src.startsWith('data:');
        s = ok ? `<image href="${esc(src.replace(/^data:image\/(\w+),(?!.*;base64)/, 'data:image/$1;base64,'))}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${st.get('imageAspect') === '0' ? 'none' : 'xMidYMid meet'}"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f4f4f4" stroke="#bbb" stroke-dasharray="4 3"/>`;
        if (!st.has('verticalLabelPosition')) labelBox = { x, y: y + h, w, h: 20 };
        break;
      }
      case 'swimlane': {
        const ss = NUM(st.get('startSize'), 23);
        const horiz = st.get('horizontal') !== '0';
        const head = horiz ? { x, y, w, h: ss } : { x, y, w: ss, h };
        const r = rounded ? ` rx="${Math.min(arc, 8)}"` : '';
        const bodyFill = st.get('swimlaneFillColor') ?? 'none';
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(bodyFill === 'default' ? '#fff' : bodyFill)}" stroke="${esc(p.stroke)}" ${p.attrs}${r}/><rect x="${head.x}" y="${head.y}" width="${head.w}" height="${head.h}" ${common}${r}/>`;
        labelBox = head;
        if (!horiz) {
          // Vertical swimlane: the title runs up the side.
          const f = this.fontOf(st);
          return `<g data-id="${esc(c.id)}"${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}>${s}<text transform="translate(${head.x + head.w / 2 + f.size * 0.35} ${head.y + head.h / 2}) rotate(-90)" text-anchor="middle" font-family="${esc(f.family)}" font-size="${f.size}" font-weight="${f.weight}" fill="${esc(f.color)}">${esc(text)}</text></g>`;
        }
        return `<g data-id="${esc(c.id)}"${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}>${s}${this.textSvg(text, new Map([...st, ['verticalAlign', 'middle'], ['whiteSpace', '']]), labelBox)}</g>`;
      }
      default: {
        // rectangle and anything we don't draw specially (stencils show as boxes)
        const r = rounded ? ` rx="${Math.min(arc, w / 2, h / 2)}"` : '';
        s = `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r} ${common}/>`;
        if (shape.startsWith('mxgraph.') && !text) s += `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#999">${esc(shape.replace(/^mxgraph\./, ''))}</text>`;
      }
    }
    const rot = NUM(st.get('rotation'));
    const tr = rot ? ` transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"` : '';
    return `<g data-id="${esc(c.id)}"${tr}${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}>${s}${this.textSvg(text, st, labelBox, st.get('labelBackgroundColor'))}</g>`;
  }

  private pointAlong(pts: Pt[], t: number): { p: Pt; dir: Pt } {
    let total = 0;
    const segs = pts.slice(1).map((p, i) => {
      const l = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
      total += l;
      return l;
    });
    let want = total * Math.min(1, Math.max(0, t));
    for (let i = 0; i < segs.length; i++) {
      if (want <= segs[i] || i === segs.length - 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const k = segs[i] ? want / segs[i] : 0;
        return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: { x: (b.x - a.x) / (segs[i] || 1), y: (b.y - a.y) / (segs[i] || 1) } };
      }
      want -= segs[i];
    }
    return { p: pts[0], dir: { x: 1, y: 0 } };
  }

  private renderEdge(c: Cell, labels: Cell[]): string {
    const st = c.style;
    const pts = this.edgePoints(c);
    if (pts.length < 2) return '';
    const p = this.paint(st);
    const color = p.stroke === 'none' ? '#000' : p.stroke;
    const size = NUM(st.get('endSize'), 6) + p.sw * 1.5;
    const ssize = NUM(st.get('startSize'), 6) + p.sw * 1.5;
    const end = this.marker(st.get('endArrow') ?? 'classic', pts[pts.length - 1], pts[pts.length - 2], st.get('endFill') !== '0', color, p.sw, size);
    const start = this.marker(st.get('startArrow') ?? 'none', pts[0], pts[1], st.get('startFill') !== '0', color, p.sw, ssize);
    const line = pts.map((q) => ({ ...q }));
    const shorten = (i: number, j: number, by: number) => {
      if (!by) return;
      const a = line[i];
      const b = line[j];
      const l = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      line[i] = { x: a.x + ((b.x - a.x) / l) * Math.min(by, l), y: a.y + ((b.y - a.y) / l) * Math.min(by, l) };
    };
    shorten(line.length - 1, line.length - 2, end.back);
    shorten(0, 1, start.back);
    const d = this.pathD(line, st);
    let s = `<path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="${esc(color)}" ${p.attrs} stroke-linejoin="round"/>${end.svg}${start.svg}`;
    // The edge's own label, then label cells.
    const own = this.plainLabel(c);
    const g = this.geo(c);
    const at = (rx: number, offset: Element | undefined, extraY = 0) => {
      const { p: q, dir } = this.pointAlong(pts, (rx + 1) / 2);
      return { x: q.x + NUM(offset?.getAttribute('x')) - dir.y * extraY, y: q.y + NUM(offset?.getAttribute('y')) + dir.x * extraY };
    };
    const off = (el: Element | null | undefined) => (el ? Array.from(el.children).find((e) => e.localName === 'mxPoint' && e.getAttribute('as') === 'offset') : undefined);
    const drawLabel = (text: string, ls: Style, q: Pt) => {
      const f = this.fontOf(ls);
      const lines = text.split('\n');
      const w = Math.max(...lines.map((l) => this.measure(l, f.css))) + 4;
      const hgt = lines.length * f.size * 1.2;
      return this.textSvg(text, new Map([...ls, ['align', 'center'], ['verticalAlign', 'middle'], ['whiteSpace', ''], ['spacing', '0']]), { x: q.x - w / 2, y: q.y - hgt / 2, w, h: hgt }, ls.get('labelBackgroundColor') ?? 'default');
    };
    if (own) s += drawLabel(own, st, at(NUM(g?.getAttribute('x')), off(g), NUM(g?.getAttribute('y'))));
    for (const lc of labels) {
      const text = this.plainLabel(lc);
      if (!text) continue;
      const lg = this.geo(lc);
      s += drawLabel(text, lc.style, at(NUM(lg?.getAttribute('x')), off(lg), NUM(lg?.getAttribute('y'))));
    }
    return `<g data-id="${esc(c.id)}"${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}>${s}</g>`;
  }

  // ---------- items ----------

  private selectable(c: Cell): boolean {
    return (c.vertex || c.edge) && !this.isEdgeLabel(c) && this.visible(c) && !this.groupOf(c);
  }

  private cellBox(c: Cell): Box {
    if (c.edge) {
      const pts = this.edgePoints(c);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return this.vbox(c);
  }

  items(): BoardItem[] {
    const out: BoardItem[] = [];
    for (const id of this.order) {
      const c = this.cells.get(id)!;
      if (this.selectable(c)) out.push({ id, box: this.cellBox(c), linear: c.edge, text: true });
    }
    return out;
  }

  item(id: string): BoardItem | undefined {
    const c = this.cells.get(id);
    return c && (c.vertex || c.edge) ? { id, box: this.cellBox(c), linear: c.edge, text: true } : undefined;
  }

  bounds(): Box {
    const boxes: Box[] = [];
    for (const id of this.order) {
      const c = this.cells.get(id)!;
      if ((c.vertex || c.edge) && this.visible(c) && !this.isEdgeLabel(c)) boxes.push(this.cellBox(c));
    }
    return union(boxes);
  }

  expand(ids: string[]): string[] {
    const out = new Set<string>();
    for (const id of ids) {
      const c = this.cells.get(id);
      if (!c) continue;
      out.add(this.groupOf(c)?.id ?? id);
    }
    return [...out];
  }

  // ---------- editing ----------

  private ensureGeo(c: Cell): Element {
    let g = this.geo(c);
    if (!g) {
      g = this.xml.createElement('mxGeometry');
      g.setAttribute('as', 'geometry');
      if (c.edge) g.setAttribute('relative', '1');
      c.el.append(g);
    }
    return g;
  }

  private shiftPoint(el: Element, dx: number, dy: number) {
    const r = (v: number) => String(Math.round(v * 100) / 100);
    el.setAttribute('x', r(NUM(el.getAttribute('x')) + dx));
    el.setAttribute('y', r(NUM(el.getAttribute('y')) + dy));
  }

  move(ids: string[], dx: number, dy: number) {
    const set = new Set(ids);
    for (const id of ids) {
      const c = this.cells.get(id);
      if (!c) continue;
      // Children move with a moved ancestor.
      let anc = this.cells.get(c.parent);
      let skip = false;
      for (let i = 0; anc && i < 64; anc = this.cells.get(anc.parent), i++) if (set.has(anc.id)) skip = true;
      if (skip) continue;
      const g = this.ensureGeo(c);
      if (c.vertex) this.shiftPoint(g, dx, dy);
      else {
        for (const p of Array.from(g.children)) {
          if (p.localName === 'Array') for (const q of Array.from(p.children)) this.shiftPoint(q, dx, dy);
          else if (p.localName === 'mxPoint' && ((p.getAttribute('as') === 'sourcePoint' && !c.el.getAttribute('source')) || (p.getAttribute('as') === 'targetPoint' && !c.el.getAttribute('target')))) this.shiftPoint(p, dx, dy);
        }
      }
    }
    // Waypoints of edges between moved cells move too.
    for (const c of this.cells.values()) {
      if (!c.edge || set.has(c.id)) continue;
      const s = c.el.getAttribute('source');
      const t = c.el.getAttribute('target');
      if (s && t && this.movedWith(s, set) && this.movedWith(t, set)) {
        const arr = this.geo(c) ? Array.from(this.geo(c)!.children).find((e) => e.localName === 'Array') : undefined;
        for (const q of arr ? Array.from(arr.children) : []) this.shiftPoint(q, dx, dy);
      }
    }
  }

  private movedWith(id: string, set: Set<string>): boolean {
    for (let c = this.cells.get(id), i = 0; c && i < 64; c = this.cells.get(c.parent), i++) if (set.has(c.id)) return true;
    return false;
  }

  resize(id: string, nb: Box) {
    const c = this.cells.get(id);
    if (!c) return;
    if (c.edge) {
      const ob = this.cellBox(c);
      const sx = ob.w ? nb.w / ob.w : 1;
      const sy = ob.h ? nb.h / ob.h : 1;
      const o = this.origin(c.parent);
      for (const p of Array.from(this.ensureGeo(c).children)) {
        const pts = p.localName === 'Array' ? Array.from(p.children) : p.localName === 'mxPoint' && p.getAttribute('as') !== 'offset' ? [p] : [];
        for (const q of pts) {
          const ax = o.x + NUM(q.getAttribute('x'));
          const ay = o.y + NUM(q.getAttribute('y'));
          q.setAttribute('x', String(Math.round((nb.x + (ax - ob.x) * sx - o.x) * 100) / 100));
          q.setAttribute('y', String(Math.round((nb.y + (ay - ob.y) * sy - o.y) * 100) / 100));
        }
      }
      return;
    }
    const g = this.ensureGeo(c);
    const o = this.origin(c.parent);
    g.setAttribute('x', String(Math.round((nb.x - o.x) * 100) / 100));
    g.setAttribute('y', String(Math.round((nb.y - o.y) * 100) / 100));
    g.setAttribute('width', String(Math.max(1, Math.round(nb.w * 100) / 100)));
    g.setAttribute('height', String(Math.max(1, Math.round(nb.h * 100) / 100)));
  }

  private labelCell(c: Cell): Cell {
    if (c.edge && !this.labelOf(c)) {
      const child = [...this.cells.values()].find((x) => x.parent === c.id && x.vertex && this.labelOf(x));
      if (child) return child;
    }
    return c;
  }

  textEdit(id: string): TextEdit | null {
    const c = this.cells.get(id);
    if (!c) return null;
    const lc = this.labelCell(c);
    const f = this.fontOf(lc.style);
    let box = this.cellBox(c);
    if (c.edge) {
      const { p } = this.pointAlong(this.edgePoints(c), 0.5);
      box = { x: p.x - 60, y: p.y - f.size, w: 120, h: f.size * 2.4 };
    }
    return { box, text: this.plainLabel(lc), fontSize: f.size, font: f.family, align: (lc.style.get('align') ?? 'center') as TextEdit['align'], color: f.color };
  }

  setText(id: string, text: string) {
    const c = this.cells.get(id);
    if (!c) return;
    const lc = this.labelCell(c);
    const html = lc.style.get('html') === '1';
    const v = html ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : text;
    if (lc.wrap) lc.wrap.setAttribute('label', v);
    else lc.el.setAttribute('value', v);
    if (c.style.has('text') && !text.trim()) this.remove([id]);
  }

  private defaultParent(): string {
    for (const id of this.order) if (this.isLayer(id)) return id;
    // No layer: make the usual 0 / 1 pair.
    const root = this.xml.createElement('mxCell');
    root.setAttribute('id', '0');
    const layer = this.xml.createElement('mxCell');
    layer.setAttribute('id', '1');
    layer.setAttribute('parent', '0');
    this.rootEl.prepend(root, layer);
    this.reindex();
    return '1';
  }

  private newId(): string {
    let id: string;
    do id = `${randomId(16)}-1`;
    while (this.cells.has(id));
    return id;
  }

  create(tool: Tool, a: Pt, b: Pt, opts: CreateOptions = {}): string | null {
    const parent = this.defaultParent();
    const id = this.newId();
    const cell = this.xml.createElement('mxCell');
    cell.setAttribute('id', id);
    cell.setAttribute('value', '');
    const g = this.xml.createElement('mxGeometry');
    g.setAttribute('as', 'geometry');
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    const styles: Partial<Record<Tool, string>> = {
      rect: 'rounded=0;whiteSpace=wrap;html=1;',
      ellipse: 'ellipse;whiteSpace=wrap;html=1;',
      diamond: 'rhombus;whiteSpace=wrap;html=1;',
      text: 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;',
    };
    if (tool === 'arrow' || tool === 'line') {
      const src = opts.startId && this.cells.get(opts.startId)?.vertex ? opts.startId : '';
      const tgt = opts.endId && this.cells.get(opts.endId)?.vertex ? opts.endId : '';
      cell.setAttribute('style', `${src && tgt ? 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;' : ''}${tool === 'line' ? 'endArrow=none;' : 'endArrow=classic;'}html=1;`);
      cell.setAttribute('edge', '1');
      cell.setAttribute('parent', parent);
      if (src) cell.setAttribute('source', src);
      if (tgt) cell.setAttribute('target', tgt);
      g.setAttribute('relative', '1');
      g.setAttribute('width', '50');
      g.setAttribute('height', '50');
      for (const [as, p] of [
        ['sourcePoint', a],
        ['targetPoint', b],
      ] as const) {
        const mp = this.xml.createElement('mxPoint');
        mp.setAttribute('x', String(Math.round(p.x)));
        mp.setAttribute('y', String(Math.round(p.y)));
        mp.setAttribute('as', as);
        g.append(mp);
      }
    } else if (styles[tool]) {
      cell.setAttribute('style', styles[tool]!);
      cell.setAttribute('vertex', '1');
      cell.setAttribute('parent', parent);
      if (tool === 'text') {
        box.w = Math.max(box.w, 60);
        box.h = Math.max(box.h, 30);
      }
      g.setAttribute('x', String(Math.round(box.x)));
      g.setAttribute('y', String(Math.round(box.y)));
      g.setAttribute('width', String(Math.round(Math.max(box.w, 10))));
      g.setAttribute('height', String(Math.round(Math.max(box.h, 10))));
    } else return null;
    cell.append(g);
    this.rootEl.append(cell);
    this.reindex();
    return id;
  }

  private descendants(ids: Iterable<string>): Set<string> {
    const out = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of this.cells.values()) if (!out.has(c.id) && out.has(c.parent)) out.add(c.id), (grew = true);
    }
    return out;
  }

  remove(ids: string[]) {
    const gone = this.descendants(ids);
    // Edges connected to removed shapes go too (as in draw.io).
    for (const c of this.cells.values()) if (c.edge && (gone.has(c.el.getAttribute('source') ?? '') || gone.has(c.el.getAttribute('target') ?? ''))) gone.add(c.id);
    for (const id of this.descendants(gone)) {
      const c = this.cells.get(id);
      (c?.wrap ?? c?.el)?.remove();
    }
    this.reindex();
  }

  duplicate(ids: string[]): string[] {
    const all = this.descendants(ids);
    const map = new Map<string, string>();
    for (const id of all) map.set(id, this.newId());
    const top: string[] = [];
    for (const id of this.order) {
      if (!all.has(id)) continue;
      const c = this.cells.get(id)!;
      const node = (c.wrap ?? c.el).cloneNode(true) as Element;
      const inner = c.wrap ? node.getElementsByTagName('mxCell')[0] : node;
      node.setAttribute('id', map.get(id)!);
      if (c.wrap) inner.removeAttribute('id');
      const p = inner.getAttribute('parent') ?? '';
      if (map.has(p)) inner.setAttribute('parent', map.get(p)!);
      for (const k of ['source', 'target']) {
        const v = inner.getAttribute(k);
        if (v && map.has(v)) inner.setAttribute(k, map.get(v)!);
      }
      if (!map.has(p)) {
        const g = Array.from(inner.children).find((e) => e.localName === 'mxGeometry');
        if (g && c.vertex) this.shiftPoint(g, 10, 10);
        if (g && c.edge) for (const e of Array.from(g.children)) for (const q of e.localName === 'Array' ? Array.from(e.children) : e.localName === 'mxPoint' && e.getAttribute('as') !== 'offset' ? [e] : []) this.shiftPoint(q, 10, 10);
        top.push(map.get(id)!);
      }
      this.rootEl.append(node);
    }
    this.reindex();
    return top;
  }

  style(ids: string[]): BoardStyle {
    const c = this.cells.get(ids[0] ?? '');
    const st = c?.style ?? new Map();
    const fill = st.get('fillColor');
    return {
      stroke: !st.get('strokeColor') || st.get('strokeColor') === 'default' ? '#000000' : st.get('strokeColor')!,
      fill: c?.edge || fill === 'none' ? '' : !fill || fill === 'default' ? '#ffffff' : fill,
      width: NUM(st.get('strokeWidth'), 1),
      dash: st.get('dashed') === '1' ? (st.get('dashPattern') && /^1 /.test(st.get('dashPattern')!) ? 'dotted' : 'dashed') : 'solid',
    };
  }

  setStyle(ids: string[], s: Partial<BoardStyle>) {
    for (const id of ids) {
      const c = this.cells.get(id);
      if (!c) continue;
      const st = c.style;
      if (s.stroke !== undefined) st.set('strokeColor', s.stroke);
      if (s.fill !== undefined && !c.edge) st.set('fillColor', s.fill || 'none');
      if (s.width !== undefined) st.set('strokeWidth', String(s.width));
      if (s.dash !== undefined) {
        if (s.dash === 'solid') {
          st.delete('dashed');
          st.delete('dashPattern');
        } else {
          st.set('dashed', '1');
          if (s.dash === 'dotted') st.set('dashPattern', '1 4');
          else st.delete('dashPattern');
        }
      }
      c.el.setAttribute('style', styleString(st));
    }
  }

  reorder(ids: string[], where: 'front' | 'back') {
    for (const id of where === 'front' ? ids : [...ids].reverse()) {
      const c = this.cells.get(id);
      if (!c) continue;
      const block = [...this.descendants([id])].map((x) => this.cells.get(x)!).sort((a, b) => this.order.indexOf(a.id) - this.order.indexOf(b.id));
      const nodes = block.map((x) => x.wrap ?? x.el);
      if (where === 'front') for (const n of nodes) this.rootEl.append(n);
      else {
        // Right after the parent cell, keeping the block's order.
        const parentNode = this.cells.get(c.parent);
        const anchor = (parentNode?.wrap ?? parentNode?.el)?.nextSibling ?? this.rootEl.firstChild;
        for (const n of nodes) this.rootEl.insertBefore(n, anchor);
      }
      this.reindex();
    }
  }
}
