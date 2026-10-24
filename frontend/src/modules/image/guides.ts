// Rulers, guides, grid and snapping: the arithmetic (pure, unit-tested).
// The editor draws the grid and guides; the image module draws the rulers.

/** v moved onto the nearest target within `within` (document pixels), or left where it is. */
export function snapValue(v: number, targets: number[], within: number): { v: number; to: number | null } {
  let best: number | null = null;
  let d = within;
  for (const t of targets) {
    const e = Math.abs(t - v);
    if (e < d || (best === null && e === d)) {
      d = e;
      best = t;
    }
  }
  return best === null ? { v, to: null } : { v: best, to: best };
}

/**
 * How far to move a span [lo, hi] so its start, middle or end lands on a
 * target (the nearest within `within`); 0 when none is near.
 */
export function snapSpan(lo: number, hi: number, targets: number[], within: number): number {
  let best = 0;
  let d = within;
  let found = false;
  for (const p of [lo, (lo + hi) / 2, hi]) {
    for (const t of targets) {
      const e = Math.abs(t - p);
      if (e < d || (!found && e === d)) {
        found = true;
        d = e;
        best = t - p;
      }
    }
  }
  return best;
}

/** Grid lines from `from` to `to` every `size` pixels (none when they'd be too dense to see). */
export function gridLines(size: number, from: number, to: number, max = 400): number[] {
  if (size <= 0) return [];
  const out: number[] = [];
  for (let v = Math.ceil(from / size) * size; v <= to && out.length < max; v += size) out.push(v);
  return out;
}

const NICE = [1, 2, 5];

/** A round grid size for a w × h picture: about 16 cells along its longer side. */
export function autoGrid(w: number, h: number): number {
  const target = Math.max(w, h) / 16;
  for (let p = 1; ; p *= 10) for (const n of NICE) if (n * p >= target) return n * p;
}

/** Ruler ticks at this zoom: labelled ones at least ~60 screen pixels apart, small ones between. */
export function rulerSteps(zoom: number): { major: number; minor: number } {
  for (let p = 1; p < 1e7; p *= 10) {
    for (const n of NICE) {
      const major = n * p;
      if (major * zoom >= 60) {
        const minor = major / (n === 2 ? 4 : 5);
        return { major, minor: minor * zoom >= 5 ? minor : major };
      }
    }
  }
  return { major: 1e7, minor: 1e7 };
}
