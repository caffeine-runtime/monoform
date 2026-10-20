// Non-destructive audio edits. The edited file is a timeline of segments —
// source frame ranges (or silence) with gain ramps — which Go renders on save
// (internal/audio Segment, same JSON). Every edit is a pure function from one
// timeline to the next, so undo is just keeping the previous array.
// Positions are in sample frames of the edited ("output") timeline.

export interface Ramp {
  g0: number;
  g1: number;
}

export interface Segment {
  start: number; // source frame (or 0 for silence)
  end: number;
  silence?: boolean;
  gains?: Ramp[];
}

export type Timeline = readonly Segment[];

const segLen = (s: Segment) => Math.max(0, s.end - s.start);

export function length(t: Timeline): number {
  let n = 0;
  for (const s of t) n += segLen(s);
  return n;
}

export function whole(frames: number): Timeline {
  return frames > 0 ? [{ start: 0, end: frames }] : [];
}

/** The part [p, q) (offsets within the segment) of a segment, gains sliced to match. */
function piece(s: Segment, p: number, q: number): Segment {
  const L = segLen(s);
  const out: Segment = { start: s.start + p, end: s.start + q };
  if (s.silence) out.silence = true;
  if (s.gains?.length) {
    out.gains = s.gains.map((r) => ({ g0: r.g0 + (r.g1 - r.g0) * (p / L), g1: r.g0 + (r.g1 - r.g0) * (q / L) }));
  }
  return out;
}

/** Output range [a, b) as segments. */
export function slice(t: Timeline, a: number, b: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const s of t) {
    const L = segLen(s);
    const lo = Math.max(a, pos);
    const hi = Math.min(b, pos + L);
    if (hi > lo) out.push(piece(s, lo - pos, hi - pos));
    pos += L;
    if (pos >= b) break;
  }
  return out;
}

/** Join neighbours that continue each other unchanged, so timelines stay short. */
export function tidy(t: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of t) {
    if (segLen(s) <= 0) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.silence && !s.silence && prev.end === s.start && !prev.gains?.length && !s.gains?.length) {
      out[out.length - 1] = { start: prev.start, end: s.end };
    } else if (prev && prev.silence && s.silence && !prev.gains?.length && !s.gains?.length) {
      out[out.length - 1] = { start: 0, end: segLen(prev) + segLen(s), silence: true };
    } else {
      out.push(s);
    }
  }
  return out;
}

const clampRange = (t: Timeline, a: number, b: number): [number, number] => {
  const n = length(t);
  const lo = Math.max(0, Math.min(a, b, n));
  const hi = Math.max(0, Math.min(Math.max(a, b), n));
  return [Math.round(lo), Math.round(hi)];
};

/** Delete [a, b). */
export function remove(t: Timeline, a: number, b: number): Segment[] {
  [a, b] = clampRange(t, a, b);
  return tidy([...slice(t, 0, a), ...slice(t, b, Infinity)]);
}

/** Keep only [a, b) ("trim to selection"). */
export function keep(t: Timeline, a: number, b: number): Segment[] {
  [a, b] = clampRange(t, a, b);
  return tidy(slice(t, a, b));
}

/** Insert a clip (from slice()) at output position x. */
export function insert(t: Timeline, x: number, clip: readonly Segment[]): Segment[] {
  x = clampRange(t, x, x)[0];
  return tidy([...slice(t, 0, x), ...clip.map((s) => ({ ...s })), ...slice(t, x, Infinity)]);
}

/** Apply a function to the segments covering [a, b), splitting at the edges. */
function mapRange(t: Timeline, a: number, b: number, f: (s: Segment, lo: number, hi: number) => Segment): Segment[] {
  [a, b] = clampRange(t, a, b);
  const mid: Segment[] = [];
  let pos = a;
  for (const s of slice(t, a, b)) {
    const L = segLen(s);
    mid.push(f(s, pos, pos + L));
    pos += L;
  }
  return tidy([...slice(t, 0, a), ...mid, ...slice(t, b, Infinity)]);
}

const withRamp = (s: Segment, r: Ramp): Segment => ({ ...s, gains: [...(s.gains ?? []), r] });

/** Multiply [a, b) by a constant factor. */
export function gain(t: Timeline, a: number, b: number, factor: number): Segment[] {
  return mapRange(t, a, b, (s) => withRamp(s, { g0: factor, g1: factor }));
}

/** Replace [a, b) by silence of the same length. */
export function silence(t: Timeline, a: number, b: number): Segment[] {
  return mapRange(t, a, b, (s) => ({ start: 0, end: segLen(s), silence: true }));
}

/** Linear fade across [a, b): in (0 → 1) or out (1 → 0). */
export function fade(t: Timeline, a: number, b: number, dir: 'in' | 'out'): Segment[] {
  [a, b] = clampRange(t, a, b);
  const span = Math.max(1, b - a);
  const f = (x: number) => (dir === 'in' ? (x - a) / span : 1 - (x - a) / span);
  return mapRange(t, a, b, (s, lo, hi) => withRamp(s, { g0: f(lo), g1: f(hi) }));
}

/** Where output frame x comes from. */
export function locate(t: Timeline, x: number): { index: number; seg: Segment; outStart: number; src: number } | null {
  let pos = 0;
  for (let i = 0; i < t.length; i++) {
    const L = segLen(t[i]);
    if (x < pos + L) return { index: i, seg: t[i], outStart: pos, src: t[i].start + (x - pos) };
    pos += L;
  }
  return null;
}

/** Gain envelope value of a segment at offset p (0 for silence). */
export function segGain(s: Segment, p: number): number {
  if (s.silence) return 0;
  const L = segLen(s);
  let g = 1;
  for (const r of s.gains ?? []) g *= r.g0 + (r.g1 - r.g0) * (L ? p / L : 0);
  return g;
}

export function gainAt(t: Timeline, x: number): number {
  const l = locate(t, x);
  return l ? segGain(l.seg, x - l.outStart) : 0;
}

/** True when the edit is only cuts/moves (an MP3 can be saved without re-encoding). */
export function cutsOnly(t: Timeline): boolean {
  return t.every((s) => !s.silence && (s.gains ?? []).every((r) => r.g0 === 1 && r.g1 === 1));
}

/** True when the timeline plays the source unchanged. */
export function isIdentity(t: Timeline, frames: number): boolean {
  return t.length === 1 && t[0].start === 0 && t[0].end === frames && cutsOnly(t);
}

/** Convert decibels to an amplitude factor and back. */
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(g);
