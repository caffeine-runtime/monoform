import { describe, expect, it } from 'vitest';
import { innerPoint, iou, largerCandidate, measure, pickMask } from './pick';

// Scores and sizes as EfficientSAM-Ti gave them for clicks on photos (see docs/DECISIONS.md).
describe('pickMask', () => {
  it('takes the whole person over the suit for a click on a badge', () => {
    const badge = [
      { score: 0.612, area: 0.388, border: 0.114 },
      { score: 0.166, area: 0.044, border: 0 },
      { score: 0.67, area: 0.222, border: 0.048 },
    ];
    expect(pickMask(badge, false)).toBe(0);
  });

  it('takes the whole shuttle, not a part of it', () => {
    const shuttle = [
      { score: 0.914, area: 0.061, border: 0 },
      { score: 0.637, area: 0.031, border: 0 },
      { score: 0.912, area: 0.059, border: 0 },
    ];
    expect(pickMask(shuttle, false)).toBe(0);
  });

  it('keeps the best mask when the larger one is only a bit larger', () => {
    const helmet = [
      { score: 0.94, area: 0.143, border: 0.19 },
      { score: 0.98, area: 0.12, border: 0.11 },
      { score: 0.85, area: 0.089, border: 0.09 },
    ];
    expect(pickMask(helmet, false)).toBe(1);
  });

  it('does not grow into the background', () => {
    // A cloud clicked in a photo of the Earth: the larger answers are the whole sea.
    const cloud = [
      { score: 0.32, area: 0.904, border: 0.688 },
      { score: 0.5, area: 0.002, border: 0 },
      { score: 0.117, area: 0.166, border: 0.113 },
    ];
    expect(pickMask(cloud, false)).toBe(1);
    // Clicking the sky itself gives the sky.
    expect(pickMask([{ score: 0.825, area: 0.839, border: 0.594 }, { score: 0.919, area: 0.556, border: 0.248 }, { score: 0.946, area: 0.567, border: 0.539 }], false)).toBe(2);
  });

  it('ignores larger masks the model is unsure about', () => {
    // A face: the whole person is offered at 0.05.
    expect(pickMask([{ score: 0.054, area: 0.356, border: 0.062 }, { score: 0.877, area: 0.033, border: 0 }, { score: 0.82, area: 0.042, border: 0.007 }], false)).toBe(1);
  });

  it('trusts the top score while the user refines with exclusions', () => {
    expect(pickMask([{ score: 0.612, area: 0.388, border: 0.114 }, { score: 0.166, area: 0.044, border: 0 }, { score: 0.67, area: 0.222, border: 0.048 }], true)).toBe(2);
  });
});

describe('measure', () => {
  it('counts area and border coverage inside the valid part only', () => {
    const M = 8;
    const p = new Float32Array(M * M).fill(-1);
    // valid part 4×4; the mask is its left column (4 px, all on the border)
    for (let y = 0; y < 4; y++) p[y * M] = 1;
    p[7 * M + 7] = 1; // padding, ignored
    const r = measure(p, M, 4, 4);
    expect(r.area).toBeCloseTo(4 / 16);
    expect(r.border).toBeCloseTo(4 / 12);
  });
});

describe('second look', () => {
  it('offers the larger, non-background mask for confirming', () => {
    // A face clicked: the whole person is the first answer, scored 0.05.
    const face = [{ score: 0.054, area: 0.356, border: 0.062 }, { score: 0.877, area: 0.033, border: 0 }, { score: 0.82, area: 0.042, border: 0.007 }];
    expect(largerCandidate(face, pickMask(face, false))).toBe(0);
    // A cloud: the larger answer is the sea around it (background), the next the cloud field.
    const cloud = [{ score: 0.32, area: 0.904, border: 0.688 }, { score: 0.5, area: 0.002, border: 0 }, { score: 0.117, area: 0.166, border: 0.113 }];
    expect(largerCandidate(cloud, 1)).toBe(2);
    // Nothing clearly larger: nothing to confirm.
    expect(largerCandidate([{ score: 0.914, area: 0.061, border: 0 }, { score: 0.637, area: 0.031, border: 0 }, { score: 0.912, area: 0.059, border: 0 }], 0)).toBe(-1);
  });

  it('finds the point deepest inside a mask', () => {
    const w = 40;
    const h = 20;
    const p = new Float32Array(w * h).fill(-1);
    // an L: a thick bar at x 2–13 (all rows) and a thin foot along the bottom
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x >= 2 && x <= 13 && y >= 2 && y <= 17) || (y >= 15 && y <= 17 && x < 38)) p[y * w + x] = 1;
    const c = innerPoint(p, w, h)!;
    expect(p[c.y * w + c.x]).toBe(1);
    expect(Math.abs(c.x - 7.5)).toBeLessThanOrEqual(1);
    expect(c.y).toBeGreaterThanOrEqual(7);
    expect(c.y).toBeLessThanOrEqual(12); // in the thick bar, not the thin foot
    expect(innerPoint(new Float32Array(w * h).fill(-1), w, h)).toBeNull();
  });

  it('measures overlap', () => {
    const a = new Float32Array([1, 1, -1, -1]);
    const b = new Float32Array([1, -1, 1, -1]);
    expect(iou(a, b)).toBeCloseTo(1 / 3);
    expect(iou(a, a)).toBe(1);
  });
});
