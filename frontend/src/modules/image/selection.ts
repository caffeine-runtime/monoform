// Pixel selections. A selection is a mask canvas the size of the document:
// alpha 255 = selected, 0 = not (soft values come from feathered or
// model-made masks). Vector outlines (rect, ellipse, lasso) are kept for
// drawing marching ants; mask-only selections (magic wand, objects,
// inverted) are outlined from their edges.
import type { Rect } from './geometry';
import { makeCanvas } from './raster';

export type SelectMode = 'replace' | 'add' | 'subtract';

export interface Selection {
  mask: HTMLCanvasElement;
  bounds: Rect;
  /** Outline paths in document coordinates, when the selection is vector-based. */
  paths: Path2D[] | null;
  /** Edge image (white edge pixels) for mask-based selections, plus its scale to the document. */
  edges: { canvas: HTMLCanvasElement | ImageBitmap; scale: number } | null;
}

function g2d(c: HTMLCanvasElement) {
  return c.getContext('2d')!;
}

export function rectPath(r: Rect): Path2D {
  const p = new Path2D();
  p.rect(r.x, r.y, r.width, r.height);
  return p;
}

export function ellipsePath(r: Rect): Path2D {
  const p = new Path2D();
  p.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.abs(r.width / 2), Math.abs(r.height / 2), 0, 0, Math.PI * 2);
  return p;
}

export function polygonPath(points: number[]): Path2D {
  const p = new Path2D();
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) p.moveTo(points[i], points[i + 1]);
    else p.lineTo(points[i], points[i + 1]);
  }
  p.closePath();
  return p;
}

/** Bounding box of a polygon's points, clamped to the document. */
export function polygonBounds(points: number[], w: number, h: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
  }
  return clampRect({ x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) }, w, h);
}

export function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.min(w, r.x));
  const y0 = Math.max(0, Math.min(h, r.y));
  const x1 = Math.max(0, Math.min(w, r.x + r.width));
  const y1 = Math.max(0, Math.min(h, r.y + r.height));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export function unionRect(a: Rect, b: Rect): Rect {
  if (!a.width || !a.height) return b;
  if (!b.width || !b.height) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** A selection from a vector path (rect, ellipse, lasso). */
export function fromPath(path: Path2D, bounds: Rect, w: number, h: number): Selection {
  const mask = makeCanvas(w, h);
  const g = g2d(mask);
  g.fillStyle = '#fff';
  g.fill(path);
  return { mask, bounds: clampRect(bounds, w, h), paths: [path], edges: null };
}

/** A selection from a ready mask (wand, models). */
export function fromMask(mask: HTMLCanvasElement, bounds: Rect, edges: Selection['edges']): Selection {
  return { mask, bounds, paths: null, edges };
}

/** Combine the current selection with a new one. */
export function combine(cur: Selection | null, next: Selection, mode: SelectMode): Selection | null {
  if (!cur || mode === 'replace') return next;
  const mask = makeCanvas(cur.mask.width, cur.mask.height);
  const g = g2d(mask);
  g.drawImage(cur.mask, 0, 0);
  g.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out';
  g.drawImage(next.mask, 0, 0);
  const bounds = mode === 'add' ? unionRect(cur.bounds, next.bounds) : cur.bounds;
  const paths = mode === 'add' && cur.paths && next.paths ? [...cur.paths, ...next.paths] : null;
  return { mask, bounds, paths, edges: null };
}

export function invert(sel: Selection | null, w: number, h: number): Selection {
  const mask = makeCanvas(w, h);
  const g = g2d(mask);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  if (sel) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(sel.mask, 0, 0);
  }
  return { mask, bounds: { x: 0, y: 0, width: w, height: h }, paths: null, edges: null };
}

export function selectAll(w: number, h: number): Selection {
  const r = { x: 0, y: 0, width: w, height: h };
  return fromPath(rectPath(r), r, w, h);
}

/** True when nothing remains selected (cheap check on the bounds first). */
export function isEmpty(sel: Selection): boolean {
  return sel.bounds.width < 1 || sel.bounds.height < 1;
}

/**
 * out = src·(1−mask) + processed·mask — apply an operation only inside the
 * selection. All canvases are document-sized.
 */
export function blendThroughMask(src: HTMLCanvasElement, processed: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const inside = makeCanvas(src.width, src.height);
  const gi = g2d(inside);
  gi.drawImage(processed, 0, 0);
  gi.globalCompositeOperation = 'destination-in';
  gi.drawImage(mask, 0, 0);
  const out = makeCanvas(src.width, src.height);
  const go = g2d(out);
  go.drawImage(src, 0, 0);
  go.globalCompositeOperation = 'destination-out';
  go.drawImage(mask, 0, 0);
  go.globalCompositeOperation = 'source-over';
  go.drawImage(inside, 0, 0);
  return out;
}

/** The selected pixels of src, cropped to the selection bounds (transparent outside). */
export function extract(src: HTMLCanvasElement, sel: Selection): HTMLCanvasElement {
  const b = sel.bounds;
  const out = makeCanvas(b.width, b.height);
  const g = g2d(out);
  g.drawImage(src, -b.x, -b.y);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(sel.mask, -b.x, -b.y);
  return out;
}

/** src with the selected pixels made transparent. */
export function clearInside(src: HTMLCanvasElement, sel: Selection): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const g = g2d(out);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(sel.mask, 0, 0);
  return out;
}

/** src with the selection filled with a colour. */
export function fillInside(src: HTMLCanvasElement, sel: Selection, color: string): HTMLCanvasElement {
  const fill = makeCanvas(src.width, src.height);
  const gf = g2d(fill);
  gf.fillStyle = color;
  gf.fillRect(0, 0, fill.width, fill.height);
  return blendThroughMask(src, fill, sel.mask);
}
