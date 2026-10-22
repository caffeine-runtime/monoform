// Which of Segment Anything's three answers to a click to use.
//
// For one click SAM returns a small, a medium and a large mask (part, larger
// part, whole object) with a predicted quality score each. EfficientSAM rates
// small parts best and whole objects lower (0.5–0.7 where parts get 0.7–0.9),
// so taking the top score selects a badge on a suit instead of the person
// wearing it. People clicking "select object"
// mean the whole thing, so a clearly larger mask that is still confident is
// preferred — unless it looks like background (it runs along much of the
// image's border), in which case the user most likely clicked the thing itself.
// Pure function, unit-tested.

export interface Candidate {
  score: number; // predicted IoU
  area: number; // fraction of the image, 0..1
  border: number; // fraction of the image's border pixels inside the mask, 0..1
}

/** Lowest score a larger mask may have, how much larger it must be, and how much border makes it background. */
const MIN_SCORE = 0.5;
const MIN_GROWTH = 1.5;
const MAX_BORDER = 0.3;

export function pickMask(c: Candidate[], refining: boolean): number {
  let best = 0;
  for (let i = 1; i < c.length; i++) if (c[i].score > c[best].score) best = i;
  // With exclusion points the user is steering; trust the model's own choice.
  if (refining) return best;
  let pick = best;
  for (let i = 0; i < c.length; i++) {
    const m = c[i];
    if (m.score < MIN_SCORE || m.border >= MAX_BORDER) continue;
    if (m.area >= c[pick].area * MIN_GROWTH) pick = i;
  }
  return pick;
}

// A whole object the model offers but scores low (a person behind a click on
// the face: 0.05) gets a second look: asked again with the click plus a point
// deep inside that larger mask, the model either confirms it (the same mask,
// confidently) or doesn't (a plume of smoke added to a rocket, a field of
// clouds). Measured on photos (see docs/DECISIONS.md).
export const CONFIRM_IOU = 0.85;
export const CONFIRM_SCORE = 0.75;

/** The candidate worth a second look: the largest that isn't background and is clearly larger than the pick (-1: none). */
export function largerCandidate(c: Candidate[], pick: number): number {
  let big = -1;
  for (let i = 0; i < c.length; i++) {
    if (c[i].border >= MAX_BORDER || c[i].area < c[pick].area * MIN_GROWTH) continue;
    if (big < 0 || c[i].area > c[big].area) big = i;
  }
  return big;
}

/** The point deepest inside a mask (logits > 0, w×h), by a two-pass chamfer distance; null for an empty mask. */
export function innerPoint(plane: Float32Array, w: number, h: number): { x: number; y: number } | null {
  const d = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = plane[i] > 0 ? INF : 0;
  const D = Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
    }
  }
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
      if (d[i] > best) {
        best = d[i];
        bx = x;
        by = y;
      }
    }
  }
  return best > 0 ? { x: bx, y: by } : null;
}

/** Intersection over union of two logits planes (> 0 = in). */
export function iou(a: Float32Array, b: Float32Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] > 0;
    const q = b[i] > 0;
    if (p && q) both++;
    if (p || q) either++;
  }
  return either ? both / either : 0;
}

/** Area and border coverage of a logits plane (M×M), within its top-left vw×vh valid part. */
export function measure(plane: Float32Array, M: number, vw: number, vh: number): { area: number; border: number } {
  let on = 0;
  let edge = 0;
  let edgeOn = 0;
  for (let y = 0; y < vh; y++) {
    for (let x = 0; x < vw; x++) {
      const v = plane[y * M + x] > 0;
      if (v) on++;
      if (x === 0 || y === 0 || x === vw - 1 || y === vh - 1) {
        edge++;
        if (v) edgeOn++;
      }
    }
  }
  return { area: on / Math.max(1, vw * vh), border: edgeOn / Math.max(1, edge) };
}
