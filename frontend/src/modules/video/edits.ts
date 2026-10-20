// Video edits: which parts of the source to keep (seconds), plus rotation
// and audio removal. Saved by Go without re-encoding, so cut points snap to
// keyframes; snap() mirrors internal/video.Snap so the timeline shows exactly
// what will be written.

import { hasEffects, type Project } from './project';

export type Range = [number, number];

export interface VideoEdit {
  keep: Range[];
  rotate: number; // extra clockwise degrees: 0/90/180/270
  mute: boolean;
  /** Effects (overlays, speed, transitions); any make saving a render instead of a remux. */
  fx?: Project;
}

/** A keyframe this close to a cut point counts as on it (Go: snapSlack). */
export const SNAP_SLACK = 0.05;

export function normalize(keep: readonly Range[], dur: number): Range[] {
  const out = keep
    .map(([a, b]): Range => [Math.max(0, Math.min(a, b)), Math.min(dur, Math.max(a, b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Range[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Remove [a, b) from the kept parts. */
export function cut(keep: readonly Range[], a: number, b: number, dur: number): Range[] {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  const out: Range[] = [];
  for (const [x, y] of keep) {
    if (y <= lo || x >= hi) out.push([x, y]);
    else {
      if (x < lo) out.push([x, lo]);
      if (y > hi) out.push([hi, y]);
    }
  }
  return normalize(out, dur);
}

/** Keep only [a, b) of what is currently kept. */
export function keepOnly(keep: readonly Range[], a: number, b: number, dur: number): Range[] {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return normalize(
    keep.map(([x, y]): Range => [Math.max(x, lo), Math.min(y, hi)]),
    dur,
  );
}

/** Starts move back to the previous keyframe, ends forward to the next one. */
export function snap(keep: readonly Range[], keyframes: readonly number[], dur: number): Range[] {
  const k = normalize(keep, dur);
  if (!keyframes.length) return k;
  const out: Range[] = [];
  for (const [x, y] of k) {
    let a = keyframes[0];
    let b = dur;
    for (const t of keyframes) if (t <= x + SNAP_SLACK) a = t;
    for (const t of keyframes) {
      if (t >= y - SNAP_SLACK) {
        b = t;
        break;
      }
    }
    if (b > a) out.push([a, b]);
  }
  return normalize(out, dur);
}

/** Put [a, b) back into the kept parts. */
export function restore(keep: readonly Range[], a: number, b: number, dur: number): Range[] {
  return normalize([...keep, [Math.min(a, b), Math.max(a, b)]], dur);
}

/** The parts that are removed (gaps between kept ranges, and before/after them). */
export function removed(keep: readonly Range[], dur: number): Range[] {
  const out: Range[] = [];
  let t = 0;
  for (const [a, b] of keep) {
    if (a > t + 1e-6) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (dur > t + 1e-6) out.push([t, dur]);
  return out;
}

export function keptLength(keep: readonly Range[]): number {
  return keep.reduce((n, [a, b]) => n + (b - a), 0);
}

/** The kept range containing t, or the next one after it. */
export function rangeAt(keep: readonly Range[], t: number): { inside: boolean; range: Range | null } {
  for (const r of keep) {
    if (t >= r[0] && t < r[1]) return { inside: true, range: r };
    if (r[0] > t) return { inside: false, range: r };
  }
  return { inside: false, range: null };
}

export function isUnchanged(e: VideoEdit, dur: number): boolean {
  return e.rotate % 360 === 0 && !e.mute && !(e.fx && hasEffects(e.fx)) && e.keep.length === 1 && e.keep[0][0] <= 0.001 && e.keep[0][1] >= dur - 0.001;
}
