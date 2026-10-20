// Drawing a scene on a canvas: one Path2D per colour (built once per scene),
// stroked with a hairline at any zoom; texts and point markers in screen
// space. Also SVG export from the same scene.
import { FG, type Scene, type SceneText } from './geometry';
import { textsOf } from './pick';

/** Screen position of the scene origin and pixels per drawing unit. */
export interface View {
  z: number;
  x: number;
  y: number;
}

export const css = (c: number, dark: boolean): string => {
  if (c === FG) return dark ? '#e8e8e8' : '#161616';
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  // Keep colours visible on the background (yellow on white, navy on black).
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (!dark && l > 0.82) return `rgb(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)})`;
  if (dark && l < 0.12) return `rgb(${Math.min(255, r + 90)},${Math.min(255, g + 90)},${Math.min(255, b + 90)})`;
  return `#${c.toString(16).padStart(6, '0')}`;
};

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Batch {
  color: number;
  stroke: Path2D;
  fill: Path2D | null;
}

export class Painter {
  private batches: Batch[] = [];
  private points: number[] = [];

  constructor(public scene: Scene) {
    const by = new Map<number, Batch>();
    const { coords: c, polys } = scene;
    for (let p = 0; p < polys.length; p += 5) {
      const color = polys[p + 1];
      const start = polys[p + 2];
      const n = polys[p + 3];
      const flags = polys[p + 4];
      if (flags & 4) {
        this.points.push(c[start * 2], c[start * 2 + 1], color);
        continue;
      }
      let b = by.get(color);
      if (!b) by.set(color, (b = { color, stroke: new Path2D(), fill: null }));
      if (flags & 8) {
        arcTo(b.stroke, c[start * 2], c[start * 2 + 1], c[start * 2 + 2], c[start * 2 + 3], c[start * 2 + 4]);
        continue;
      }
      const path = flags & 2 ? (b.fill ??= new Path2D()) : b.stroke;
      path.moveTo(c[start * 2], c[start * 2 + 1]);
      for (let i = 1; i < n; i++) path.lineTo(c[(start + i) * 2], c[(start + i) * 2 + 1]);
      if (flags & 1 || flags & 2) path.closePath();
    }
    this.batches = [...by.values()];
  }

  /** Draw everything (canvas is in device pixels; dpr = device / CSS pixels). */
  draw(ctx: Ctx2D, v: View, dpr: number, dark: boolean, w: number, h: number) {
    ctx.save();
    ctx.setTransform(dpr * v.z, 0, 0, -dpr * v.z, dpr * v.x, dpr * v.y);
    ctx.lineWidth = 1 / v.z;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const b of this.batches) {
      const col = css(b.color, dark);
      if (b.fill) {
        ctx.fillStyle = col;
        ctx.fill(b.fill, 'evenodd');
      }
      ctx.strokeStyle = col;
      ctx.stroke(b.stroke);
      if (b.fill) ctx.stroke(b.fill);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < this.points.length; i += 3) {
      const sx = v.x + this.points[i] * v.z;
      const sy = v.y - this.points[i + 1] * v.z;
      if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue;
      ctx.fillStyle = css(this.points[i + 2], dark);
      ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
    for (const t of this.scene.texts) drawText(ctx, t, v, css(t.color, dark), w, h);
    ctx.restore();
  }
}

/** Draw one text (ctx in CSS pixels). Skips text too small to read or off screen. */
export function drawText(ctx: Ctx2D, t: SceneText, v: View, color: string, w: number, h: number) {
  const px = t.h * v.z;
  if (px < 2.5) return;
  const sx = v.x + t.x * v.z;
  const sy = v.y - t.y * v.z;
  const lines = t.text.split('\n');
  const reach = px * Math.max(lines.length * 1.6, Math.max(...lines.map((l) => l.length)) * 0.7);
  if (sx < -reach || sy < -reach || sx > w + reach || sy > h + reach) return;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-t.rot);
  if (t.mirror) ctx.scale(-1, 1);
  ctx.fillStyle = color;
  ctx.font = `${px}px "Liberation Sans", Arial, sans-serif`;
  ctx.textAlign = t.ax === 0.5 ? 'center' : t.ax === 1 ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';
  const lh = px * 1.6;
  // Vertical anchor: baseline of the first line relative to the insertion point.
  const total = (lines.length - 1) * lh;
  let y0 = 0;
  if (lines.length > 1 || t.ay) y0 = t.ay === 1 ? px : t.ay === 0.5 ? px / 2 - total / 2 : -total;
  lines.forEach((l, i) => ctx.fillText(l, 0, y0 + i * lh));
  ctx.restore();
}

/** Draw some entities with a style (selection, hover, move preview), optionally transformed (relative coords). */
export function drawEntities(ctx: CanvasRenderingContext2D, s: Scene, ids: Iterable<number>, v: View, dpr: number, color: string, width: number, m?: [number, number, number, number, number, number]) {
  const path = new Path2D();
  const c = s.coords;
  const T = (x: number, y: number): [number, number] => (m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y]);
  let texts: SceneText[] = [];
  for (const e of ids) {
    for (let p = s.entPoly[e]; p < s.entPoly[e + 1]; p++) {
      const start = s.polys[p * 5 + 2];
      const n = s.polys[p * 5 + 3];
      const flags = s.polys[p * 5 + 4];
      if (flags & 8) {
        let [cx, cy] = T(c[start * 2], c[start * 2 + 1]);
        let r = c[start * 2 + 2];
        let a0 = c[start * 2 + 3];
        if (m) {
          r *= Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
          a0 += Math.atan2(m[1], m[0]);
        }
        arcTo(path, cx, cy, r, a0, c[start * 2 + 4]);
        continue;
      }
      const [x0, y0] = T(c[start * 2], c[start * 2 + 1]);
      if (n === 1) {
        path.moveTo(x0 - 2 / v.z, y0);
        path.lineTo(x0 + 2 / v.z, y0);
        continue;
      }
      path.moveTo(x0, y0);
      for (let i = 1; i < n; i++) path.lineTo(...T(c[(start + i) * 2], c[(start + i) * 2 + 1]));
      if (flags & 3) path.closePath();
    }
    const tx = textsOf(s, e);
    if (tx.length) texts = texts.concat(tx);
  }
  ctx.save();
  ctx.setTransform(dpr * v.z, 0, 0, -dpr * v.z, dpr * v.x, dpr * v.y);
  ctx.lineWidth = width / v.z;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke(path);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const t of texts) {
    let tt = t;
    if (m) {
      const [x, y] = T(t.x, t.y);
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      tt = { ...t, x, y, h: t.h * k, rot: t.rot + Math.atan2(m[1], m[0]) };
    }
    drawText(ctx, tt, v, color, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
  }
  ctx.restore();
}

/** A true arc in a path (world coordinates; + sweep is counter-clockwise). */
function arcTo(p: Path2D, cx: number, cy: number, r: number, a0: number, sweep: number) {
  p.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  p.arc(cx, cy, r, a0, a0 + sweep, sweep < 0);
}

/** Render a scene fitted into w px wide on a white background (PNG export). */
export function renderFitted(ctx: Ctx2D, s: Scene, w: number, H: number) {
  const [x0, y0, x1, y1] = s.bounds!;
  const bw = Math.max(x1 - x0, 1e-9);
  const z = (w * 0.94) / bw;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, H);
  new Painter(s).draw(ctx, { z, x: w / 2 - ((x0 + x1) / 2) * z, y: H / 2 + ((y0 + y1) / 2) * z }, 1, false, w, H);
}

/** Pixel height for a fitted render w px wide (3 % margin all round). */
export function fittedHeight(s: Scene, w: number): number {
  const [x0, y0, x1, y1] = s.bounds!;
  const bw = Math.max(x1 - x0, 1e-9);
  const bh = Math.max(y1 - y0, 1e-9);
  return Math.max(1, Math.round((w * 0.94 * bh) / bw + w * 0.06));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The scene as an SVG document (drawing units, y up → y down; ACI 7 is black). */
export function toSvg(s: Scene, units = ''): string {
  if (!s.bounds) return '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const [x0, y0, x1, y1] = s.bounds;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.02 || 1;
  const w = x1 - x0 + 2 * pad;
  const h = y1 - y0 + 2 * pad;
  const f = (v: number) => +v.toFixed(6);
  const byColor = new Map<string, { d: string[]; fill: string[] }>();
  const c = s.coords;
  for (let p = 0; p < s.polys.length; p += 5) {
    const col = css(s.polys[p + 1], false);
    const start = s.polys[p + 2];
    const n = s.polys[p + 3];
    const flags = s.polys[p + 4];
    let g = byColor.get(col);
    if (!g) byColor.set(col, (g = { d: [], fill: [] }));
    if (flags & 4) {
      g.fill.push(`M${f(c[start * 2] - pad / 200)} ${f(-c[start * 2 + 1])}h${f(pad / 100)}`);
      continue;
    }
    if (flags & 8) {
      const [cx, cy, r, a0, sw] = [c[start * 2], c[start * 2 + 1], c[start * 2 + 2], c[start * 2 + 3], c[start * 2 + 4]];
      const pt = (a: number) => `${f(cx + r * Math.cos(a))} ${f(-(cy + r * Math.sin(a)))}`;
      // SVG arcs: y is flipped, so counter-clockwise becomes sweep-flag 0; split full circles in two.
      const parts = Math.abs(sw) > Math.PI * 1.5 ? 2 : 1;
      let d = `M${pt(a0)}`;
      for (let k = 1; k <= parts; k++) d += `A${f(r)} ${f(r)} 0 ${Math.abs(sw / parts) > Math.PI ? 1 : 0} ${sw > 0 ? 0 : 1} ${pt(a0 + (sw * k) / parts)}`;
      g.d.push(d);
      continue;
    }
    let d = `M${f(c[start * 2])} ${f(-c[start * 2 + 1])}`;
    for (let i = 1; i < n; i++) d += `L${f(c[(start + i) * 2])} ${f(-c[(start + i) * 2 + 1])}`;
    if (flags & 3) d += 'Z';
    (flags & 2 ? g.fill : g.d).push(d);
  }
  const sw = f(Math.max(w, h) / 1500);
  const parts: string[] = [];
  for (const [col, g] of byColor) {
    if (g.d.length) parts.push(`<path fill="none" stroke="${col}" d="${g.d.join('')}"/>`);
    if (g.fill.length) parts.push(`<path fill="${col}" stroke="${col}" fill-rule="evenodd" d="${g.fill.join('')}"/>`);
  }
  for (const t of s.texts) {
    const anchor = t.ax === 0.5 ? 'middle' : t.ax === 1 ? 'end' : 'start';
    const base = t.ay === 1 ? 'hanging' : t.ay === 0.5 ? 'central' : 'alphabetic';
    const rot = f((-t.rot * 180) / Math.PI);
    const lines = t.text.split('\n');
    const tsp = lines.map((l, i) => `<tspan x="0" dy="${i ? f(t.h * 1.6) : 0}">${esc(l)}</tspan>`).join('');
    parts.push(`<text transform="translate(${f(t.x)} ${f(-t.y)}) rotate(${rot})${t.mirror ? ' scale(-1 1)' : ''}" font-size="${f(t.h)}" text-anchor="${anchor}" dominant-baseline="${base}" fill="${css(t.color, false)}" stroke="none">${tsp}</text>`);
  }
  const size = units ? ` width="${f(w)}${units}" height="${f(h)}${units}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${f(x0 - pad)} ${f(-y1 - pad)} ${f(w)} ${f(h)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" font-family="Arial, sans-serif">\n${parts.join('\n')}\n</svg>\n`;
}
