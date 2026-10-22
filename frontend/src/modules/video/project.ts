// Video effects: overlays (images, area blurs) animated by keyframes, speed
// changes, transitions at cuts and fades. All times are source seconds, so an
// overlay stays attached to the moment (and object) it was placed on even
// when other parts are cut. Pure functions; unit-tested.

import { t } from '../../core/i18n';

export type Range = [number, number];

/** Timing curve from one keyframe to the next. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'bounce' | { bezier: [number, number, number, number] };

export const EASINGS: { id: Exclude<Easing, object> | 'custom'; label: string }[] = [
  { id: 'linear', label: t('Linear', {}, 'easing') },
  { id: 'easeIn', label: t('Ease in', {}, 'easing') },
  { id: 'easeOut', label: t('Ease out', {}, 'easing') },
  { id: 'easeInOut', label: t('Ease in-out', {}, 'easing') },
  { id: 'bounce', label: t('Bounce', {}, 'easing') },
  { id: 'hold', label: t('Hold (jump)', {}, 'easing') },
  { id: 'custom', label: t('Custom curve', {}, 'easing') },
];

export interface Key {
  t: number; // source seconds
  x: number; // centre, video pixels
  y: number;
  scale: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  ease: Easing; // curve towards the next key
}

export type BlurKind = 'gaussian' | 'pixelate' | 'motion' | 'zoom' | 'lens';
export const BLUR_KINDS: { id: BlurKind; label: string }[] = [
  { id: 'gaussian', label: t('Gaussian', {}, 'blur') },
  { id: 'pixelate', label: t('Pixelate', {}, 'blur') },
  { id: 'motion', label: t('Motion', {}, 'blur') },
  { id: 'zoom', label: t('Zoom', {}, 'blur') },
  { id: 'lens', label: t('Lens', {}, 'blur') },
];

export interface Layer {
  id: string;
  kind: 'image' | 'blur';
  name: string;
  start: number; // source seconds
  end: number;
  keys: Key[]; // sorted by t, at least one
  path: 'straight' | 'smooth'; // spatial path between keys
  fadeIn: number; // seconds
  fadeOut: number;
  /** Size at scale 1, video pixels (image: natural size fitted; blur: the area). */
  w: number;
  h: number;
  /** image: asset id (see assets in the module) */
  asset?: string;
  blur?: { kind: BlurKind; amount: number; shape: 'rect' | 'ellipse' | 'path'; feather: number; angle: number; invert?: boolean; points?: Pt[] };
  /** image: the part of the picture shown (none = all of it). Blurs keep theirs in `blur`. */
  mask?: Mask;
  /** Keys came from tracking an object (shown in the UI; editing a key keeps it). */
  tracked?: boolean;
}

/** A point of a freeform outline, in the layer's box: -0.5..0.5 across, y down. */
export type Pt = [number, number];

/** Which part of a layer counts: a shape in its box with a soft edge, or everything outside it. */
export interface Mask {
  shape: 'none' | 'rect' | 'ellipse' | 'path';
  feather: number; // 0..1 of the way from the edge to the centre
  invert: boolean;
  points?: Pt[]; // shape 'path', ≥ 3
}
export const NO_MASK: Mask = { shape: 'none', feather: 0, invert: false };
/** Most points kept in an outline (the compositor has room for this many). */
export const MAX_POINTS = 64;

export function maskOf(l: Layer): Mask {
  if (l.kind === 'blur' && l.blur) return { shape: l.blur.shape, feather: l.blur.feather, invert: !!l.blur.invert, points: l.blur.points };
  return l.mask ?? NO_MASK;
}

/** The layer with its mask changed (a blur can't lose its area: 'none' becomes a rectangle). */
export function withMask(l: Layer, m: Partial<Mask>): Layer {
  const next = { ...maskOf(l), ...m };
  if (next.shape === 'path' && !(next.points && next.points.length >= 3)) next.points = ellipsePoints(12);
  if (l.kind === 'blur' && l.blur) {
    const shape = next.shape === 'none' ? 'rect' : next.shape;
    return { ...l, blur: { ...l.blur, shape, feather: next.feather, invert: next.invert, points: next.points } };
  }
  return { ...l, mask: next.shape === 'none' && !next.invert ? undefined : next };
}

/** n points on the ellipse inscribed in the box. */
export function ellipsePoints(n: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [Math.round(Math.cos(a) * 0.5 * 1000) / 1000, Math.round(Math.sin(a) * 0.5 * 1000) / 1000] as Pt;
  });
}

/** Indices of an open polyline kept by Ramer–Douglas–Peucker (ends excluded). */
function rdp(pts: Pt[], a: number, b: number, tol: number, out: number[]) {
  const [ax, ay] = pts[a];
  const [bx, by] = pts[b];
  const len = Math.hypot(bx - ax, by - ay) || 1e-9;
  let far = -1;
  let dmax = tol;
  for (let i = a + 1; i < b; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > dmax) {
      dmax = d;
      far = i;
    }
  }
  if (far < 0) return;
  rdp(pts, a, far, tol, out);
  out.push(far);
  rdp(pts, far, b, tol, out);
}

/** Fewer points along a closed outline (Ramer–Douglas–Peucker), at most `max`. */
export function simplify(pts: Pt[], tol: number, max = MAX_POINTS): Pt[] {
  if (pts.length <= 3) return pts;
  // Split the loop at the point farthest from the first, so both halves are open paths.
  const d0 = (p: Pt) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let far = 1;
  for (let i = 2; i < pts.length; i++) if (d0(pts[i]) > d0(pts[far])) far = i;
  const loop = [...pts, pts[0]];
  const keep = [0];
  rdp(loop, 0, far, tol, keep);
  keep.push(far);
  rdp(loop, far, loop.length - 1, tol, keep);
  const out = keep.map((i) => pts[i]);
  if (out.length > max) return simplify(out, Math.max(tol * 1.6, 1e-4), max);
  return out.length >= 3 ? out : pts.slice(0, 3);
}

/**
 * An outline drawn over the picture (video pixels) as the layer's new box and
 * freeform points: the box is the outline's bounds in the layer's own frame
 * (its rotation and scale at that moment), and `shift` is how far its centre moved.
 */
export function outlineToBox(outline: Pt[], s: { x: number; y: number; scale: number; rotation: number }): { w: number; h: number; points: Pt[]; shift: Pt } | null {
  if (outline.length < 3) return null;
  const a = (-s.rotation * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const local = outline.map(([x, y]): Pt => {
    const dx = x - s.x;
    const dy = y - s.y;
    return [(dx * ca - dy * sa) / s.scale, (dx * sa + dy * ca) / s.scale];
  });
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = Math.max(4, x1 - x0);
  const h = Math.max(4, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const norm = local.map(([x, y]): Pt => [Math.round(((x - cx) / w) * 1000) / 1000, Math.round(((y - cy) / h) * 1000) / 1000]);
  const points = simplify(norm, 0.006);
  if (points.length < 3) return null;
  // Centre offset back in video pixels.
  const b = (s.rotation * Math.PI) / 180;
  const shift: Pt = [(cx * Math.cos(b) - cy * Math.sin(b)) * s.scale, (cx * Math.sin(b) + cy * Math.cos(b)) * s.scale];
  return { w: Math.round(w), h: Math.round(h), points, shift };
}

export interface Speed {
  a: number;
  b: number;
  rate: number; // 0.25..4
}

export type TransitionKind = 'crossfade' | 'dip' | 'wipe' | 'slide' | 'zoom';
export const TRANSITIONS: { id: TransitionKind; label: string; overlap: boolean }[] = [
  { id: 'crossfade', label: t('Crossfade', {}, 'transition'), overlap: true },
  { id: 'dip', label: t('Dip to black', {}, 'transition'), overlap: false },
  { id: 'wipe', label: t('Wipe', {}, 'transition'), overlap: true },
  { id: 'slide', label: t('Slide', {}, 'transition'), overlap: true },
  { id: 'zoom', label: t('Zoom through', {}, 'transition'), overlap: true },
];

export interface Transition {
  at: number; // source time where the earlier kept part ends (identifies the join)
  kind: TransitionKind;
  dur: number; // seconds of output
}

export interface Project {
  layers: Layer[];
  speeds: Speed[];
  transitions: Transition[];
  fadeIn: number; // from black at the start, seconds
  fadeOut: number; // to black at the end
}

export const EMPTY: Project = { layers: [], speeds: [], transitions: [], fadeIn: 0, fadeOut: 0 };

export function hasEffects(p: Project): boolean {
  return p.layers.length > 0 || p.speeds.some((s) => s.rate !== 1) || p.transitions.length > 0 || p.fadeIn > 0 || p.fadeOut > 0;
}

// ---------- easing ----------

/** y of a CSS-style cubic-bezier(x1, y1, x2, y2) at x (Newton + bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 30; i++) {
    const v = bx(t) - x;
    if (Math.abs(v) < 1e-6) break;
    if (v > 0) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

export function ease(e: Easing, k: number): number {
  k = Math.min(1, Math.max(0, k));
  if (typeof e === 'object') return cubicBezier(e.bezier[0], e.bezier[1], e.bezier[2], e.bezier[3], k);
  switch (e) {
    case 'easeIn':
      return cubicBezier(0.42, 0, 1, 1, k);
    case 'easeOut':
      return cubicBezier(0, 0, 0.58, 1, k);
    case 'easeInOut':
      return cubicBezier(0.42, 0, 0.58, 1, k);
    case 'hold':
      return k < 1 ? 0 : 1;
    case 'bounce': {
      // Ease-out bounce (Penner).
      const n = 7.5625;
      const d = 2.75;
      if (k < 1 / d) return n * k * k;
      if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
      if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
      return n * (k -= 2.625 / d) * k + 0.984375;
    }
    default:
      return k;
  }
}

/** Bezier handles shown in the curve editor for a named easing. */
export function bezierOf(e: Easing): [number, number, number, number] {
  if (typeof e === 'object') return e.bezier;
  return ({ easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1], easeInOut: [0.42, 0, 0.58, 1] } as Record<string, [number, number, number, number]>)[e] ?? [0.25, 0.25, 0.75, 0.75];
}

// ---------- keyframes ----------

export interface State {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Catmull-Rom point between p1 and p2 (p0, p3 neighbours) at k. */
function catmull(p0: number, p1: number, p2: number, p3: number, k: number): number {
  const k2 = k * k;
  const k3 = k2 * k;
  return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}

/** Interpolated state of a layer at source time t (fades included in opacity). */
export function stateAt(l: Layer, t: number): State {
  const ks = l.keys;
  let s: State;
  if (ks.length === 1 || t <= ks[0].t) s = { ...ks[0] };
  else if (t >= ks[ks.length - 1].t) s = { ...ks[ks.length - 1] };
  else {
    let i = 0;
    while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
    const a = ks[i];
    const b = ks[i + 1];
    const k = ease(a.ease, (t - a.t) / (b.t - a.t || 1));
    const smooth = l.path === 'smooth' && ks.length > 2;
    const p0 = ks[Math.max(0, i - 1)];
    const p3 = ks[Math.min(ks.length - 1, i + 2)];
    s = {
      x: smooth ? catmull(p0.x, a.x, b.x, p3.x, k) : lerp(a.x, b.x, k),
      y: smooth ? catmull(p0.y, a.y, b.y, p3.y, k) : lerp(a.y, b.y, k),
      scale: lerp(a.scale, b.scale, k),
      rotation: lerp(a.rotation, b.rotation, k),
      opacity: lerp(a.opacity, b.opacity, k),
    };
  }
  let f = 1;
  if (l.fadeIn > 0) f = Math.min(f, (t - l.start) / l.fadeIn);
  if (l.fadeOut > 0) f = Math.min(f, (l.end - t) / l.fadeOut);
  s.opacity *= Math.min(1, Math.max(0, f));
  return s;
}

export function visibleAt(l: Layer, t: number): boolean {
  return t >= l.start && t < l.end;
}

/** Set (or add) the key at time t with the given state; keys stay sorted. */
export function setKey(l: Layer, t: number, s: Partial<State>, eps = 1 / 120): Layer {
  const keys = l.keys.map((k) => ({ ...k }));
  const at = keys.find((k) => Math.abs(k.t - t) < eps);
  if (at) Object.assign(at, s);
  else {
    const base = stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, t);
    const prev = [...keys].reverse().find((k) => k.t < t);
    keys.push({ ...base, ...s, t, ease: prev?.ease ?? 'easeInOut' });
    keys.sort((a, b) => a.t - b.t);
  }
  return { ...l, keys };
}

/** Move every key (and the timing) by the same state delta — for a layer with one key, its position. */
export function shiftKeys(l: Layer, dx: number, dy: number): Layer {
  return { ...l, keys: l.keys.map((k) => ({ ...k, x: k.x + dx, y: k.y + dy })) };
}

// ---------- output timeline ----------

/** One kept part as it appears in the output. */
export interface Piece {
  src: Range;
  out: Range; // output seconds
  /** Transition into this piece from the previous one (overlapping or dip). */
  enter: Transition | null;
}

/** Output seconds spent in source [a, b) under the speed changes. */
export function stretched(speeds: readonly Speed[], a: number, b: number): number {
  let d = b - a;
  for (const s of speeds) {
    const lo = Math.max(a, s.a);
    const hi = Math.min(b, s.b);
    if (hi > lo) d += (hi - lo) * (1 / s.rate - 1);
  }
  return d;
}

/** Source time reached after spending `o` output seconds from source time a (inverse of stretched). */
export function advance(speeds: readonly Speed[], a: number, o: number, limit: number): number {
  const cuts = [...new Set(speeds.flatMap((s) => [s.a, s.b]).filter((x) => x > a && x < limit))].sort((x, y) => x - y);
  let t = a;
  for (const c of [...cuts, limit]) {
    const rate = speedAt(speeds, (t + c) / 2);
    const need = (c - t) / rate;
    if (o <= need) return t + o * rate;
    o -= need;
    t = c;
  }
  return limit;
}

export function speedAt(speeds: readonly Speed[], t: number): number {
  for (const s of speeds) if (t >= s.a && t < s.b) return s.rate;
  return 1;
}

/** Lay out kept parts on the output timeline; overlapping transitions pull the next part earlier. */
export function pieces(kept: readonly Range[], p: Project): Piece[] {
  const out: Piece[] = [];
  let t = 0;
  for (const [a, b] of kept) {
    const len = stretched(p.speeds, a, b);
    const prev = out[out.length - 1];
    const tr = prev ? (p.transitions.find((x) => Math.abs(x.at - prev.src[1]) < 0.02) ?? null) : null;
    let start = t;
    let enter = tr;
    if (tr) {
      const overlap = TRANSITIONS.find((x) => x.id === tr.kind)?.overlap ?? false;
      // Never longer than either side.
      const d = Math.min(tr.dur, len, prev.out[1] - prev.out[0]);
      enter = { ...tr, dur: d };
      if (overlap) start = t - d;
    }
    out.push({ src: [a, b], out: [start, start + len], enter });
    t = start + len;
  }
  return out;
}

export function outputLength(ps: readonly Piece[]): number {
  return ps.length ? ps[ps.length - 1].out[1] : 0;
}

/** What to show at output time o: up to two pieces with their source times, and the mix. */
export interface FrameRef {
  a: { piece: number; t: number };
  b: { piece: number; t: number; kind: TransitionKind; progress: number } | null;
  /** 0..1 brightness from fades and dips (1 = normal). */
  light: number;
}

export function frameAt(ps: readonly Piece[], p: Project, o: number): FrameRef | null {
  if (!ps.length) return null;
  const total = outputLength(ps);
  o = Math.min(Math.max(0, o), Math.max(0, total - 1e-6));
  const srcAt = (i: number) => advance(p.speeds, ps[i].src[0], o - ps[i].out[0], ps[i].src[1]);
  let i = ps.findIndex((x, k) => o >= x.out[0] && (o < x.out[1] || k === ps.length - 1));
  if (i < 0) i = ps.length - 1;
  // Inside an overlapping transition the earlier piece is "a", the entering one "b".
  const next = ps[i + 1];
  let ref: FrameRef;
  if (next?.enter && o >= next.out[0] && TRANSITIONS.find((x) => x.id === next.enter!.kind)?.overlap) {
    const progress = (o - next.out[0]) / (next.enter.dur || 1);
    ref = { a: { piece: i, t: srcAt(i) }, b: { piece: i + 1, t: srcAt(i + 1), kind: next.enter.kind, progress }, light: 1 };
  } else ref = { a: { piece: i, t: srcAt(i) }, b: null, light: 1 };
  // Dips: darken the end of the earlier part and the start of the next.
  let light = 1;
  const cur = ps[i];
  if (cur.enter?.kind === 'dip') light = Math.min(light, (o - cur.out[0]) / (cur.enter.dur / 2));
  if (next?.enter?.kind === 'dip') light = Math.min(light, (cur.out[1] - o) / (next.enter.dur / 2));
  if (p.fadeIn > 0) light = Math.min(light, o / p.fadeIn);
  if (p.fadeOut > 0) light = Math.min(light, (total - o) / p.fadeOut);
  ref.light = Math.min(1, Math.max(0, light));
  return ref;
}

/** Output time of source time t, if t is kept. */
export function outputTimeOf(ps: readonly Piece[], p: Project, t: number): number | null {
  for (const x of ps) if (t >= x.src[0] && t < x.src[1]) return x.out[0] + stretched(p.speeds, x.src[0], t);
  return null;
}

// ---------- speed edits ----------

/** Set the speed of [a, b), replacing what was there. */
export function setSpeed(speeds: readonly Speed[], a: number, b: number, rate: number): Speed[] {
  const out: Speed[] = [];
  for (const s of speeds) {
    if (s.b <= a || s.a >= b) out.push(s);
    else {
      if (s.a < a) out.push({ ...s, b: a });
      if (s.b > b) out.push({ ...s, a: b });
    }
  }
  if (rate !== 1) out.push({ a, b, rate });
  return out.sort((x, y) => x.a - y.a);
}

// ---------- editing helpers ----------

/**
 * Change a layer's look at time t. With one key and no auto-keying the layer
 * is static: its key changes (position moves the whole layer). Otherwise a
 * key is set at t, which animates it.
 */
export function place(l: Layer, t: number, s: Partial<State>, autoKey: boolean): Layer {
  if (l.keys.length === 1 && !autoKey) return { ...l, keys: [{ ...l.keys[0], ...s }] };
  return setKey(l, t, s);
}

let seq = 0;
export function newLayer(kind: Layer['kind'], at: { start: number; end: number; x: number; y: number; w: number; h: number }, extra: Partial<Layer> = {}): Layer {
  return {
    id: `${kind}-${Date.now().toString(36)}-${++seq}`,
    kind,
    name: kind === 'image' ? t('Image') : t('Blur'),
    start: at.start,
    end: at.end,
    keys: [{ t: at.start, x: at.x, y: at.y, scale: 1, rotation: 0, opacity: 1, ease: 'easeInOut' }],
    path: 'smooth',
    fadeIn: 0,
    fadeOut: 0,
    w: at.w,
    h: at.h,
    ...(kind === 'blur' ? { blur: { kind: 'gaussian' as BlurKind, amount: 18, shape: 'ellipse' as const, feather: 0.3, angle: 0 } } : {}),
    ...extra,
  };
}

/** Point in the rotated output → point in the source frame (rotation 0/90/180/270, source w×h). */
export function toSource(x: number, y: number, rot: number, w: number, h: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [y, h - x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [w - y, x];
    default:
      return [x, y];
  }
}

/** Inverse of toSource. */
export function toOutput(x: number, y: number, rot: number, w: number, h: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [h - y, x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [y, w - x];
    default:
      return [x, y];
  }
}
