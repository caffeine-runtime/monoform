// DXF entities → drawable scene: polylines (curves tessellated finely enough
// to stay smooth when zoomed in), filled areas, texts and snap points, all in
// world units relative to an origin near the drawing (so huge survey
// coordinates keep their precision on the canvas). Blocks are expanded with
// their transforms, layer and colour inheritance (BYLAYER / BYBLOCK) applied.
// Pure; unit-tested. Runs in the CAD worker.
import { aci, mtextPlain, num, str, type Drawing, type Entity, type Group } from './dxf';

/** Affine matrix [a, b, c, d, e, f]: (x, y) → (a x + c y + e, b x + d y + f). */
export type M = [number, number, number, number, number, number];
export const IDENT: M = [1, 0, 0, 1, 0, 0];
/** OCS with extrusion (0, 0, -1): x is mirrored. */
export const FLIP: M = [-1, 0, 0, 1, 0, 0];

export const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
export const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const linear = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
export const translate = (dx: number, dy: number): M => [1, 0, 0, 1, dx, dy];
export function rotateAbout(a: number, cx: number, cy: number): M {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
export const scaleAbout = (k: number, cx: number, cy: number): M => [k, 0, 0, k, cx - k * cx, cy - k * cy];
/** Uniform scale of a matrix (√|det|). */
export const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
/** Rotation of the x axis under a matrix, radians. */
export const angleOf = (m: M) => Math.atan2(m[1], m[0]);
/** The matrix seen from inside a mirrored OCS (F·m·F). */
export const conj = (m: M): M => [m[0], -m[1], -m[2], m[3], -m[4], m[5]];

/** Entities whose coordinates are in their object coordinate system. */
const OCS = new Set(['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'ATTRIB', 'ATTDEF', 'INSERT', 'SOLID', 'TRACE', 'HATCH']);
/** Extrusion pointing down: the OCS is the WCS mirrored in x. */
export const flipped = (e: Entity) => OCS.has(e.type) && num(e, 230) < 0;

// ---------- tessellation ----------

/** Points along an arc (radians, sweep signed: + is counter-clockwise). */
export function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number, out: number[] = []): number[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * 128));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Sweep from a0 to a1 counter-clockwise, in (0, 2π]. */
export function ccwSweep(a0: number, a1: number): number {
  let s = (a1 - a0) % (2 * Math.PI);
  if (s <= 1e-12) s += 2 * Math.PI;
  return s;
}

/** Append the points of a polyline segment with a bulge (excluding the start point). */
export function bulgeTo(x1: number, y1: number, x2: number, y2: number, b: number, out: number[]) {
  if (!b || Math.abs(b) < 1e-12) {
    out.push(x2, y2);
    return;
  }
  const th = 4 * Math.atan(b);
  const c = Math.hypot(x2 - x1, y2 - y1);
  if (c < 1e-12) return;
  const r = c / (2 * Math.sin(th / 2));
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2 - th / 2;
  const cx = x1 + r * Math.cos(a);
  const cy = y1 + r * Math.sin(a);
  const pts = arcPoints(cx, cy, Math.abs(r), Math.atan2(y1 - cy, x1 - cx), th);
  for (let i = 2; i < pts.length - 2; i++) out.push(pts[i]);
  out.push(x2, y2); // exact end
}

/** Vertices of a polyline with bulges → points. */
export function bulgePolyline(v: { x: number; y: number; b: number }[], closed: boolean): number[] {
  const out: number[] = [];
  if (!v.length) return out;
  out.push(v[0].x, v[0].y);
  for (let i = 1; i < v.length; i++) bulgeTo(v[i - 1].x, v[i - 1].y, v[i].x, v[i].y, v[i - 1].b, out);
  if (closed && v.length > 1) {
    const l = v[v.length - 1];
    if (l.b) bulgeTo(l.x, l.y, v[0].x, v[0].y, l.b, out);
  }
  return out;
}

/** LWPOLYLINE vertices (x, y, bulge) in order. */
export function lwVertices(e: Entity): { x: number; y: number; b: number }[] {
  const v: { x: number; y: number; b: number }[] = [];
  for (const g of e.groups) {
    if (g.code === 10) v.push({ x: +g.value, y: 0, b: 0 });
    else if (v.length && g.code === 20) v[v.length - 1].y = +g.value;
    else if (v.length && g.code === 42) v[v.length - 1].b = +g.value;
  }
  return v;
}

export function polyVertices(e: Entity): { x: number; y: number; b: number }[] {
  return e.children.filter((c) => c.type === 'VERTEX' && !(num(c, 70) & 16)).map((c) => ({ x: num(c, 10) || 0, y: num(c, 20) || 0, b: num(c, 42) || 0 }));
}

/** Ellipse points; params in radians, minor axis direction depends on the extrusion. */
function ellipsePoints(cx: number, cy: number, mx: number, my: number, ratio: number, t0: number, t1: number, down: boolean): number[] {
  const [nx, ny] = down ? [my * ratio, -mx * ratio] : [-my * ratio, mx * ratio];
  let sweep = t1 - t0;
  if (sweep <= 1e-12) sweep += 2 * Math.PI;
  const n = Math.max(8, Math.ceil((sweep / (2 * Math.PI)) * 160));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    out.push(cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t));
  }
  return out;
}

/** B-spline / NURBS points via de Boor; falls back to the control or fit polygon. */
export function splinePoints(e: Entity): number[] {
  const p = num(e, 71) || 3;
  const knots = e.groups.filter((g) => g.code === 40).map((g) => +g.value);
  const ctrl = pairs(e.groups, 10, 20);
  const w = e.groups.filter((g) => g.code === 41).map((g) => +g.value);
  const fit = pairs(e.groups, 11, 21);
  const n = ctrl.length;
  if (n < 2 || knots.length !== n + p + 1) return (n >= 2 ? ctrl : fit).flat();
  const P = ctrl.map(([x, y], i) => {
    const wi = w.length === n && w[i] > 0 ? w[i] : 1;
    return [x * wi, y * wi, wi];
  });
  const u0 = knots[p];
  const u1 = knots[n];
  const steps = Math.min(4000, Math.max(24, n * 12));
  const out: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const u = u0 + ((u1 - u0) * s) / steps;
    let k = p;
    while (k < n - 1 && u >= knots[k + 1]) k++;
    const d = P.slice(k - p, k + 1).map((q) => [...q]);
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = j + k - p;
        const den = knots[i + p - r + 1] - knots[i];
        const al = den ? (u - knots[i]) / den : 0;
        for (let c = 0; c < 3; c++) d[j][c] = (1 - al) * d[j - 1][c] + al * d[j][c];
      }
    }
    const q = d[p];
    out.push(q[0] / q[2], q[1] / q[2]);
  }
  return out;
}

/** (x, y) pairs from groups xc / yc in order. */
export function pairs(groups: Group[], xc: number, yc: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].code !== xc) continue;
    const y = groups.slice(i + 1, i + 3).find((g) => g.code === yc);
    out.push([+groups[i].value, y ? +y.value : 0]);
  }
  return out;
}

// ---------- HATCH boundaries ----------

export interface HatchInfo {
  loops: number[][];
  solid: boolean;
  /** Group indices by role, for transforms. */
  points: [number, number][];
  vectors: [number, number][];
  lengths: number[];
  angles: number[]; // degrees
}

/** Walk the HATCH group sequence: boundary loops (tessellated) and the role of every coordinate group. */
export function hatch(e: Entity): HatchInfo {
  const g = e.groups;
  const h: HatchInfo = { loops: [], solid: num(e, 70) === 1, points: [], vectors: [], lengths: [], angles: [] };
  let i = g.findIndex((x) => x.code === 91);
  if (i < 0) return h;
  const paths = parseInt(g[i].value, 10) || 0;
  i++;
  const at = (code: number, role?: number[]) => {
    while (i < g.length && g[i].code !== code) i++;
    if (i < g.length) role?.push(i);
    return i < g.length ? +g[i++].value : NaN;
  };
  const pt = (xc: number, yc: number, role: 'p' | 'v' = 'p'): [number, number] => {
    while (i < g.length && g[i].code !== xc) i++;
    const xi = i;
    const x = +g[i++]?.value;
    while (i < g.length && g[i].code !== yc) i++;
    const yi = i;
    const y = +g[i++]?.value;
    (role === 'p' ? h.points : h.vectors).push([xi, yi]);
    return [x, y];
  };
  for (let pth = 0; pth < paths && i < g.length; pth++) {
    const flags = at(92);
    const loop: number[] = [];
    if (flags & 2) {
      const hasBulge = at(72);
      at(73);
      const nv = at(93);
      const v: { x: number; y: number; b: number }[] = [];
      for (let k = 0; k < nv; k++) {
        const [x, y] = pt(10, 20);
        let b = 0;
        if (hasBulge && g[i]?.code === 42) b = +g[i++].value;
        v.push({ x, y, b });
      }
      loop.push(...bulgePolyline(v, true));
    } else {
      const ne = at(93);
      for (let k = 0; k < ne; k++) {
        const type = at(72);
        if (type === 1) {
          const [x1, y1] = pt(10, 20);
          const [x2, y2] = pt(11, 21);
          loop.push(x1, y1, x2, y2);
        } else if (type === 2) {
          const [cx, cy] = pt(10, 20);
          const r = at(40, h.lengths);
          const s = at(50, h.angles);
          const en = at(51, h.angles);
          const ccw = at(73);
          const a0 = (s * Math.PI) / 180;
          const sw = ccwSweep(a0, (en * Math.PI) / 180);
          loop.push(...(ccw ? arcPoints(cx, cy, r, a0, sw) : arcPoints(cx, cy, r, -a0, -sw)));
        } else if (type === 3) {
          const [cx, cy] = pt(10, 20);
          const [mx, my] = pt(11, 21, 'v');
          const ratio = at(40);
          const s = at(50);
          const en = at(51);
          const ccw = at(73);
          const pts = ellipsePoints(cx, cy, mx, my, ratio, (s * Math.PI) / 180, (en * Math.PI) / 180, false);
          if (!ccw) {
            // Clockwise edges store mirrored parameters: reflect across the major axis.
            const l = Math.hypot(mx, my) || 1;
            const ux = mx / l;
            const uy = my / l;
            for (let q = 0; q < pts.length; q += 2) {
              const dx = pts[q] - cx;
              const dy = pts[q + 1] - cy;
              const t = dx * ux + dy * uy;
              pts[q] = cx + 2 * t * ux - dx;
              pts[q + 1] = cy + 2 * t * uy - dy;
            }
          }
          loop.push(...pts);
        } else if (type === 4) {
          at(94);
          at(73);
          at(74);
          const nk = at(95);
          const nc = at(96);
          for (let q = 0; q < nk; q++) at(40);
          for (let q = 0; q < nc; q++) {
            const [x, y] = pt(10, 20);
            loop.push(x, y);
            if (g[i]?.code === 42) i++;
          }
          if (g[i]?.code === 97) {
            const nf = at(97);
            for (let q = 0; q < nf; q++) pt(11, 21);
          }
          for (const c of [12, 13]) if (g[i]?.code === c) pt(c, c + 10, 'v');
        }
      }
    }
    // Source boundary objects.
    if (g[i]?.code === 97) {
      const ns = at(97);
      for (let k = 0; k < ns && g[i]?.code === 330; k++) i++;
    }
    h.loops.push(loop);
  }
  // Seed points after 98.
  const s98 = g.findIndex((x, k) => k >= i && x.code === 98);
  if (s98 >= 0) {
    i = s98 + 1;
    const ns = +g[s98].value;
    for (let k = 0; k < ns; k++) pt(10, 20);
  }
  return h;
}

// ---------- scene ----------

export const FG = -1; // ACI 7: white on dark, black on light

export interface SceneText {
  e: number;
  color: number;
  x: number;
  y: number;
  h: number;
  rot: number;
  text: string;
  /** Horizontal anchor 0 left, 0.5 centre, 1 right; vertical 0 baseline, 0.5 middle, 1 top. */
  ax: number;
  ay: number;
  mirror: boolean;
}

export interface Scene {
  origin: [number, number];
  /** x, y pairs relative to origin */
  coords: Float64Array;
  /**
   * per polyline: entity, colour, first point, point count, flags (1 closed,
   * 2 filled, 4 point marker, 8 arc: its 3 "points" are (cx, cy), (r, a0),
   * (sweep, 0), radians, + counter-clockwise)
   */
  polys: Int32Array;
  /** entity → first polyline (length = entities + 1) */
  entPoly: Int32Array;
  texts: SceneText[];
  /** entity → minx, miny, maxx, maxy (relative; NaN when it draws nothing) */
  boxes: Float64Array;
  /** x, y, kind, entity (relative) */
  snaps: Float64Array;
  entLayer: Int32Array;
  layers: string[];
  bounds: [number, number, number, number] | null;
}

export const SNAP = { end: 0, mid: 1, center: 2, quadrant: 3, node: 4 } as const;

interface Ctx {
  m: M;
  layer: string; // inherited for entities on layer 0 inside blocks ('' at top level)
  color: number; // BYBLOCK colour
  depth: number;
}

export function layerColor(d: Drawing, name: string): number {
  const l = d.layers.get(name);
  if (!l) return FG;
  if (l.trueColor !== null) return l.trueColor;
  const c = Math.abs(l.color);
  return c === 7 || c === 0 ? FG : aci(c);
}

export const layerHidden = (d: Drawing, name: string) => {
  const l = d.layers.get(name);
  return !!l && (l.color < 0 || l.frozen);
};

export function build(d: Drawing, hidden: Set<string> = new Set()): Scene {
  const coords: number[] = [];
  const polys: number[] = [];
  const texts: SceneText[] = [];
  const snaps: number[] = [];
  const n = d.entities.length;
  const entPoly = new Int32Array(n + 1);
  const boxes = new Float64Array(n * 4).fill(NaN);
  const entLayer = new Int32Array(n);
  const layerIdx = new Map<string, number>();
  const layers: string[] = [];
  const li = (name: string) => {
    let k = layerIdx.get(name);
    if (k === undefined) {
      k = layers.length;
      layers.push(name);
      layerIdx.set(name, k);
    }
    return k;
  };
  for (const name of d.layers.keys()) li(name);
  let ox = NaN;
  let oy = NaN;
  let cur = 0;
  let bminx = Infinity;
  let bminy = Infinity;
  let bmaxx = -Infinity;
  let bmaxy = -Infinity;
  const grow = (x: number, y: number) => {
    const b = cur * 4;
    if (!(boxes[b] <= x)) boxes[b] = x;
    if (!(boxes[b + 1] <= y)) boxes[b + 1] = y;
    if (!(boxes[b + 2] >= x)) boxes[b + 2] = x;
    if (!(boxes[b + 3] >= y)) boxes[b + 3] = y;
  };
  const rel = (m: M, x: number, y: number): [number, number] => {
    const [wx, wy] = apply(m, x, y);
    if (Number.isNaN(ox)) {
      ox = Math.round(wx);
      oy = Math.round(wy);
    }
    return [wx - ox, wy - oy];
  };
  /** Circle or arc: a true arc when the transform keeps circles round, else tessellated. */
  const emitArc = (m: M, cx: number, cy: number, r: number, a0: number, sweep: number, color: number) => {
    if (!(r > 0) || !Number.isFinite(cx + cy + a0 + sweep)) return;
    const similar = (Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9) || (Math.abs(m[0] + m[3]) < 1e-9 && Math.abs(m[1] - m[2]) < 1e-9);
    if (!similar) return emit(m, arcPoints(cx, cy, r, a0, sweep), color, Math.abs(sweep) >= 2 * Math.PI - 1e-9 ? 1 : 0);
    const det = m[0] * m[3] - m[1] * m[2];
    const [x, y] = rel(m, cx, cy);
    const [dx, dy] = linear(m, Math.cos(a0), Math.sin(a0));
    const R = r * Math.sqrt(Math.abs(det));
    const A0 = Math.atan2(dy, dx);
    const S = det < 0 ? -sweep : sweep;
    const start = coords.length / 2;
    coords.push(x, y, R, A0, S, 0);
    for (const [px, py] of arcExtremes(x, y, R, A0, S)) grow(px, py);
    polys.push(cur, color, start, 3, 8 | (Math.abs(S) >= 2 * Math.PI - 1e-9 ? 1 : 0));
  };
  const emit = (m: M, pts: number[], color: number, flags: number) => {
    if (pts.length < 2 || pts.some((v) => !Number.isFinite(v))) return;
    const start = coords.length / 2;
    for (let k = 0; k < pts.length; k += 2) {
      const [x, y] = rel(m, pts[k], pts[k + 1]);
      coords.push(x, y);
      grow(x, y);
    }
    polys.push(cur, color, start, pts.length / 2, flags);
  };
  const snap = (m: M, x: number, y: number, kind: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const [rx, ry] = rel(m, x, y);
    snaps.push(rx, ry, kind, cur);
  };
  const colorOf = (e: Entity, ctx: Ctx, layer: string): number => {
    if (e.trueColor !== null) return e.trueColor;
    const c = e.color;
    if (c === 256 || Number.isNaN(c)) return layerColor(d, layer);
    if (c === 0) return ctx.color;
    const a = Math.abs(c);
    return a === 7 ? FG : aci(a);
  };
  const text = (m: M, e: Entity, color: number, s: string, x: number, y: number, h: number, rot: number, ax: number, ay: number) => {
    if (!s || !(h > 0)) return;
    const [rx, ry] = rel(m, x, y);
    const [dx, dy] = linear(m, Math.cos(rot), Math.sin(rot));
    const k = scaleOf(m);
    const det = m[0] * m[3] - m[1] * m[2];
    const lines = s.split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * h * 0.6 * k;
    texts.push({ e: cur, color, x: rx, y: ry, h: h * k, rot: Math.atan2(dy, dx), text: s, ax, ay, mirror: det < 0 });
    // Rough extent for selection and bounds.
    const r = Math.atan2(dy, dx);
    const hh = h * k * (lines.length > 1 ? lines.length * 1.6 : 1);
    const ux = Math.cos(r);
    const uy = Math.sin(r);
    const x0 = -ax * w;
    const y0 = -ay * hh;
    for (const [px, py] of [
      [x0, y0],
      [x0 + w, y0],
      [x0, y0 + hh],
      [x0 + w, y0 + hh],
    ])
      grow(rx + px * ux - py * uy, ry + px * uy + py * ux);
  };

  const draw = (e: Entity, ctx: Ctx, top: boolean) => {
    const layer = e.layer === '0' && ctx.layer ? ctx.layer : e.layer;
    if (hidden.has(layer) || layerHidden(d, layer)) return;
    if (num(e, 60) === 1) return; // invisible
    const color = colorOf(e, ctx, layer);
    const m = flipped(e) ? mul(ctx.m, FLIP) : ctx.m;
    const P = (c: number) => [num(e, c) || 0, num(e, c + 10) || 0] as [number, number];
    switch (e.type) {
      case 'LINE': {
        const [x1, y1] = P(10);
        const [x2, y2] = P(11);
        emit(m, [x1, y1, x2, y2], color, 0);
        if (top) {
          snap(m, x1, y1, SNAP.end);
          snap(m, x2, y2, SNAP.end);
          snap(m, (x1 + x2) / 2, (y1 + y2) / 2, SNAP.mid);
        }
        break;
      }
      case 'RAY':
      case 'XLINE': {
        const [x, y] = P(10);
        const [dx, dy] = P(11);
        const L = 1e6;
        emit(m, [e.type === 'RAY' ? x : x - dx * L, e.type === 'RAY' ? y : y - dy * L, x + dx * L, y + dy * L], color, 0);
        break;
      }
      case 'POINT': {
        const [x, y] = P(10);
        emit(m, [x, y], color, 4);
        if (top) snap(m, x, y, SNAP.node);
        break;
      }
      case 'CIRCLE': {
        const [x, y] = P(10);
        const r = num(e, 40);
        emitArc(m, x, y, r, 0, 2 * Math.PI, color);
        if (top) {
          snap(m, x, y, SNAP.center);
          for (let q = 0; q < 4; q++) snap(m, x + r * Math.cos((q * Math.PI) / 2), y + r * Math.sin((q * Math.PI) / 2), SNAP.quadrant);
        }
        break;
      }
      case 'ARC': {
        const [x, y] = P(10);
        const r = num(e, 40);
        const a0 = (num(e, 50) * Math.PI) / 180;
        const sw = ccwSweep(a0, (num(e, 51) * Math.PI) / 180);
        emitArc(m, x, y, r, a0, sw, color);
        if (top) {
          snap(m, x, y, SNAP.center);
          snap(m, x + r * Math.cos(a0), y + r * Math.sin(a0), SNAP.end);
          snap(m, x + r * Math.cos(a0 + sw), y + r * Math.sin(a0 + sw), SNAP.end);
          snap(m, x + r * Math.cos(a0 + sw / 2), y + r * Math.sin(a0 + sw / 2), SNAP.mid);
        }
        break;
      }
      case 'ELLIPSE': {
        const [x, y] = P(10);
        const [mx, my] = P(11);
        const t0 = num(e, 41) || 0;
        let t1 = num(e, 42);
        if (!Number.isFinite(t1)) t1 = 2 * Math.PI;
        const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
        emit(m, ellipsePoints(x, y, mx, my, num(e, 40) || 1, t0, t1, num(e, 230) < 0), color, full ? 1 : 0);
        if (top) {
          snap(m, x, y, SNAP.center);
          snap(m, x + mx, y + my, SNAP.quadrant);
          snap(m, x - mx, y - my, SNAP.quadrant);
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const flags = num(e, 70) || 0;
        if (e.type === 'POLYLINE' && flags & (16 | 64)) {
          // Polygon / polyface mesh: draw the vertex net as points' outline.
          const v = e.children.filter((c) => c.type === 'VERTEX' && num(c, 70) & 64);
          for (const c of v) emit(m, [num(c, 10), num(c, 20)], color, 4);
          break;
        }
        const v = e.type === 'LWPOLYLINE' ? lwVertices(e) : polyVertices(e);
        const closed = !!(flags & 1);
        const pts = bulgePolyline(v, closed);
        const w = e.type === 'LWPOLYLINE' ? num(e, 43) : num(e, 40);
        emit(m, pts, color, closed ? 1 : 0);
        if (w > 0 && pts.length >= 4) {
          // Wide polylines: show the width as an outline band.
          const band = widthBand(pts, w / 2, closed);
          if (band) emit(m, band, color, 3);
        }
        if (top) {
          v.forEach((p, k) => {
            snap(m, p.x, p.y, SNAP.end);
            const q = v[k + 1] ?? (closed ? v[0] : null);
            if (q && !p.b) snap(m, (p.x + q.x) / 2, (p.y + q.y) / 2, SNAP.mid);
          });
        }
        break;
      }
      case 'SPLINE': {
        const pts = splinePoints(e);
        emit(m, pts, color, num(e, 70) & 1 ? 1 : 0);
        if (top && pts.length >= 2) {
          snap(m, pts[0], pts[1], SNAP.end);
          snap(m, pts[pts.length - 2], pts[pts.length - 1], SNAP.end);
        }
        break;
      }
      case 'SOLID':
      case 'TRACE':
      case '3DFACE': {
        const p = [P(10), P(11), P(12), P(13)];
        const order = e.type === '3DFACE' ? [0, 1, 2, 3] : [0, 1, 3, 2];
        const pts = order.flatMap((k) => p[k]);
        emit(m, pts, color, e.type === '3DFACE' ? 1 : 3);
        if (top) for (const [x, y] of p) snap(m, x, y, SNAP.end);
        break;
      }
      case 'HATCH': {
        const h = hatch(e);
        for (const loop of h.loops) emit(m, loop, color, h.solid ? 3 : 1);
        break;
      }
      case 'LEADER': {
        const pts = pairs(e.groups, 10, 20).flat();
        emit(m, pts, color, 0);
        if (pts.length >= 4) {
          // Arrow head.
          const [x0, y0, x1, y1] = pts;
          const a = Math.atan2(y1 - y0, x1 - x0);
          const s = (num(e, 41) || 2.5) * 0.18 * 10;
          emit(m, [x0 + s * Math.cos(a + 0.3), y0 + s * Math.sin(a + 0.3), x0, y0, x0 + s * Math.cos(a - 0.3), y0 + s * Math.sin(a - 0.3)], color, 3);
        }
        break;
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'ATTDEF': {
        if (e.type === 'ATTRIB' && num(e, 70) & 1) break;
        if (e.type === 'ATTDEF' && !top) break;
        const hz = num(e, 72) || 0;
        const vt = num(e, e.type === 'TEXT' ? 73 : 74) || 0;
        const at = hz || vt ? P(11) : P(10);
        const [x, y] = hz === 3 || hz === 5 ? P(10) : at;
        const s = e.type === 'ATTDEF' ? str(e, 2) : str(e, 1);
        const ax = hz === 1 || hz === 4 ? 0.5 : hz === 2 ? 1 : 0;
        const ay = hz === 4 ? 0.5 : vt === 2 ? 0.5 : vt === 3 ? 1 : 0;
        text(m, e, color, decodeText(s), x, y, num(e, 40) || 1, ((num(e, 50) || 0) * Math.PI) / 180, ax, ay);
        if (top) snap(m, x, y, SNAP.node);
        break;
      }
      case 'MTEXT': {
        const [x, y] = P(10);
        const raw = e.groups
          .filter((g) => g.code === 3)
          .map((g) => g.value)
          .join('') + str(e, 1);
        const att = num(e, 71) || 1;
        const ax = [0, 0.5, 1][(att - 1) % 3];
        const ay = [1, 0.5, 0][Math.floor((att - 1) / 3)];
        let rot = num(e, 50) || 0; // radians
        const dir = e.groups.findIndex((g) => g.code === 11);
        if (dir >= 0) rot = Math.atan2(num(e, 21) || 0, num(e, 11) || 0);
        // MTEXT 10 is in WCS: undo the OCS flip.
        text(ctx.m, e, color, decodeText(mtextPlain(raw)), x, y, num(e, 40) || 1, rot, ax, ay);
        if (top) snap(ctx.m, x, y, SNAP.node);
        break;
      }
      case 'INSERT':
      case 'DIMENSION': {
        const b = d.blocks.get(str(e, 2));
        if (e.type === 'INSERT') {
          const [x, y] = P(10);
          if (top) snap(m, x, y, SNAP.node);
          if (!b || ctx.depth > 16) break;
          const sx = num(e, 41) || 1;
          const sy = num(e, 42) || 1;
          const rot = ((num(e, 50) || 0) * Math.PI) / 180;
          const cols = Math.max(1, num(e, 70) || 1);
          const rows = Math.max(1, num(e, 71) || 1);
          for (let cI = 0; cI < cols; cI++)
            for (let rI = 0; rI < rows; rI++) {
              const off = linear(rotateAbout(rot, 0, 0), cI * (num(e, 44) || 0), rI * (num(e, 45) || 0));
              const local: M = mul(mul(translate(x + off[0], y + off[1]), rotateAbout(rot, 0, 0)), mul([sx, 0, 0, sy, 0, 0], translate(-b.base[0], -b.base[1])));
              const inner: Ctx = { m: mul(m, local), layer, color, depth: ctx.depth + 1 };
              for (const c of b.entities) draw(c, inner, false);
            }
          for (const c of e.children) if (c.type === 'ATTRIB') draw(c, { m: ctx.m, layer, color, depth: ctx.depth + 1 }, false);
        } else if (b && ctx.depth <= 16) {
          const inner: Ctx = { m: ctx.m, layer, color, depth: ctx.depth + 1 };
          for (const c of b.entities) draw(c, inner, false);
          if (top) for (const c of [10, 13, 14]) if (Number.isFinite(num(e, c))) snap(ctx.m, num(e, c), num(e, c + 10), SNAP.end);
        }
        break;
      }
    }
  };

  for (let k = 0; k < n; k++) {
    cur = k;
    entPoly[k] = polys.length / 5;
    const e = d.entities[k];
    entLayer[k] = li(e.layer);
    draw(e, { m: IDENT, layer: '', color: FG, depth: 0 }, true);
    const b = k * 4;
    if (boxes[b] <= boxes[b + 2]) {
      bminx = Math.min(bminx, boxes[b]);
      bminy = Math.min(bminy, boxes[b + 1]);
      bmaxx = Math.max(bmaxx, boxes[b + 2]);
      bmaxy = Math.max(bmaxy, boxes[b + 3]);
    }
  }
  entPoly[n] = polys.length / 5;
  return {
    origin: [Number.isNaN(ox) ? 0 : ox, Number.isNaN(oy) ? 0 : oy],
    coords: Float64Array.from(coords),
    polys: Int32Array.from(polys),
    entPoly,
    texts,
    boxes,
    snaps: Float64Array.from(snaps),
    entLayer,
    layers,
    bounds: bminx <= bmaxx ? [bminx, bminy, bmaxx, bmaxy] : null,
  };
}

/** End points of an arc and its axis crossings: enough for its bounding box. */
export function arcExtremes(cx: number, cy: number, r: number, a0: number, sweep: number): [number, number][] {
  const out: [number, number][] = [
    [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
    [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)],
  ];
  const lo = Math.min(a0, a0 + sweep);
  const hi = Math.max(a0, a0 + sweep);
  for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
    const a = k * (Math.PI / 2);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** The points of polyline p of a scene (arcs tessellated). */
export function polyPoints(s: Scene, p: number): number[] {
  const c = s.coords;
  const start = s.polys[p * 5 + 2];
  const n = s.polys[p * 5 + 3];
  if (s.polys[p * 5 + 4] & 8) return arcPoints(c[start * 2], c[start * 2 + 1], c[start * 2 + 2], c[start * 2 + 3], c[start * 2 + 4]);
  return Array.from(c.subarray(start * 2, (start + n) * 2));
}

/** Outline of a polyline drawn with a constant width (miter joins). */
function widthBand(pts: number[], hw: number, closed: boolean): number[] | null {
  const n = pts.length / 2;
  if (n < 2) return null;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const pi = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const ni = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    let dx = pts[ni * 2] - pts[pi * 2];
    let dy = pts[ni * 2 + 1] - pts[pi * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    left.push(pts[i * 2] - dy * hw, pts[i * 2 + 1] + dx * hw);
    right.push(pts[i * 2] + dy * hw, pts[i * 2 + 1] - dx * hw);
  }
  const out = [...left];
  for (let i = n - 1; i >= 0; i--) out.push(right[i * 2], right[i * 2 + 1]);
  return out;
}

/** DXF text escapes: %%c ⌀, %%d °, %%p ±, %%u/%%o (underline/overline toggles, dropped), \U+XXXX. */
export function decodeText(s: string): string {
  return s
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------- measurements ----------

/** Length and (for closed shapes) area of an entity, in drawing units. */
export function measure(e: Entity): { length?: number; area?: number } {
  const len = (p: number[], closed: boolean) => {
    let l = 0;
    const n = p.length / 2;
    for (let i = 1; i < n; i++) l += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    if (closed && n > 1) l += Math.hypot(p[0] - p[n * 2 - 2], p[1] - p[n * 2 - 1]);
    return l;
  };
  const area = (p: number[]) => {
    let a = 0;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    return Math.abs(a) / 2;
  };
  switch (e.type) {
    case 'LINE':
      return { length: Math.hypot(num(e, 11) - num(e, 10), num(e, 21) - num(e, 20)) };
    case 'CIRCLE':
      return { length: 2 * Math.PI * num(e, 40), area: Math.PI * num(e, 40) ** 2 };
    case 'ARC': {
      const sw = ccwSweep((num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180);
      return { length: sw * num(e, 40) };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const closed = !!(num(e, 70) & 1);
      const p = bulgePolyline(e.type === 'LWPOLYLINE' ? lwVertices(e) : polyVertices(e), closed);
      return closed ? { length: len(p, true), area: area(p) } : { length: len(p, false) };
    }
    case 'SPLINE': {
      const p = splinePoints(e);
      return { length: len(p, false) };
    }
    case 'ELLIPSE': {
      const p = ellipsePoints(0, 0, num(e, 11), num(e, 21), num(e, 40) || 1, num(e, 41) || 0, Number.isFinite(num(e, 42)) ? num(e, 42) : 2 * Math.PI, false);
      const full = Math.abs((num(e, 42) || 2 * Math.PI) - (num(e, 41) || 0) - 2 * Math.PI) < 1e-9;
      return full ? { length: len(p, true), area: area(p) } : { length: len(p, false) };
    }
  }
  return {};
}
