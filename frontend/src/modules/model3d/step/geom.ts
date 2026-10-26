// Curves and surfaces of STEP B-rep models: evaluation and the inverse
// (a point to its parameters). Analytic kinds are exact; B-splines and swept
// surfaces use a sampled first guess refined by Newton steps.

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-300 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const TAU = Math.PI * 2;

/** A right-handed frame: origin and axes. */
export interface Frame {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}

export function frame(o: V3, z?: V3 | null, x?: V3 | null): Frame {
  const zz = norm(z ?? [0, 0, 1]);
  let xx = x ? sub(x, mul(zz, dot(x, zz))) : null;
  if (!xx || len(xx) < 1e-12) xx = Math.abs(zz[0]) < 0.9 ? cross([0, 1, 0], zz) : cross(zz, [0, 0, 1]);
  xx = norm(xx);
  return { o, x: xx, y: cross(zz, xx), z: zz };
}

const local = (f: Frame, p: V3): V3 => {
  const d = sub(p, f.o);
  return [dot(d, f.x), dot(d, f.y), dot(d, f.z)];
};
const world = (f: Frame, x: number, y: number, z: number): V3 => [
  f.o[0] + f.x[0] * x + f.y[0] * y + f.z[0] * z,
  f.o[1] + f.x[1] * x + f.y[1] * y + f.z[1] * z,
  f.o[2] + f.x[2] * x + f.y[2] * y + f.z[2] * z,
];

// ---------- B-splines ----------

export interface BSpline {
  degree: number;
  knots: number[]; // expanded (with multiplicities)
  weights?: number[];
}

/** Knot span index for t. */
function span(b: BSpline, n: number, t: number): number {
  const p = b.degree;
  const k = b.knots;
  if (t >= k[n + 1]) return n;
  if (t <= k[p]) return p;
  let lo = p;
  let hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (t < k[mid] || t >= k[mid + 1]) {
    if (t < k[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/** The p+1 non-zero basis functions at t. */
function basis(b: BSpline, i: number, t: number): number[] {
  const p = b.degree;
  const k = b.knots;
  const N = new Array<number>(p + 1).fill(0);
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = t - k[i + 1 - j];
    right[j] = k[i + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const d = right[r + 1] + left[j - r];
      const temp = d === 0 ? 0 : N[r] / d;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

export function expandKnots(mults: number[], knots: number[]): number[] {
  const out: number[] = [];
  knots.forEach((k, i) => {
    for (let m = 0; m < (mults[i] ?? 1); m++) out.push(k);
  });
  return out;
}

// ---------- curves ----------

export interface Curve {
  at(t: number): V3;
  /** The parameter of the point on the curve nearest p. */
  param(p: V3): number;
  /** Parameter range (periodic curves: one period). */
  t0: number;
  t1: number;
  periodic: boolean;
  /** Straight: two points are enough. */
  straight?: boolean;
  /** Samples for a full sweep, before the angle/deviation tolerance (B-splines: by spans). */
  samples(tol: number, from: number, to: number): number;
}

export function lineCurve(o: V3, d: V3): Curve {
  const dd = dot(d, d) || 1;
  return { at: (t) => add(o, mul(d, t)), param: (p) => dot(sub(p, o), d) / dd, t0: -Infinity, t1: Infinity, periodic: false, straight: true, samples: () => 1 };
}

function arcSamples(r: number, tol: number, sweep: number): number {
  const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4;
  return Math.max(2, Math.min(256, Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 8))));
}

export function circleCurve(f: Frame, r: number): Curve {
  return {
    at: (t) => world(f, r * Math.cos(t), r * Math.sin(t), 0),
    param: (p) => {
      const l = local(f, p);
      const a = Math.atan2(l[1], l[0]);
      return a < 0 ? a + TAU : a;
    },
    t0: 0,
    t1: TAU,
    periodic: true,
    samples: (tol, a, b) => arcSamples(r, tol, b - a),
  };
}

export function ellipseCurve(f: Frame, a: number, b: number): Curve {
  return {
    at: (t) => world(f, a * Math.cos(t), b * Math.sin(t), 0),
    param: (p) => {
      const l = local(f, p);
      const t = Math.atan2(l[1] / b, l[0] / a);
      return t < 0 ? t + TAU : t;
    },
    t0: 0,
    t1: TAU,
    periodic: true,
    samples: (tol, x, y) => arcSamples(Math.max(a, b), tol, y - x),
  };
}

/** Nearest parameter by sampling then refining (golden section) in the best interval. */
function nearestParam(at: (t: number) => V3, p: V3, t0: number, t1: number, n = 64): number {
  let best = t0;
  let bd = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const d = dist(at(t), p);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  let lo = Math.max(t0, best - (t1 - t0) / n);
  let hi = Math.min(t1, best + (t1 - t0) / n);
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (dist(at(m1), p) < dist(at(m2), p)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

export function bsplineCurve(b: BSpline, pts: V3[]): Curve {
  const n = pts.length - 1;
  const t0 = b.knots[b.degree];
  const t1 = b.knots[n + 1];
  const at = (t: number): V3 => {
    const s = span(b, n, Math.min(t1, Math.max(t0, t)));
    const N = basis(b, s, Math.min(t1, Math.max(t0, t)));
    let x = 0;
    let y = 0;
    let z = 0;
    let w = 0;
    for (let j = 0; j <= b.degree; j++) {
      const k = s - b.degree + j;
      const c = pts[k];
      const wt = (b.weights?.[k] ?? 1) * N[j];
      x += c[0] * wt;
      y += c[1] * wt;
      z += c[2] * wt;
      w += wt;
    }
    return w ? [x / w, y / w, z / w] : [x, y, z];
  };
  const spans = new Set(b.knots).size - 1;
  return {
    at,
    param: (p) => nearestParam(at, p, t0, t1, Math.max(32, spans * 8)),
    t0,
    t1,
    periodic: false,
    samples: (_tol, a, c) => Math.max(4, Math.min(400, Math.ceil(Math.max(1, spans) * (b.degree === 1 ? 1 : 10) * Math.abs(c - a) / Math.max(1e-12, t1 - t0)))),
  };
}

/** A curve given in a surface's (u, v) parameters (x = u, y = v), in 3D. */
export function curveOnSurface(c: Curve, s: Surface): Curve {
  return {
    ...c,
    straight: false,
    at: (t) => {
      const q = c.at(t);
      return s.at(q[0], q[1]);
    },
    param: (p) => {
      const [u, v] = s.uv(p);
      return c.param([u, v, 0]);
    },
    samples: (tol, a, b) => Math.max(16, c.samples(tol, a, b)),
  };
}

export function polylineCurve(pts: V3[]): Curve {
  // Parameter: the index along the points (fractions within a segment).
  const at = (t: number): V3 => {
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(t)));
    const f = t - i;
    return add(mul(pts[i], 1 - f), mul(pts[i + 1], f));
  };
  return { at, param: (p) => nearestParam(at, p, 0, pts.length - 1, (pts.length - 1) * 8), t0: 0, t1: pts.length - 1, periodic: false, samples: () => pts.length - 1 };
}

// ---------- surfaces ----------

export interface Surface {
  at(u: number, v: number): V3;
  normal(u: number, v: number): V3;
  /** The parameters of a point on (or near) the surface; hint: a nearby (u, v) for periodic/ambiguous cases. */
  uv(p: V3, hint?: [number, number]): [number, number];
  periodicU: number; // 0 or the period
  periodicV: number;
  /** Parameter domain (for faces without bounds and numeric inverses). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Metric scale of u and v near the middle (so a triangulation in (u, v) isn't skewed). */
  su: number;
  sv: number;
  planar?: boolean;
  /** v values where u is meaningless (poles of spheres, a cone's apex). */
  poles?: number[];
  /**
   * The domain is the whole surface (a sphere, a torus, a B-spline patch), so a
   * face without usable bounds is all of it. A plane's or a cylinder's domain
   * only stands in for an unbounded surface.
   */
  whole?: boolean;
}

/** Partial derivatives by central differences (for normals of numeric surfaces). */
function numericNormal(at: (u: number, v: number) => V3, u: number, v: number, du: number, dv: number): V3 {
  const pu = sub(at(u + du, v), at(u - du, v));
  const pv = sub(at(u, v + dv), at(u, v - dv));
  return norm(cross(pu, pv));
}

/** Newton refinement of (u, v) for at(u, v) ≈ p from a first guess. */
function refineUV(at: (u: number, v: number) => V3, p: V3, u: number, v: number, du: number, dv: number, s: Surface): [number, number] {
  for (let k = 0; k < 12; k++) {
    const q = at(u, v);
    const r = sub(p, q);
    if (len(r) < 1e-9) break;
    const su = mul(sub(at(u + du, v), at(u - du, v)), 1 / (2 * du));
    const sv = mul(sub(at(u, v + dv), at(u, v - dv)), 1 / (2 * dv));
    const a = dot(su, su);
    const b = dot(su, sv);
    const c = dot(sv, sv);
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-24) break;
    const ru = dot(r, su);
    const rv = dot(r, sv);
    const nu = u + (c * ru - b * rv) / det;
    const nv = v + (a * rv - b * ru) / det;
    u = s.periodicU ? nu : Math.max(s.u0, Math.min(s.u1, nu));
    v = s.periodicV ? nv : Math.max(s.v0, Math.min(s.v1, nv));
  }
  return [u, v];
}

/** A numeric inverse: the nearest of a grid of samples, then Newton. */
function numericUV(s: Surface, grid = 24): (p: V3) => [number, number] {
  let pts: { u: number; v: number; q: V3 }[] | null = null;
  return (p) => {
    pts ??= Array.from({ length: (grid + 1) * (grid + 1) }, (_, i) => {
      const u = s.u0 + ((s.u1 - s.u0) * (i % (grid + 1))) / grid;
      const v = s.v0 + ((s.v1 - s.v0) * Math.floor(i / (grid + 1))) / grid;
      return { u, v, q: s.at(u, v) };
    });
    let best = pts[0];
    let bd = Infinity;
    for (const g of pts) {
      const d = dist(g.q, p);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    const du = Math.max(1e-7, (s.u1 - s.u0) * 1e-5);
    const dv = Math.max(1e-7, (s.v1 - s.v0) * 1e-5);
    return refineUV((u, v) => s.at(u, v), p, best.u, best.v, du, dv, s);
  };
}

export function planeSurface(f: Frame): Surface {
  return {
    at: (u, v) => world(f, u, v, 0),
    normal: () => f.z,
    uv: (p) => {
      const l = local(f, p);
      return [l[0], l[1]];
    },
    periodicU: 0,
    periodicV: 0,
    u0: -1e6,
    u1: 1e6,
    v0: -1e6,
    v1: 1e6,
    su: 1,
    sv: 1,
    planar: true,
  };
}

const angle = (y: number, x: number) => {
  const a = Math.atan2(y, x);
  return a < 0 ? a + TAU : a;
};

export function cylinderSurface(f: Frame, r: number): Surface {
  return {
    at: (u, v) => world(f, r * Math.cos(u), r * Math.sin(u), v),
    normal: (u) => norm(world({ ...f, o: [0, 0, 0] }, Math.cos(u), Math.sin(u), 0)),
    uv: (p) => {
      const l = local(f, p);
      return [angle(l[1], l[0]), l[2]];
    },
    periodicU: TAU,
    periodicV: 0,
    u0: 0,
    u1: TAU,
    v0: -r,
    v1: r,
    su: r,
    sv: 1,
  };
}

export function coneSurface(f: Frame, r: number, semi: number): Surface {
  const tan = Math.tan(semi);
  const rad = (v: number) => r + v * tan;
  return {
    at: (u, v) => world(f, rad(v) * Math.cos(u), rad(v) * Math.sin(u), v),
    normal: (u, v) => {
      const radial = world({ ...f, o: [0, 0, 0] }, Math.cos(u), Math.sin(u), 0);
      const n = norm(sub(radial, mul(f.z, tan)));
      return rad(v) < 0 ? mul(n, -1) : n;
    },
    uv: (p) => {
      const l = local(f, p);
      return [angle(l[1], l[0]), l[2]];
    },
    periodicU: TAU,
    periodicV: 0,
    u0: 0,
    u1: TAU,
    v0: -r,
    v1: r,
    su: Math.max(r, 1e-6),
    sv: Math.sqrt(1 + tan * tan),
    poles: tan !== 0 ? [-r / tan] : [],
  };
}

export function sphereSurface(f: Frame, r: number): Surface {
  return {
    at: (u, v) => world(f, r * Math.cos(v) * Math.cos(u), r * Math.cos(v) * Math.sin(u), r * Math.sin(v)),
    normal: (u, v) => norm(world({ ...f, o: [0, 0, 0] }, Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v))),
    uv: (p) => {
      const l = local(f, p);
      return [angle(l[1], l[0]), Math.atan2(l[2], Math.hypot(l[0], l[1]))];
    },
    periodicU: TAU,
    periodicV: 0,
    u0: 0,
    u1: TAU,
    v0: -Math.PI / 2,
    v1: Math.PI / 2,
    su: r,
    sv: r,
    poles: [-Math.PI / 2, Math.PI / 2],
    whole: true,
  };
}

export function torusSurface(f: Frame, R: number, r: number): Surface {
  return {
    at: (u, v) => world(f, (R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)),
    normal: (u, v) => norm(world({ ...f, o: [0, 0, 0] }, Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v))),
    uv: (p) => {
      const l = local(f, p);
      const u = angle(l[1], l[0]);
      const d = Math.hypot(l[0], l[1]) - R;
      return [u, angle(l[2], d)];
    },
    periodicU: TAU,
    periodicV: TAU,
    u0: 0,
    u1: TAU,
    v0: 0,
    v1: TAU,
    su: R,
    sv: r,
    whole: true,
  };
}

export function bsplineSurface(bu: BSpline, bv: BSpline, pts: V3[][], uClosed: boolean, vClosed: boolean): Surface {
  const nu = pts.length - 1;
  const nv = pts[0].length - 1;
  const u0 = bu.knots[bu.degree];
  const u1 = bu.knots[nu + 1];
  const v0 = bv.knots[bv.degree];
  const v1 = bv.knots[nv + 1];
  const w = bu.weights; // flattened weights[i * (nv+1) + j] when rational
  const at = (u: number, v: number): V3 => {
    u = Math.min(u1, Math.max(u0, u));
    v = Math.min(v1, Math.max(v0, v));
    const su = span(bu, nu, u);
    const sv = span(bv, nv, v);
    const Nu = basis(bu, su, u);
    const Nv = basis(bv, sv, v);
    let x = 0;
    let y = 0;
    let z = 0;
    let ws = 0;
    for (let a = 0; a <= bu.degree; a++) {
      const i = su - bu.degree + a;
      for (let b = 0; b <= bv.degree; b++) {
        const j = sv - bv.degree + b;
        const c = pts[i][j];
        const wt = Nu[a] * Nv[b] * (w ? w[i * (nv + 1) + j] : 1);
        x += c[0] * wt;
        y += c[1] * wt;
        z += c[2] * wt;
        ws += wt;
      }
    }
    return ws ? [x / ws, y / ws, z / ws] : [x, y, z];
  };
  // Metric scale: the control net's extent per unit of parameter.
  const span3 = (a: V3, b: V3) => dist(a, b);
  let lu = 0;
  let lv = 0;
  for (let i = 0; i < nu; i++) lu += span3(pts[i][nv >> 1], pts[i + 1][nv >> 1]);
  for (let j = 0; j < nv; j++) lv += span3(pts[nu >> 1][j], pts[nu >> 1][j + 1]);
  const s: Surface = {
    at,
    normal: (u, v) => numericNormal(at, u, v, (u1 - u0) * 1e-4, (v1 - v0) * 1e-4),
    uv: () => [0, 0],
    periodicU: 0,
    periodicV: 0,
    u0,
    u1,
    v0,
    v1,
    su: Math.max(1e-9, lu / Math.max(1e-12, u1 - u0)),
    sv: Math.max(1e-9, lv / Math.max(1e-12, v1 - v0)),
    whole: true,
  };
  void uClosed;
  void vClosed;
  s.uv = numericUV(s, Math.min(40, Math.max(12, (nu + nv) * 2)));
  return s;
}

/** A curve swept around an axis (u: the angle, v: the curve's parameter). */
export function revolutionSurface(c: Curve, axisO: V3, axisD: V3): Surface {
  const z = norm(axisD);
  // Rotation of a point around the axis by angle u.
  const rot = (p: V3, u: number): V3 => {
    const d = sub(p, axisO);
    const along = mul(z, dot(d, z));
    const perp = sub(d, along);
    const w = cross(z, perp);
    return add(add(axisO, along), add(mul(perp, Math.cos(u)), mul(w, Math.sin(u))));
  };
  const t0 = Number.isFinite(c.t0) ? c.t0 : -1;
  const t1 = Number.isFinite(c.t1) ? c.t1 : 1;
  const at = (u: number, v: number) => rot(c.at(v), u);
  let maxR = 0;
  for (let i = 0; i <= 16; i++) {
    const d = sub(c.at(t0 + ((t1 - t0) * i) / 16), axisO);
    maxR = Math.max(maxR, len(sub(d, mul(z, dot(d, z)))));
  }
  const s: Surface = {
    at,
    normal: (u, v) => numericNormal(at, u, v, 1e-4, (t1 - t0) * 1e-4),
    uv: () => [0, 0],
    periodicU: TAU,
    periodicV: 0,
    u0: 0,
    u1: TAU,
    v0: t0,
    v1: t1,
    su: Math.max(1e-6, maxR),
    sv: Math.max(1e-9, dist(c.at(t0), c.at(t1)) / Math.max(1e-12, t1 - t0)),
    whole: Number.isFinite(c.t0) && Number.isFinite(c.t1),
  };
  s.uv = numericUV(s);
  return s;
}

/** A curve swept along a direction (u: the curve's parameter, v: the distance). */
export function extrusionSurface(c: Curve, d: V3): Surface {
  const t0 = Number.isFinite(c.t0) ? c.t0 : -1;
  const t1 = Number.isFinite(c.t1) ? c.t1 : 1;
  const dl = len(d) || 1;
  const dn = norm(d);
  const at = (u: number, v: number) => add(c.at(u), mul(dn, v));
  const s: Surface = {
    at,
    normal: (u, v) => numericNormal(at, u, v, (t1 - t0) * 1e-4, dl * 1e-4),
    uv: (p) => {
      // The curve parameter of p moved back onto the curve's plane, then the distance.
      let u = c.param(p);
      for (let k = 0; k < 3; k++) {
        const q = c.at(u);
        const v = dot(sub(p, q), dn);
        u = c.param(sub(p, mul(dn, v)));
      }
      return [u, dot(sub(p, c.at(u)), dn)];
    },
    periodicU: c.periodic ? c.t1 - c.t0 : 0,
    periodicV: 0,
    u0: t0,
    u1: t1,
    v0: -dl,
    v1: dl,
    su: Math.max(1e-9, dist(c.at(t0), c.at((t0 + t1) / 2)) / Math.max(1e-12, (t1 - t0) / 2)),
    sv: 1,
  };
  return s;
}

/** A surface moved along its normal. */
export function offsetSurface(b: Surface, d: number): Surface {
  return { ...b, at: (u, v) => add(b.at(u, v), mul(b.normal(u, v), d)), uv: (p, h) => b.uv(p, h) };
}
