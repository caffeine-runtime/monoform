import { describe, expect, it } from 'vitest';
import { measure, pickMask } from './pick';

// Scores and sizes as SlimSAM gave them for clicks on a portrait (see docs/DECISIONS.md).
describe('pickMask', () => {
  it('takes the whole person over a badge on the suit', () => {
    const suit = [
      { score: 0.86, area: 0.287, border: 0.08 },
      { score: 0.98, area: 0.016, border: 0 },
      { score: 0.7, area: 0.003, border: 0 },
    ];
    expect(pickMask(suit, false)).toBe(0);
    const face = [
      { score: 0.91, area: 0.36, border: 0.05 },
      { score: 0.89, area: 0.088, border: 0 },
      { score: 0.98, area: 0.034, border: 0 },
    ];
    expect(pickMask(face, false)).toBe(0);
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
    const lamp = [
      { score: 0.95, area: 0.6, border: 0.7 }, // the lamp and the whole wall behind it
      { score: 0.97, area: 0.05, border: 0 },
      { score: 0.9, area: 0.01, border: 0 },
    ];
    expect(pickMask(lamp, false)).toBe(1);
    // Clicking the sky itself gives the sky.
    expect(pickMask([{ score: 1, area: 0.27, border: 0.43 }, { score: 1.01, area: 0.269, border: 0.43 }, { score: 0.99, area: 0.267, border: 0.43 }], false)).toBe(1);
  });

  it('ignores larger masks the model is unsure about', () => {
    expect(pickMask([{ score: 0.6, area: 0.5, border: 0 }, { score: 0.95, area: 0.05, border: 0 }, { score: 0.9, area: 0.02, border: 0 }], false)).toBe(1);
  });

  it('trusts the top score while the user refines with exclusions', () => {
    expect(pickMask([{ score: 0.86, area: 0.287, border: 0.08 }, { score: 0.98, area: 0.016, border: 0 }, { score: 0.7, area: 0.003, border: 0 }], true)).toBe(1);
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
