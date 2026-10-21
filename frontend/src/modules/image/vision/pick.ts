// Which of Segment Anything's three answers to a click to use.
//
// For one click SAM returns a small, a medium and a large mask (part, larger
// part, whole object) with a predicted quality score each. The quantized
// SlimSAM rates small parts best, so taking the top score selects a badge on
// a shirt instead of the person wearing it. People clicking "select object"
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
const MIN_SCORE = 0.75;
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
