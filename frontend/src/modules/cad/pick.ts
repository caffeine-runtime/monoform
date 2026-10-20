// Hit-testing, window/crossing selection and snapping against a built scene
// (relative coordinates), plus typed coordinate entry. Pure; unit-tested.
import { polyPoints, type Scene, type SceneText } from './geometry';

const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
};

function arcDist2(cx: number, cy: number, r: number, a0: number, sweep: number, x: number, y: number): number {
  const a = Math.atan2(y - cy, x - cx);
  const lo = Math.min(a0, a0 + sweep);
  let t = a - lo;
  t -= Math.floor(t / (2 * Math.PI)) * 2 * Math.PI;
  if (t <= Math.abs(sweep) + 1e-12) {
    const d = Math.hypot(x - cx, y - cy) - r;
    return d * d;
  }
  const e1 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const e2 = [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)];
  return Math.min((x - e1[0]) ** 2 + (y - e1[1]) ** 2, (x - e2[0]) ** 2 + (y - e2[1]) ** 2);
}

function inPoly(c: Float64Array, start: number, n: number, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = c[(start + i) * 2];
    const yi = c[(start + i) * 2 + 1];
    const xj = c[(start + j) * 2];
    const yj = c[(start + j) * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Corners of a text's box (relative coords). */
export function textBox(t: SceneText): [number, number][] {
  const lines = t.text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * t.h * 0.6;
  const h = lines.length > 1 ? lines.length * t.h * 1.6 : t.h;
  const ux = Math.cos(t.rot);
  const uy = Math.sin(t.rot);
  const x0 = -t.ax * w;
  const y0 = -t.ay * h;
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ].map(([px, py]) => [t.x + px * ux - py * uy, t.y + px * uy + py * ux]);
}

/** Texts per entity (built lazily per scene). */
const textIndex = new WeakMap<Scene, Map<number, SceneText[]>>();
export function textsOf(s: Scene, e: number): SceneText[] {
  let m = textIndex.get(s);
  if (!m) {
    m = new Map();
    for (const t of s.texts) {
      const l = m.get(t.e);
      if (l) l.push(t);
      else m.set(t.e, [t]);
    }
    textIndex.set(s, m);
  }
  return m.get(e) ?? [];
}

/** Distance² from a point to an entity's drawing (0 inside fills and text boxes). */
export function entityDist2(s: Scene, e: number, x: number, y: number): number {
  let best = Infinity;
  const c = s.coords;
  for (let p = s.entPoly[e]; p < s.entPoly[e + 1]; p++) {
    const start = s.polys[p * 5 + 2];
    const n = s.polys[p * 5 + 3];
    const flags = s.polys[p * 5 + 4];
    if (flags & 8) {
      best = Math.min(best, arcDist2(c[start * 2], c[start * 2 + 1], c[start * 2 + 2], c[start * 2 + 3], c[start * 2 + 4], x, y));
      continue;
    }
    if (flags & 2 && n > 2 && inPoly(c, start, n, x, y)) return 0;
    if (n === 1) {
      const dx = c[start * 2] - x;
      const dy = c[start * 2 + 1] - y;
      best = Math.min(best, dx * dx + dy * dy);
      continue;
    }
    for (let i = 1; i < n; i++) best = Math.min(best, segDist2(x, y, c[(start + i - 1) * 2], c[(start + i - 1) * 2 + 1], c[(start + i) * 2], c[(start + i) * 2 + 1]));
    if (flags & 1) best = Math.min(best, segDist2(x, y, c[(start + n - 1) * 2], c[(start + n - 1) * 2 + 1], c[start * 2], c[start * 2 + 1]));
  }
  for (const t of textsOf(s, e)) {
    const b = textBox(t);
    const f = Float64Array.from(b.flat());
    if (inPoly(f, 0, 4, x, y)) return 0;
  }
  return best;
}

/** Top-most entity within tol of (x, y), or -1. */
export function pick(s: Scene, x: number, y: number, tol: number, skip?: (e: number) => boolean): number {
  const n = s.entLayer.length;
  let best = -1;
  let bestD = tol * tol;
  for (let e = n - 1; e >= 0; e--) {
    const b = e * 4;
    if (!(s.boxes[b] - tol <= x && x <= s.boxes[b + 2] + tol && s.boxes[b + 1] - tol <= y && y <= s.boxes[b + 3] + tol)) continue;
    if (skip?.(e)) continue;
    const d = entityDist2(s, e, x, y);
    if (d < bestD || (d === 0 && best < 0)) {
      best = e;
      bestD = d;
      if (d === 0) break;
    }
  }
  return best;
}

const segHitsRect = (ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number) => {
  // Liang–Barsky clip.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
};

/** Window (fully inside) or crossing (touching) selection. */
export function boxSelect(s: Scene, x0: number, y0: number, x1: number, y1: number, crossing: boolean, skip?: (e: number) => boolean): number[] {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  const out: number[] = [];
  for (let e = 0; e < s.entLayer.length; e++) {
    const b = e * 4;
    if (!(s.boxes[b] <= s.boxes[b + 2]) || skip?.(e)) continue;
    const inside = s.boxes[b] >= ax && s.boxes[b + 2] <= bx && s.boxes[b + 1] >= ay && s.boxes[b + 3] <= by;
    if (inside) {
      out.push(e);
      continue;
    }
    if (!crossing || s.boxes[b] > bx || s.boxes[b + 2] < ax || s.boxes[b + 1] > by || s.boxes[b + 3] < ay) continue;
    let hit = false;
    for (let p = s.entPoly[e]; p < s.entPoly[e + 1] && !hit; p++) {
      const flags = s.polys[p * 5 + 4];
      const arc = flags & 8 ? Float64Array.from(polyPoints(s, p)) : null;
      const c = arc ?? s.coords;
      const start = arc ? 0 : s.polys[p * 5 + 2];
      const n = arc ? arc.length / 2 : s.polys[p * 5 + 3];
      if (flags & 2 && n > 2 && inPoly(c, start, n, (ax + bx) / 2, (ay + by) / 2)) hit = true;
      for (let i = 0; i < n && !hit; i++) {
        const x = c[(start + i) * 2];
        const y = c[(start + i) * 2 + 1];
        if (x >= ax && x <= bx && y >= ay && y <= by) hit = true;
        else if (i && segHitsRect(c[(start + i - 1) * 2], c[(start + i - 1) * 2 + 1], x, y, ax, ay, bx, by)) hit = true;
      }
    }
    if (!hit)
      for (const t of textsOf(s, e)) {
        const q = textBox(t);
        if (q.some(([x, y]) => x >= ax && x <= bx && y >= ay && y <= by) || q.some((p, i) => segHitsRect(p[0], p[1], q[(i + 1) % 4][0], q[(i + 1) % 4][1], ax, ay, bx, by))) hit = true;
      }
    if (hit) out.push(e);
  }
  return out;
}

/** Nearest snap point within tol: [x, y, kind] or null. */
export function nearestSnap(s: Scene, x: number, y: number, tol: number, extra: number[] = []): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bd = tol * tol;
  const scan = (a: ArrayLike<number>, stride: number) => {
    for (let i = 0; i + 2 < a.length; i += stride) {
      const dx = a[i] - x;
      const dy = a[i + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = [a[i], a[i + 1], a[i + 2]];
      }
    }
  };
  scan(s.snaps, 4);
  scan(extra, 3);
  return best;
}

/** A "nice" grid step (1, 2 or 5 × 10ⁿ) at least minPx pixels apart at this zoom. */
export function gridStep(zoom: number, minPx = 14): number {
  const raw = minPx / zoom;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const k of [1, 2, 5, 10]) if (p * k >= raw) return p * k;
  return p * 10;
}

/**
 * Typed point entry, AutoCAD style: "x,y" absolute, "@dx,dy" relative to the
 * last point, "len<angle" / "@len<angle" polar from the last point, or a bare
 * number: that distance towards the cursor. Returns null if it isn't a point.
 */
export function parsePoint(text: string, last: [number, number] | null, cursor: [number, number]): [number, number] | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return null;
  const n = (s: string) => (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : NaN);
  const rel = t.startsWith('@');
  const body = rel ? t.slice(1) : t;
  if (body.includes('<')) {
    const [l, a] = body.split('<').map(n);
    if (!Number.isFinite(l) || !Number.isFinite(a)) return null;
    const o = last ?? [0, 0];
    const r = (a * Math.PI) / 180;
    return [o[0] + l * Math.cos(r), o[1] + l * Math.sin(r)];
  }
  if (body.includes(',')) {
    const [x, y] = body.split(',').map(n);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (rel) {
      const o = last ?? [0, 0];
      return [o[0] + x, o[1] + y];
    }
    return [x, y];
  }
  const d = n(body);
  if (!Number.isFinite(d) || !last) return null;
  const dx = cursor[0] - last[0];
  const dy = cursor[1] - last[1];
  const l = Math.hypot(dx, dy);
  if (!l) return [last[0] + d, last[1]];
  return [last[0] + (dx / l) * d, last[1] + (dy / l) * d];
}

/** Circle through three points, or null when they're collinear. */
export function circle3(a: [number, number], b: [number, number], c: [number, number]): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/** Arc (degrees, counter-clockwise) from start through mid to end. */
export function arc3(a: [number, number], m: [number, number], b: [number, number]): { cx: number; cy: number; r: number; a0: number; a1: number } | null {
  const c = circle3(a, m, b);
  if (!c) return null;
  const ang = (p: [number, number]) => Math.atan2(p[1] - c.cy, p[0] - c.cx);
  const ccw = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sa = ang(a);
  const sm = ang(m);
  const sb = ang(b);
  const deg = (r: number) => (r * 180) / Math.PI;
  return ccw(sa, sm) < ccw(sa, sb) ? { ...c, a0: deg(sa), a1: deg(sb) } : { ...c, a0: deg(sb), a1: deg(sa) };
}
