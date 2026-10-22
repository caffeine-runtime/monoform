// STEP (AP203 / AP214 / AP242) B-rep models as three.js meshes. Edges are
// sampled once and shared by the faces on both sides, faces are triangulated
// on their surfaces (tess.ts), and the product structure is kept: each part's
// shape is built once and placed wherever the assembly uses it. Colours come
// from the styled items (part, shell or single faces).

import * as THREE from 'three';
import { t } from '../../../core/i18n';
import { hasType, isEnum, isRef, parseStep, partOf, type Entity, type Value } from './p21';
import {
  bsplineCurve,
  bsplineSurface,
  circleCurve,
  coneSurface,
  curveOnSurface,
  cylinderSurface,
  dist,
  ellipseCurve,
  expandKnots,
  extrusionSurface,
  frame,
  lineCurve,
  mul,
  norm,
  offsetSurface,
  planeSurface,
  polylineCurve,
  revolutionSurface,
  sphereSurface,
  sub,
  torusSurface,
  type BSpline,
  type Curve,
  type Frame,
  type Surface,
  type V3,
} from './geom';
import { tessellateFace, type FaceInput, type MeshOut } from './tess';

const DEFAULT_COLOUR = 0xb9b4ac;
const EDGE_COLOUR = 0x2b2b2b;
const PREDEFINED: Record<string, number> = { red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, magenta: 0xff00ff, cyan: 0x00ffff, black: 0x000000, white: 0xffffff };
const SOLIDS = ['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL', 'FACE_BASED_SURFACE_MODEL'];

interface Look {
  colour: number;
  opacity: number;
}

const isTyped = (v: Value | undefined): v is { typed: string; args: Value[] } => !!v && typeof v === 'object' && 'typed' in v;
const num = (v: Value | undefined): number => (typeof v === 'number' ? v : isTyped(v) ? num(v.args[0]) : 0);
const list = (v: Value | undefined): Value[] => (Array.isArray(v) ? v : []);
const bool = (v: Value | undefined) => !(isEnum(v) && v.enum === 'F');

/** Parse a STEP file and build its model (Z up, as in the file). progress: 0…1. */
export function stepToScene(text: string, progress?: (f: number) => void): THREE.Group {
  const file = parseStep(text, (f) => progress?.(f * 0.3));
  const E = file.entities;
  const ent = (v: Value | undefined): Entity | undefined => (isRef(v) ? E.get(v.ref) : undefined);

  // ---- units: plane angles may be in degrees ----
  let angleScale = 1;
  for (const e of E.values()) {
    if (!e.parts || !hasType(e, 'PLANE_ANGLE_UNIT') || !hasType(e, 'CONVERSION_BASED_UNIT')) continue;
    const factor = ent(partOf(e, 'CONVERSION_BASED_UNIT')?.[1]);
    const value = num(factor?.args[0]);
    if (value > 0) angleScale = value;
    break;
  }

  // ---- points, directions, placements ----
  const point = (v: Value | undefined): V3 => {
    const c = list(ent(v)?.args[1]);
    return [num(c[0]), num(c[1]), num(c[2])];
  };
  const direction = (v: Value | undefined): V3 | null => {
    const e = ent(v);
    if (!e) return null;
    const c = list(e.args[1]);
    return [num(c[0]), num(c[1]), num(c[2])];
  };
  const vertex = (v: Value | undefined): V3 => point(ent(v)?.args[1]);
  const placement = (v: Value | undefined): Frame => {
    const e = ent(v);
    if (!e) return frame([0, 0, 0]);
    const o = point(e.args[1]);
    if (e.type === 'AXIS2_PLACEMENT_3D') return frame(o, direction(e.args[2]), direction(e.args[3]));
    if (e.type === 'AXIS2_PLACEMENT_2D') return frame(o, null, direction(e.args[2]));
    return frame(o, direction(e.args[2])); // AXIS1_PLACEMENT
  };
  const matrix = (v: Value | undefined): THREE.Matrix4 => {
    const e = ent(v);
    const m = new THREE.Matrix4();
    if (!e) return m;
    if (e.type === 'CARTESIAN_TRANSFORMATION_OPERATOR_3D') {
      // (name, description, axis1, axis2, local_origin, scale, axis3)
      const f = frame(point(e.args[4]), direction(e.args[6]), direction(e.args[2]));
      const s = typeof e.args[5] === 'number' ? e.args[5] : 1;
      return m.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z)).scale(new THREE.Vector3(s, s, s)).setPosition(...f.o);
    }
    const f = placement(v);
    return m.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z)).setPosition(...f.o);
  };

  // ---- curves ----
  const knotsFor = (n: number, p: number, mults: Value | undefined, knots: Value | undefined, closedForm: boolean): number[] | null => {
    if (mults !== undefined) {
      const k = expandKnots(list(mults).map(num), list(knots).map(num));
      return k.length === n + p + 1 ? k : null;
    }
    // Bézier / quasi-uniform (clamped) or uniform knots.
    const inner = n - p;
    if (closedForm) return Array.from({ length: n + p + 1 }, (_, i) => i - p);
    return [...new Array<number>(p + 1).fill(0), ...Array.from({ length: Math.max(0, inner - 1) }, (_, i) => i + 1), ...new Array<number>(p + 1).fill(Math.max(1, inner))];
  };
  const curves = new Map<number, Curve | null>();
  const curve = (v: Value | undefined, depth = 0): Curve | null => {
    if (!isRef(v) || depth > 8) return null;
    if (curves.has(v.ref)) return curves.get(v.ref)!;
    const e = E.get(v.ref);
    let c: Curve | null = null;
    try {
      c = e ? makeCurve(e, depth) : null;
    } catch {
      c = null;
    }
    curves.set(v.ref, c);
    return c;
  };
  const makeCurve = (e: Entity, depth: number): Curve | null => {
    const a = e.args;
    switch (e.type) {
      case 'LINE': {
        const vec = ent(a[2]);
        const d = direction(vec?.args[1]) ?? [1, 0, 0];
        return lineCurve(point(a[1]), mul(norm(d), num(vec?.args[2]) || 1));
      }
      case 'CIRCLE':
        return circleCurve(placement(a[1]), num(a[2]));
      case 'ELLIPSE':
        return ellipseCurve(placement(a[1]), num(a[2]), num(a[3]));
      case 'SURFACE_CURVE':
      case 'SEAM_CURVE':
      case 'INTERSECTION_CURVE':
        return curve(a[1], depth + 1) ?? list(a[2]).map((g) => curve(g, depth + 1)).find((x) => x) ?? null;
      case 'TRIMMED_CURVE':
        return curve(a[1], depth + 1);
      case 'POLYLINE':
        return polylineCurve(list(a[1]).map(point));
      case 'PCURVE': {
        const s = surface(a[1]);
        const c2 = curve(list(ent(a[2])?.args[1])[0], depth + 1);
        return s && c2 ? curveOnSurface(c2, s) : null;
      }
    }
    // B-splines, simple or complex (rational, Bézier, uniform …).
    const simple = e.type === 'B_SPLINE_CURVE_WITH_KNOTS' ? a : undefined;
    const bs = simple ? simple.slice(1) : partOf(e, 'B_SPLINE_CURVE') ?? (hasType(e, 'BEZIER_CURVE') || hasType(e, 'UNIFORM_CURVE') || hasType(e, 'QUASI_UNIFORM_CURVE') ? a.slice(1) : undefined);
    if (!bs) return null;
    const pts = list(bs[1]).map(point);
    const p = num(bs[0]);
    const k = simple ? [simple[6], simple[7]] : (partOf(e, 'B_SPLINE_CURVE_WITH_KNOTS') ?? []);
    const knots = knotsFor(pts.length, p, k[0], k[1], hasType(e, 'UNIFORM_CURVE'));
    if (!knots || pts.length <= p) return null;
    const w = partOf(e, 'RATIONAL_B_SPLINE_CURVE')?.[0];
    const b: BSpline = { degree: p, knots, weights: w ? list(w).map(num) : undefined };
    return bsplineCurve(b, pts);
  };

  // ---- surfaces ----
  const surfaces = new Map<number, Surface | null>();
  const surface = (v: Value | undefined, depth = 0): Surface | null => {
    if (!isRef(v) || depth > 8) return null;
    if (surfaces.has(v.ref)) return surfaces.get(v.ref)!;
    const e = E.get(v.ref);
    let s: Surface | null = null;
    try {
      s = e ? makeSurface(e, depth) : null;
    } catch {
      s = null;
    }
    surfaces.set(v.ref, s);
    return s;
  };
  const makeSurface = (e: Entity, depth: number): Surface | null => {
    const a = e.args;
    switch (e.type) {
      case 'PLANE':
        return planeSurface(placement(a[1]));
      case 'CYLINDRICAL_SURFACE':
        return cylinderSurface(placement(a[1]), num(a[2]));
      case 'CONICAL_SURFACE': {
        let semi = num(a[3]) * angleScale;
        if (Math.abs(semi) >= Math.PI / 2) semi *= Math.PI / 180; // degrees without a declared unit
        return coneSurface(placement(a[1]), num(a[2]), semi);
      }
      case 'SPHERICAL_SURFACE':
        return sphereSurface(placement(a[1]), num(a[2]));
      case 'TOROIDAL_SURFACE':
      case 'DEGENERATE_TOROIDAL_SURFACE':
        return torusSurface(placement(a[1]), num(a[2]), num(a[3]));
      case 'SURFACE_OF_REVOLUTION': {
        const c = curve(a[1]);
        const axis = ent(a[2]);
        return c && axis ? revolutionSurface(c, point(axis.args[1]), direction(axis.args[2]) ?? [0, 0, 1]) : null;
      }
      case 'SURFACE_OF_LINEAR_EXTRUSION': {
        const c = curve(a[1]);
        const vec = ent(a[2]);
        return c ? extrusionSurface(c, mul(norm(direction(vec?.args[1]) ?? [0, 0, 1]), num(vec?.args[2]) || 1)) : null;
      }
      case 'OFFSET_SURFACE': {
        const b = surface(a[1], depth + 1);
        return b ? offsetSurface(b, num(a[2])) : null;
      }
      case 'RECTANGULAR_TRIMMED_SURFACE':
      case 'CURVE_BOUNDED_SURFACE':
        return surface(a[1], depth + 1);
    }
    const simple = e.type === 'B_SPLINE_SURFACE_WITH_KNOTS' ? a : undefined;
    const bs = simple ? simple.slice(1) : partOf(e, 'B_SPLINE_SURFACE') ?? (hasType(e, 'BEZIER_SURFACE') || hasType(e, 'UNIFORM_SURFACE') || hasType(e, 'QUASI_UNIFORM_SURFACE') ? a.slice(1) : undefined);
    if (!bs) return null;
    const pts = list(bs[2]).map((row) => list(row).map(point));
    if (!pts.length || !pts[0].length) return null;
    const pu = num(bs[0]);
    const pv = num(bs[1]);
    const k = simple ? [simple[8], simple[9], simple[10], simple[11]] : (partOf(e, 'B_SPLINE_SURFACE_WITH_KNOTS') ?? []);
    const uniform = hasType(e, 'UNIFORM_SURFACE');
    const ku = knotsFor(pts.length, pu, k[0], k[2], uniform);
    const kv = knotsFor(pts[0].length, pv, k[1], k[3], uniform);
    if (!ku || !kv || pts.length <= pu || pts[0].length <= pv) return null;
    const w = partOf(e, 'RATIONAL_B_SPLINE_SURFACE')?.[0];
    const weights = w ? list(w).flatMap((row) => list(row).map(num)) : undefined;
    return bsplineSurface({ degree: pu, knots: ku, weights }, { degree: pv, knots: kv }, pts, bool(bs[4]), bool(bs[5]));
  };

  // ---- model size: the tolerance for curves and surfaces ----
  const box = new THREE.Box3();
  const grow = (p: V3) => box.expandByPoint(new THREE.Vector3(...p));
  for (const e of E.values()) if (e.type === 'VERTEX_POINT') grow(point(e.args[1]));
  if (box.isEmpty()) for (const e of E.values()) if (e.type === 'CARTESIAN_POINT' && list(e.args[1]).length === 3) grow([num(list(e.args[1])[0]), num(list(e.args[1])[1]), num(list(e.args[1])[2])]);
  const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length() || 1;
  const tol = size * 5e-4;

  // ---- edges: sampled once, from the start vertex to the end vertex ----
  const edges = new Map<number, V3[]>();
  const edgePoints = (v: Value | undefined): V3[] => {
    if (!isRef(v)) return [];
    let pts = edges.get(v.ref);
    if (pts) return pts;
    const e = E.get(v.ref);
    pts = [];
    if (e && e.type === 'EDGE_CURVE') {
      const ps = vertex(e.args[1]);
      const pe = vertex(e.args[2]);
      const c = curve(e.args[3]);
      const sense = bool(e.args[4]);
      const sameVertex = isRef(e.args[1]) && isRef(e.args[2]) && e.args[1].ref === e.args[2].ref;
      if (!c || c.straight) pts = [ps, pe];
      else {
        let a = c.param(ps);
        let b = c.param(pe);
        const closed = sameVertex || dist(ps, pe) < tol * 1e-3;
        if (c.periodic) {
          const P = c.t1 - c.t0;
          if (closed) b = a + (sense ? P : -P);
          else if (sense) {
            while (b <= a) b += P;
            while (b - a > P) b -= P;
          } else {
            while (b >= a) b -= P;
            while (a - b > P) b += P;
          }
        } else if (closed && Number.isFinite(c.t0) && Number.isFinite(c.t1)) {
          a = sense ? c.t0 : c.t1;
          b = sense ? c.t1 : c.t0;
        }
        const n = Math.max(1, c.samples(tol, a, b));
        pts.push(ps);
        for (let i = 1; i < n; i++) pts.push(c.at(a + ((b - a) * i) / n));
        pts.push(pe);
      }
    } else if (e && e.type === 'ORIENTED_EDGE') {
      pts = edgePoints(e.args[3]);
      if (!bool(e.args[4])) pts = [...pts].reverse();
    }
    edges.set(v.ref, pts);
    return pts;
  };

  // ---- colours ----
  const lookOf = (styles: Value): Look | null => {
    let colour: number | undefined;
    let opacity = 1;
    const seen = new Set<number>();
    const walk = (v: Value, depth: number) => {
      if (depth > 12 || colour !== undefined) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
      if (!isRef(v) || seen.has(v.ref)) return;
      seen.add(v.ref);
      const e = E.get(v.ref);
      if (!e || e.type === 'CURVE_STYLE' || e.type === 'POINT_STYLE' || e.type === 'TEXT_STYLE') return;
      const rgb = partOf(e, 'COLOUR_RGB');
      if (rgb) colour = (Math.round(num(rgb[1]) * 255) << 16) | (Math.round(num(rgb[2]) * 255) << 8) | Math.round(num(rgb[3]) * 255);
      else if (e.type === 'DRAUGHTING_PRE_DEFINED_COLOUR') colour = PREDEFINED[String(e.args[0]).toLowerCase()];
      else if (e.type === 'SURFACE_STYLE_TRANSPARENT') opacity = 1 - num(e.args[0]);
      else for (const x of e.args) walk(x, depth + 1);
      // A transparency may come after the colour (rendering properties).
      if (colour !== undefined && e.type === 'SURFACE_STYLE_RENDERING_WITH_PROPERTIES') for (const x of list(e.args[2])) walk(x, depth + 1);
    };
    walk(styles, 0);
    return colour === undefined ? null : { colour, opacity: Math.max(0.05, Math.min(1, opacity)) };
  };
  const looks = new Map<number, Look>();
  for (const pass of ['STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM']) {
    for (const e of E.values()) {
      if (e.type !== pass || !isRef(e.args[2])) continue;
      const look = lookOf(e.args[1]);
      if (look) looks.set(e.args[2].ref, look);
    }
  }

  // ---- faces and solids ----
  const totalFaces = [...E.values()].filter((e) => e.type === 'ADVANCED_FACE' || e.type === 'FACE_SURFACE').length || 1;
  let facesDone = 0;
  const loopPoints = (v: Value | undefined, usedEdges: Set<number>): V3[] => {
    const e = ent(v);
    if (!e) return [];
    if (e.type === 'POLY_LOOP') return list(e.args[1]).map(point);
    if (e.type === 'VERTEX_LOOP') return [vertex(e.args[1])];
    if (e.type !== 'EDGE_LOOP') return [];
    const out: V3[] = [];
    for (const oe of list(e.args[1])) {
      const pts = edgePoints(oe);
      const edge = ent(oe)?.args[3];
      if (isRef(edge)) usedEdges.add(edge.ref);
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    }
    return out;
  };
  const planeThrough = (pts: V3[]): Surface | null => {
    if (pts.length < 3) return null;
    // Newell's normal and the centroid.
    let n: V3 = [0, 0, 0];
    const c: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      n = [n[0] + (p[1] - q[1]) * (p[2] + q[2]), n[1] + (p[2] - q[2]) * (p[0] + q[0]), n[2] + (p[0] - q[0]) * (p[1] + q[1])];
      c[0] += p[0] / pts.length;
      c[1] += p[1] / pts.length;
      c[2] += p[2] / pts.length;
    }
    return planeSurface(frame(c, norm(n), sub(pts[1], pts[0])));
  };

  /** One solid or surface model: meshes by colour, plus its edges. */
  const buildSolid = (id: number): THREE.Object3D[] => {
    const solid = E.get(id)!;
    const shells: { v: Value; flip: boolean }[] = [];
    const a = solid.args;
    if (solid.type === 'BREP_WITH_VOIDS') shells.push({ v: a[1], flip: false }, ...list(a[2]).map((v) => ({ v, flip: false })));
    else if (solid.type === 'SHELL_BASED_SURFACE_MODEL' || solid.type === 'FACE_BASED_SURFACE_MODEL') shells.push(...list(a[1]).map((v) => ({ v, flip: false })));
    else shells.push({ v: a[1], flip: false });
    const byLook = new Map<string, { look: Look; out: MeshOut }>();
    const usedEdges = new Set<number>();
    const solidLook = looks.get(id);
    for (const sh of shells) {
      let shell = ent(sh.v);
      let flip = sh.flip;
      if (shell?.type === 'ORIENTED_CLOSED_SHELL' || shell?.type === 'ORIENTED_OPEN_SHELL') {
        flip = !bool(shell.args[3]);
        shell = ent(shell.args[2]);
      }
      if (!shell) continue;
      const shellLook = isRef(sh.v) ? looks.get(sh.v.ref) : undefined;
      for (const fv of list(shell.args[1])) {
        let face = ent(fv);
        let faceFlip = flip;
        let faceId = isRef(fv) ? fv.ref : -1;
        if (face?.type === 'ORIENTED_FACE') {
          faceFlip = faceFlip !== !bool(face.args[3]);
          faceId = isRef(face.args[2]) ? face.args[2].ref : -1;
          face = ent(face.args[2]);
        }
        if (!face) continue;
        const loops = list(face.args[1]).map((bv) => {
          const b = ent(bv);
          const pts = loopPoints(b?.args[1], usedEdges);
          return { pts: b && !bool(b.args[2]) ? pts.reverse() : pts, outer: b?.type === 'FACE_OUTER_BOUND' };
        });
        const s = surface(face.args[2]) ?? planeThrough((loops.find((l) => l.outer) ?? loops[0])?.pts ?? []);
        if (!s) continue;
        const look = looks.get(faceId) ?? shellLook ?? solidLook ?? { colour: DEFAULT_COLOUR, opacity: 1 };
        const k = `${look.colour}/${look.opacity}`;
        let bucket = byLook.get(k);
        if (!bucket) byLook.set(k, (bucket = { look, out: { positions: [], normals: [], indices: [] } }));
        const input: FaceInput = { surface: s, sameSense: bool(face.args[3]) !== faceFlip, loops };
        try {
          tessellateFace(input, tol, bucket.out);
        } catch {
          /* a face that can't be triangulated is left out */
        }
        facesDone++;
        if (progress && facesDone % 50 === 0) progress(0.3 + (0.7 * facesDone) / totalFaces);
      }
    }
    const objects: THREE.Object3D[] = [];
    for (const { look, out } of byLook.values()) {
      if (!out.indices.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normals, 3));
      g.setIndex(out.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(out.indices, 1) : new THREE.Uint16BufferAttribute(out.indices, 1));
      const m = new THREE.MeshStandardMaterial({
        color: look.colour,
        metalness: 0.1,
        roughness: 0.6,
        side: THREE.DoubleSide,
        transparent: look.opacity < 1,
        opacity: look.opacity,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      objects.push(new THREE.Mesh(g, m));
    }
    if (usedEdges.size) {
      const seg: number[] = [];
      for (const id of usedEdges) {
        const pts = edgePoints({ ref: id });
        for (let i = 0; i < pts.length - 1; i++) seg.push(...pts[i], ...pts[i + 1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: EDGE_COLOUR }));
      lines.name = 'edges';
      objects.push(lines);
    }
    return objects;
  };

  // ---- product structure ----
  // Representations joined without a transformation share one coordinate
  // space (a part's shape representation and its B-rep): one group.
  const up = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (up.has(r)) r = up.get(r)!;
    let y = x;
    while (y !== r) {
      const n = up.get(y)!;
      up.set(y, r);
      y = n;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) up.set(rb, ra);
  };
  const repItems = (e: Entity): Value[] | undefined => {
    if (e.parts) return hasType(e, 'SHAPE_REPRESENTATION') ? list(partOf(e, 'REPRESENTATION')?.[1]) : undefined;
    return /SHAPE_REPRESENTATION$/.test(e.type) ? list(e.args[1]) : undefined;
  };
  // Product definitions → their shape representation, for naming and for
  // telling an assembly from its component.
  const pdRep = new Map<number, number>();
  for (const e of E.values()) {
    if (e.type !== 'SHAPE_DEFINITION_REPRESENTATION' || !isRef(e.args[1])) continue;
    // (Not a shape aspect's or another property's representation.)
    const pds = ent(e.args[0]);
    const pd = pds?.type === 'PRODUCT_DEFINITION_SHAPE' ? pds.args[2] : undefined;
    if (isRef(pd) && ent(pd)?.type.startsWith('PRODUCT_DEFINITION')) pdRep.set(pd.ref, e.args[1].ref);
  }
  interface Link {
    parent: number;
    child: number;
    m: THREE.Matrix4;
  }
  const transformed: { rel: number; rep1: number; rep2: number; m12: THREE.Matrix4; m21: THREE.Matrix4 }[] = [];
  for (const [id, e] of E) {
    const rr = e.type === 'SHAPE_REPRESENTATION_RELATIONSHIP' || e.type === 'REPRESENTATION_RELATIONSHIP' ? e.args : partOf(e, 'REPRESENTATION_RELATIONSHIP');
    if (!rr || !isRef(rr[2]) || !isRef(rr[3])) continue;
    const t = partOf(e, 'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION')?.[0];
    if (!t) {
      union(rr[2].ref, rr[3].ref);
      continue;
    }
    const idt = ent(t);
    if (!idt) continue;
    // Item 1 (in rep 1) is placed onto item 2 (in rep 2).
    const m1 = matrix(idt.args[2]);
    const m2 = matrix(idt.args[3]);
    transformed.push({ rel: id, rep1: rr[2].ref, rep2: rr[3].ref, m12: m2.clone().multiply(m1.clone().invert()), m21: m1.clone().multiply(m2.clone().invert()) });
  }
  // Which side is the assembly: the next assembly usage's relating product.
  const assemblyOf = new Map<number, number>();
  for (const e of E.values()) {
    if (e.type !== 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION' || !isRef(e.args[0])) continue;
    const nauo = ent(ent(e.args[1])?.args[2]);
    const relating = nauo?.args[3];
    if (isRef(relating) && pdRep.has(relating.ref)) assemblyOf.set(e.args[0].ref, pdRep.get(relating.ref)!);
  }
  const links: Link[] = [];
  for (const t of transformed) {
    const asm = assemblyOf.get(t.rel);
    if (asm !== undefined && find(asm) === find(t.rep1)) links.push({ parent: find(t.rep1), child: find(t.rep2), m: t.m21 });
    else links.push({ parent: find(t.rep2), child: find(t.rep1), m: t.m12 });
  }
  // Each group's items: solids here, mapped items as more links.
  const groupSolids = new Map<number, number[]>();
  for (const [id, e] of E) {
    const items = repItems(e);
    if (!items) continue;
    const g = find(id);
    for (const it of items) {
      const x = ent(it);
      if (!x || !isRef(it)) continue;
      if (SOLIDS.includes(x.type)) {
        const arr = groupSolids.get(g) ?? [];
        if (!arr.includes(it.ref)) arr.push(it.ref);
        groupSolids.set(g, arr);
      } else if (x.type === 'MAPPED_ITEM') {
        const map = ent(x.args[1]); // REPRESENTATION_MAP(origin, representation)
        if (!map || !isRef(map.args[1])) continue;
        links.push({ parent: g, child: find(map.args[1].ref), m: matrix(x.args[2]).multiply(matrix(map.args[0]).invert()) });
      }
    }
  }
  const children = new Map<number, Link[]>();
  const isChild = new Set<number>();
  for (const l of links) {
    if (l.parent === l.child) continue;
    children.set(l.parent, [...(children.get(l.parent) ?? []), l]);
    isChild.add(l.child);
  }
  // Names: the product of a group.
  const groupName = new Map<number, string>();
  for (const [pd, rep] of pdRep) {
    const product = ent(ent(E.get(pd)?.args[2])?.args[2]);
    const name = product ? String(product.args[1] || product.args[0] || '') : '';
    if (name) groupName.set(find(rep), name);
  }

  const built = new Map<number, THREE.Object3D[]>();
  const used = new Set<number>();
  const solidObjects = (id: number) => {
    used.add(id);
    let o = built.get(id);
    if (!o) built.set(id, (o = buildSolid(id)));
    return o;
  };
  const instance = (g: number, stack: Set<number>): THREE.Object3D | null => {
    if (stack.has(g) || stack.size > 32) return null;
    const grp = new THREE.Group();
    grp.name = groupName.get(g) ?? '';
    for (const s of groupSolids.get(g) ?? []) for (const o of solidObjects(s)) grp.add(o.parent ? o.clone() : o);
    stack.add(g);
    for (const l of children.get(g) ?? []) {
      const c = instance(l.child, stack);
      if (!c) continue;
      l.m.decompose(c.position, c.quaternion, c.scale);
      grp.add(c);
    }
    stack.delete(g);
    return grp.children.length ? grp : null;
  };

  const root = new THREE.Group();
  root.name = file.name;
  // The product structure's top first; then shapes outside it (no products,
  // or loose solids) unless their solids are already there.
  const products = new Set([...pdRep.values()].map(find));
  const groups = [...new Set([...groupSolids.keys(), ...children.keys()])].filter((g) => !isChild.has(g));
  for (const g of groups.filter((x) => products.has(x))) {
    const o = instance(g, new Set());
    if (o) root.add(o);
  }
  for (const g of groups.filter((x) => !products.has(x))) {
    if ((groupSolids.get(g) ?? []).every((x) => used.has(x)) && !children.has(g)) continue;
    const o = instance(g, new Set());
    if (o) root.add(o);
  }
  if (!root.children.length) {
    // No usable product structure: every solid as it stands.
    for (const [id, e] of E) if (SOLIDS.includes(e.type)) for (const o of solidObjects(id)) root.add(o.parent ? o.clone() : o);
  }
  if (!root.children.length) {
    // Faces only (no shells): one surface model of all of them.
    const shell = [...E.entries()].filter(([, e]) => e.type === 'ADVANCED_FACE' || e.type === 'FACE_SURFACE').map(([id]) => ({ ref: id }));
    if (shell.length) {
      const fake = Math.max(0, ...E.keys()) + 1;
      E.set(fake, { type: 'CLOSED_SHELL', args: ['', shell] });
      E.set(fake + 1, { type: 'SHELL_BASED_SURFACE_MODEL', args: ['', [{ ref: fake }]] });
      for (const o of buildSolid(fake + 1)) root.add(o);
    }
  }
  if (!root.children.length) throw new Error(t('no 3D shapes found in this STEP file'));
  progress?.(1);
  return root;
}
