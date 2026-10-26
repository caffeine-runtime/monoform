// Geometry for the PDF drawing tools: the strokes of a shape (line, arrow,
// rectangle, ellipse) and whether the eraser touches a stroke. Points are
// flat [x0, y0, x1, y1, …] lists. Pure; unit-tested (ink.test.ts).

export type Shape = 'line' | 'arrow' | 'rect' | 'ellipse';
export const SHAPES: Shape[] = ['line', 'arrow', 'rect', 'ellipse'];

/**
 * The strokes that draw a shape dragged from (x0, y0) to (x1, y1). With
 * `even` (Shift held) a line or arrow snaps to 45° steps and a rectangle or
 * ellipse becomes a square or circle. `head` is the arrowhead's length.
 */
export function shapeStrokes(shape: Shape, x0: number, y0: number, x1: number, y1: number, even = false, head = 12): number[][] {
  if (even) [x1, y1] = constrain(shape, x0, y0, x1, y1);
  switch (shape) {
    case 'line':
      return [[x0, y0, x1, y1]];
    case 'arrow': {
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) return [[x0, y0, x1, y1]];
      const a = Math.atan2(y1 - y0, x1 - x0);
      const h = Math.min(head, len * 0.5);
      const wing = (s: number) => [x1 - h * Math.cos(a + s * 0.5), y1 - h * Math.sin(a + s * 0.5)];
      return [[x0, y0, x1, y1], [...wing(1), x1, y1, ...wing(-1)]];
    }
    case 'rect':
      return [[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]];
    case 'ellipse': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      // Enough points for a smooth curve at any size, never fewer than 24.
      const n = Math.max(24, Math.min(96, Math.round((rx + ry) / 3)));
      const pts: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * 2 * Math.PI;
        pts.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
      }
      return [pts];
    }
  }
}

function constrain(shape: Shape, x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (shape === 'line' || shape === 'arrow') {
    const step = Math.PI / 4;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.hypot(dx, dy);
    return [x0 + Math.round(len * Math.cos(a) * 1e6) / 1e6, y0 + Math.round(len * Math.sin(a) * 1e6) / 1e6];
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + Math.sign(dx || 1) * s, y0 + Math.sign(dy || 1) * s];
}

/**
 * Points every `step` along a stroke, its corners kept. pdf.js smooths ink
 * through the midpoints of its points, which suits a hand's dense points but
 * rounds a rectangle's four corners into a curve.
 */
export function densify(stroke: number[], step: number): number[] {
  if (stroke.length < 4) return stroke.slice();
  const out = [stroke[0], stroke[1]];
  for (let i = 2; i + 1 < stroke.length; i += 2) {
    const [ax, ay, bx, by] = [stroke[i - 2], stroke[i - 1], stroke[i], stroke[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  return out;
}

/** Bounding box [minX, minY, maxX, maxY] of strokes. */
export function bounds(strokes: ArrayLike<number>[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (let i = 0; i + 1 < s.length; i += 2) {
      if (Number.isNaN(s[i])) continue;
      x0 = Math.min(x0, s[i]);
      x1 = Math.max(x1, s[i]);
      y0 = Math.min(y0, s[i + 1]);
      y1 = Math.max(y1, s[i + 1]);
    }
  return [x0, y0, x1, y1];
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a circle of radius r at (px, py) touch the stroke (a polyline r wide)? */
export function touchesStroke(px: number, py: number, r: number, stroke: ArrayLike<number>): boolean {
  if (stroke.length === 2) return Math.hypot(px - stroke[0], py - stroke[1]) <= r;
  for (let i = 0; i + 3 < stroke.length; i += 2) {
    if (Number.isNaN(stroke[i]) || Number.isNaN(stroke[i + 2])) continue;
    if (segmentDistance(px, py, stroke[i], stroke[i + 1], stroke[i + 2], stroke[i + 3]) <= r) return true;
  }
  return false;
}

/** Is (px, py) inside the polygon (even-odd rule)? */
export function insidePolygon(px: number, py: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length - (poly.length % 2);
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const [xi, yi, xj, yj] = [poly[i], poly[i + 1], poly[j], poly[j + 1]];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** "#rrggbb" → [r, g, b] (0–255). */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
