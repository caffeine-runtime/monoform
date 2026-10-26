// Triangles for one B-rep face: its bounding loops (3D points, from the
// shared edge samples so neighbouring faces meet exactly) are mapped into the
// surface's (u, v) parameters, triangulated there, and the triangles are
// split where the surface bends away from them. Periodic surfaces (a full
// cylinder, a sphere cap) get their seam and poles closed in (u, v) first.

import { Earcut } from 'three/src/extras/Earcut.js';
import { add, cross, dist, dot, len, mul, sub, type Surface, type V3 } from './geom';

export interface Loop {
  pts: V3[]; // closed implicitly (last ≠ first)
}

export interface FaceInput {
  surface: Surface;
  sameSense: boolean;
  loops: Loop[];
}

export interface MeshOut {
  positions: number[];
  normals: number[];
  indices: number[];
}

interface Vtx {
  u: number;
  v: number;
  p: V3;
}

const wrap = (d: number, period: number) => d - period * Math.round(d / period);

/** A loop in (u, v): unwrapped along periodic directions, poles given their neighbours' u. */
function toUV(s: Surface, pts: V3[]): Vtx[] {
  const out: Vtx[] = [];
  let prev: [number, number] | undefined;
  for (const p of pts) {
    let [u, v] = s.uv(p, prev);
    if (prev) {
      if (s.periodicU) u = prev[0] + wrap(u - prev[0], s.periodicU);
      if (s.periodicV) v = prev[1] + wrap(v - prev[1], s.periodicV);
    }
    out.push({ u, v, p });
    prev = [u, v];
  }
  // At a pole u means nothing: take it from the neighbours.
  if (s.poles?.length) {
    const atPole = out.map((x) => s.poles!.some((pv) => Math.abs(x.v - pv) < 1e-6 * Math.max(1, Math.abs(pv))));
    for (let i = 0; i < out.length; i++) {
      if (!atPole[i]) continue;
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[(i + 1) % out.length];
      out[i].u = atPole[(i + 1) % out.length] ? a.u : atPole[(i - 1 + out.length) % out.length] ? b.u : (a.u + b.u) / 2;
    }
  }
  return out;
}

/** How far around a period a closed loop goes in u (0, or ±period when it circles the surface). */
function turns(loop: Vtx[], period: number, key: 'u' | 'v'): number {
  if (!period) return 0;
  const first = loop[0][key];
  const last = loop[loop.length - 1][key];
  const total = last - first + wrap(first - last, period);
  return Math.round(total / period);
}

function area(loop: Vtx[], su: number, sv: number): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.u * su * q.v * sv - q.u * su * p.v * sv;
  }
  return a / 2;
}

function shift(loop: Vtx[], du: number, dv = 0): Vtx[] {
  return du || dv ? loop.map((x) => ({ ...x, u: x.u + du, v: x.v + dv })) : loop;
}

function dedupe(loop: Vtx[], eps: number): Vtx[] {
  const out: Vtx[] = [];
  for (const x of loop) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.u - x.u) > eps || Math.abs(last.v - x.v) > eps) out.push(x);
  }
  while (out.length > 1 && Math.abs(out[0].u - out[out.length - 1].u) <= eps && Math.abs(out[0].v - out[out.length - 1].v) <= eps) out.pop();
  return out;
}

const inside = (ring: Vtx[], x: number, y: number, su: number, sv: number): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const ay = a.v * sv;
    const by = b.v * sv;
    if (ay > y !== by > y && x < ((b.u - a.u) * su * (y - ay)) / (by - ay) + a.u * su) c = !c;
  }
  return c;
};

/**
 * Points inside a curved face (a grid as fine as its boundary samples, kept
 * off the boundary), so that its triangles follow the surface rather than
 * cutting across it from one side of the boundary to the other.
 */
function steinerPoints(contour: Vtx[], holes: Vtx[][], su: number, sv: number, maxPoints: number): Vtx[] {
  const rings = [contour, ...holes];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let perimeter = 0;
  let n = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const x = r[i].u * su;
      const y = r[i].v * sv;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const q = r[(i + 1) % r.length];
      perimeter += Math.hypot((q.u - r[i].u) * su, (q.v - r[i].v) * sv);
      n++;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0 && h > 0)) return [];
  const step = Math.max(perimeter / n, Math.sqrt((w * h) / Math.max(16, maxPoints / 4)));
  const segs: [number, number, number, number][] = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) segs.push([r[i].u * su, r[i].v * sv, r[(i + 1) % r.length].u * su, r[(i + 1) % r.length].v * sv]);
  const near = (x: number, y: number) => {
    const lim = (step * 0.6) ** 2;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax;
      const dy = by - ay;
      const l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
      if ((ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 < lim) return true;
    }
    return false;
  };
  const out: Vtx[] = [];
  const nx = Math.floor(w / step);
  const ny = Math.floor(h / step);
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      // Every other row shifted half a step: nearer equilateral triangles.
      const x = minX + ((i + (j % 2) * 0.5) * w) / (nx + 1);
      const y = minY + (j * h) / (ny + 1);
      if (!inside(contour, x, y, su, sv) || holes.some((hr) => inside(hr, x, y, su, sv)) || near(x, y)) continue;
      out.push({ u: x / su, v: y / sv, p: [0, 0, 0] });
    }
  }
  return out;
}

/**
 * Ear clipping (with the inner points as Steiner points), then Delaunay
 * edge flips so that no triangle is a sliver along the boundary. Boundary
 * samples on one straight (u, v) line are kept apart by a tiny warp: ear
 * clipping would otherwise drop the ones between.
 */
function triangulate(verts: Vtx[], outer: number, holeLens: number[], ringCount: number, su: number, sv: number): number[][] | null {
  let minX = Infinity;
  let minY = Infinity;
  let span = 0;
  for (const x of verts) {
    minX = Math.min(minX, x.u * su);
    minY = Math.min(minY, x.v * sv);
  }
  for (const x of verts) span = Math.max(span, x.u * su - minX, x.v * sv - minY);
  span ||= 1;
  const eps = 1e-6 * span;
  const P = verts.map((x) => {
    const X = x.u * su - minX;
    const Y = x.v * sv - minY;
    return [X + eps * (Y / span) ** 2, Y + eps * (X / span) ** 2] as [number, number];
  });
  const flat: number[] = [];
  for (const p of P) flat.push(p[0], p[1]);
  const holeIdx: number[] = [];
  let at = outer;
  for (const l of holeLens) {
    holeIdx.push(at);
    at += l;
  }
  for (let i = ringCount; i < verts.length; i++) holeIdx.push(i);
  let idx: number[];
  try {
    idx = Earcut.triangulate(flat, holeIdx);
  } catch {
    return null;
  }
  if (!idx.length) return null;
  const orient = (a: number, b: number, c: number) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  const tris: number[][] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    tris.push(orient(a, b, c) >= 0 ? [a, b, c] : [a, c, b]);
  }
  // Constrained edges: the rings' sides.
  const key = (a: number, b: number) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const fixed = new Set<number>();
  let base = 0;
  for (const len of [outer, ...holeLens]) {
    for (let i = 0; i < len; i++) fixed.add(key(base + i, base + ((i + 1) % len)));
    base += len;
  }
  const byEdge = new Map<number, number[]>();
  const link = (t: number) => {
    const [a, b, c] = tris[t];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = key(x, y);
      const l = byEdge.get(k);
      if (l) l.push(t);
      else byEdge.set(k, [t]);
    }
  };
  const unlink = (t: number) => {
    const [a, b, c] = tris[t];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = key(x, y);
      const l = byEdge.get(k);
      if (l) byEdge.set(k, l.filter((u) => u !== t));
    }
  };
  tris.forEach((_, t) => link(t));
  const inCircle = (a: number, b: number, c: number, d: number) => {
    const [ax, ay] = [P[a][0] - P[d][0], P[a][1] - P[d][1]];
    const [bx, by] = [P[b][0] - P[d][0], P[b][1] - P[d][1]];
    const [cx, cy] = [P[c][0] - P[d][0], P[c][1] - P[d][1]];
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay) > 0;
  };
  const stack = [...byEdge.keys()];
  // (Ear clipping leaves long slivers: getting to Delaunay can take many flips.)
  let budget = tris.length * 3000;
  while (stack.length && budget-- > 0) {
    const k = stack.pop()!;
    if (fixed.has(k)) continue;
    const ts = byEdge.get(k);
    if (!ts || ts.length !== 2) continue;
    const [t1, t2] = ts;
    const a = Math.floor(k / 1e7);
    const b = k % 1e7;
    const c = tris[t1].find((x) => x !== a && x !== b)!;
    const d = tris[t2].find((x) => x !== a && x !== b)!;
    // t1 as (p, q, c) counter-clockwise; d lies beyond pq.
    const r1 = tris[t1];
    const i = r1.indexOf(c);
    const p = r1[(i + 1) % 3];
    const q = r1[(i + 2) % 3];
    if (!inCircle(p, q, c, d)) continue;
    if (orient(p, d, c) <= 0 || orient(d, q, c) <= 0) continue; // not convex
    unlink(t1);
    unlink(t2);
    tris[t1] = [p, d, c];
    tris[t2] = [d, q, c];
    link(t1);
    link(t2);
    stack.push(key(p, d), key(d, q), key(q, c), key(c, p));
  }
  return tris;
}

/**
 * Triangulate a face into out. tol: how far (model units) a triangle may stay
 * from the surface; maxTris caps refinement on huge faces.
 */
export function tessellateFace(f: FaceInput, tol: number, out: MeshOut, maxTris = 20000): boolean {
  const s = f.surface;
  let loops = f.loops.filter((l) => l.pts.length >= 2).map((l) => toUV(s, l.pts));
  const su = s.su || 1;
  const sv = s.sv || 1;
  const eps = 1e-9 * Math.max(1, Math.abs(s.u1 - s.u0), Math.abs(s.v1 - s.v0));
  loops = loops.map((l) => dedupe(l, eps)).filter((l) => l.length >= 2);

  // Loops that go round the surface (u or v) don't close in (u, v).
  const spanU = loops.filter((l) => turns(l, s.periodicU, 'u') !== 0);
  const spanV = loops.filter((l) => !spanU.includes(l) && turns(l, s.periodicV, 'v') !== 0);
  // (A seam walked there and back encloses nothing: such a face is the whole surface.)
  const flat = (l: Vtx[]) => {
    const us = l.map((x) => x.u * su);
    const vs = l.map((x) => x.v * sv);
    const d = Math.hypot(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs));
    return Math.abs(area(l, su, sv)) <= 1e-9 * d * d;
  };
  const closed = loops.filter((l) => !spanU.includes(l) && !spanV.includes(l) && l.length >= 3 && !flat(l));

  let contour: Vtx[] | null = null;
  const faceSign = f.sameSense ? 1 : -1;
  // The cut that opens a periodic face is no edge of the model: sampled
  // along the surface so it doesn't cut across it (both sides of the cut
  // get the same points, one period apart).
  const seam = (a: Vtx, b: Vtx): Vtx[] => {
    let n = 1;
    const at = (t: number) => s.at(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t);
    for (; n < 256; n *= 2) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const m = at((i + 0.5) / n);
        const chord = mul(add(at(i / n), at((i + 1) / n)), 0.5);
        ok = dist(m, chord) <= tol;
      }
      if (ok) break;
    }
    return Array.from({ length: n - 1 }, (_, i) => {
      const t = (i + 1) / n;
      const u = a.u + (b.u - a.u) * t;
      const v = a.v + (b.v - a.v) * t;
      return { u, v, p: s.at(u, v) };
    });
  };
  // A loop round the surface, closed: its first point again one period on.
  const closeRound = (l: Vtx[], key: 'u' | 'v', period: number): Vtx[] => {
    const t = turns(l, period, key);
    return [...l, { ...l[0], [key]: l[0][key] + t * period }];
  };
  const band = (span: Vtx[][], key: 'u' | 'v', period: number): Vtx[] => {
    const other = key === 'u' ? 'v' : 'u';
    const A = closeRound(span[0], key, period);
    const dir = Math.sign(A[A.length - 1][key] - A[0][key]) || 1;
    const end = A[A.length - 1][key];
    if (span.length >= 2) {
      // Two loops round the surface (a band): along one, back along the other,
      // the second starting where the first ends.
      let B = closeRound(span[1], key, period);
      if (Math.sign(B[B.length - 1][key] - B[0][key]) === dir) B = [...B].reverse();
      const off = Math.round((end - B[0][key]) / period) * period;
      B = key === 'u' ? shift(B, off) : shift(B, 0, off);
      return [...A, ...seam(A[A.length - 1], B[0]), ...B, ...seam(B[B.length - 1], A[0])];
    }
    // One loop round the surface: closed by the pole on the face's side. The
    // face lies left of its loop seen from its normal: going +u that is +v,
    // going +v it is −u.
    const want = dir * faceSign * (key === 'u' ? 1 : -1);
    const lo = key === 'u' ? s.v0 : s.u0;
    const hi = key === 'u' ? s.v1 : s.u1;
    const ref = A.reduce((n, x) => n + x[other], 0) / A.length;
    const cand = (s.poles ?? []).filter((pv) => (want > 0 ? pv >= ref : pv <= ref));
    const pole = cand.length ? cand.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a)) : want > 0 ? hi : lo;
    const mk = (k: number): Vtx => {
      const u = key === 'u' ? k : pole;
      const v = key === 'u' ? pole : k;
      return { u, v, p: s.at(u, v) };
    };
    const p1 = mk(end);
    const p2 = mk(A[0][key]);
    return [...A, ...seam(A[A.length - 1], p1), p1, p2, ...seam(p2, A[0])];
  };
  if (spanU.length) contour = band(spanU, 'u', s.periodicU);
  else if (spanV.length) contour = band(spanV, 'v', s.periodicV);
  let holes: Vtx[][] = [];
  if (!contour) {
    if (closed.length) {
      let best = 0;
      for (let i = 1; i < closed.length; i++) if (Math.abs(area(closed[i], su, sv)) > Math.abs(area(closed[best], su, sv))) best = i;
      contour = closed[best];
      holes = closed.filter((_, i) => i !== best);
    } else {
      // No bounds (a whole sphere or torus): the full parameter domain. On a
      // plane or a cylinder that is a stand-in: such a face (two edges
      // between the same two points) encloses nothing.
      if (!s.whole) return false;
      const n = 24;
      const rect: Vtx[] = [];
      const corner = (u: number, v: number) => ({ u, v, p: s.at(u, v) });
      for (let i = 0; i < n; i++) rect.push(corner(s.u0 + ((s.u1 - s.u0) * i) / n, s.v0));
      for (let i = 0; i < n; i++) rect.push(corner(s.u1, s.v0 + ((s.v1 - s.v0) * i) / n));
      for (let i = 0; i < n; i++) rect.push(corner(s.u1 - ((s.u1 - s.u0) * i) / n, s.v1));
      for (let i = 0; i < n; i++) rect.push(corner(s.u0, s.v1 - ((s.v1 - s.v0) * i) / n));
      contour = rect;
    }
  } else holes = closed;
  contour = dedupe(contour, eps);
  if (contour.length < 3) return false;

  // Holes into the contour's periodic range.
  if (s.periodicU || s.periodicV) {
    const cu = contour.reduce((n, x) => n + x.u, 0) / contour.length;
    const cv = contour.reduce((n, x) => n + x.v, 0) / contour.length;
    holes = holes.map((h) => {
      const hu = h.reduce((n, x) => n + x.u, 0) / h.length;
      const hv = h.reduce((n, x) => n + x.v, 0) / h.length;
      return shift(h, s.periodicU ? -Math.round((hu - cu) / s.periodicU) * s.periodicU : 0, s.periodicV ? -Math.round((hv - cv) / s.periodicV) * s.periodicV : 0);
    });
  }

  // Triangulate in scaled (u, v).
  const verts: Vtx[] = [...contour, ...holes.flat()];
  const ringCount = verts.length;
  if (!s.planar) verts.push(...steinerPoints(contour, holes, su, sv, Math.min(6000, maxTris)).map((x) => ({ ...x, p: s.at(x.u, x.v) })));
  const tris = triangulate(verts, contour.length, holes.map((h) => h.length), ringCount, su, sv);
  if (!tris) return false;

  // Boundary edges stay as they are (they are shared with the next face).
  const boundary = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  let base = 0;
  for (const ring of [contour, ...holes]) {
    for (let i = 0; i < ring.length; i++) boundary.add(key(base + i, base + ((i + 1) % ring.length)));
    base += ring.length;
  }

  // Split interior edges where the surface leaves the chord.
  let faces = tris;
  if (!s.planar) {
    const mids = new Map<string, number>();
    const cosLimit = Math.cos((20 * Math.PI) / 180);
    const needs = (a: number, b: number): boolean => {
      if (boundary.has(key(a, b))) return false;
      const A = verts[a];
      const B = verts[b];
      const mu = (A.u + B.u) / 2;
      const mv = (A.v + B.v) / 2;
      const m = s.at(mu, mv);
      const chord = mul(add(A.p, B.p), 0.5);
      if (dist(m, chord) > tol) return true;
      return dot(s.normal(A.u, A.v), s.normal(B.u, B.v)) < cosLimit && dist(A.p, B.p) > tol * 4;
    };
    const mid = (a: number, b: number): number => {
      const k = key(a, b);
      let m = mids.get(k);
      if (m === undefined) {
        const A = verts[a];
        const B = verts[b];
        const u = (A.u + B.u) / 2;
        const v = (A.v + B.v) / 2;
        m = verts.length;
        verts.push({ u, v, p: s.at(u, v) });
        mids.set(k, m);
      }
      return m;
    };
    for (let pass = 0; pass < 6 && faces.length < maxTris; pass++) {
      const split = new Map<string, boolean>();
      const want = (a: number, b: number) => {
        const k = key(a, b);
        let w = split.get(k);
        if (w === undefined) split.set(k, (w = needs(a, b)));
        return w;
      };
      let any = false;
      const next: number[][] = [];
      for (const [a, b, c] of faces) {
        const ab = want(a, b);
        const bc = want(b, c);
        const ca = want(c, a);
        const n = +ab + +bc + +ca;
        if (!n) {
          next.push([a, b, c]);
          continue;
        }
        any = true;
        if (n === 3) {
          const x = mid(a, b);
          const y = mid(b, c);
          const z = mid(c, a);
          next.push([a, x, z], [x, b, y], [z, y, c], [x, y, z]);
        } else if (n === 1) {
          if (ab) next.push([a, mid(a, b), c], [mid(a, b), b, c]);
          else if (bc) next.push([a, b, mid(b, c)], [a, mid(b, c), c]);
          else next.push([a, b, mid(c, a)], [mid(c, a), b, c]);
        } else {
          // Two edges: split them and fan the rest.
          if (!ab) {
            const y = mid(b, c);
            const z = mid(c, a);
            next.push([a, b, y], [a, y, z], [z, y, c]);
          } else if (!bc) {
            const x = mid(a, b);
            const z = mid(c, a);
            next.push([a, x, z], [x, b, c], [x, c, z]);
          } else {
            const x = mid(a, b);
            const y = mid(b, c);
            next.push([a, x, c], [x, b, y], [x, y, c]);
          }
        }
      }
      faces = next;
      if (!any) break;
    }
  }

  // Out: positions, normals (the face's side), triangles wound to match.
  const start = out.positions.length / 3;
  const flip = f.sameSense ? 1 : -1;
  const ns: V3[] = verts.map((x) => mul(s.normal(x.u, x.v), flip));
  for (let i = 0; i < verts.length; i++) {
    out.positions.push(verts[i].p[0], verts[i].p[1], verts[i].p[2]);
    out.normals.push(ns[i][0], ns[i][1], ns[i][2]);
  }
  for (const [a, b, c] of faces) {
    const n = cross(sub(verts[b].p, verts[a].p), sub(verts[c].p, verts[a].p));
    if (len(n) === 0) continue;
    const want = add(add(ns[a], ns[b]), ns[c]);
    if (dot(n, want) >= 0) out.indices.push(start + a, start + b, start + c);
    else out.indices.push(start + a, start + c, start + b);
  }
  return true;
}
