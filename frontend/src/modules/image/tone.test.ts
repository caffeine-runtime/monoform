import { describe, expect, it } from 'vitest';
import { CURVES_NEUTRAL, LEVELS_NEUTRAL, autoLevels, curveFn, curvesNeutral, histogram, levelsFn, toneLut, type CurvePoint } from './tone';

describe('levels', () => {
  it('maps the input range onto the output range, gamma bending the middle', () => {
    const f = levelsFn({ inBlack: 0.2, inWhite: 0.8, gamma: 1, outBlack: 0, outWhite: 1 });
    expect(f(0.1)).toBe(0);
    expect(f(0.5)).toBeCloseTo(0.5);
    expect(f(0.9)).toBe(1);
    const g = levelsFn({ ...LEVELS_NEUTRAL, gamma: 2 });
    expect(g(0.25)).toBeCloseTo(0.5); // brighter midtones
    const o = levelsFn({ ...LEVELS_NEUTRAL, outBlack: 0.1, outWhite: 0.9 });
    expect(o(0)).toBeCloseTo(0.1);
    expect(o(1)).toBeCloseTo(0.9);
  });
});

describe('curves', () => {
  it('pass through their points', () => {
    const pts: CurvePoint[] = [
      [0, 0],
      [0.25, 0.4],
      [0.75, 0.8],
      [1, 1],
    ];
    const f = curveFn(pts);
    for (const [x, y] of pts) expect(f(x)).toBeCloseTo(y);
  });

  it('never overshoot (a steep S stays within 0..1 and rising)', () => {
    const f = curveFn([
      [0, 0],
      [0.3, 0.05],
      [0.7, 0.95],
      [1, 1],
    ]);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = f(i / 100);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('are flat outside their end points', () => {
    const f = curveFn([
      [0.2, 0.3],
      [0.8, 0.6],
    ]);
    expect(f(0)).toBeCloseTo(0.3);
    expect(f(1)).toBeCloseTo(0.6);
  });
});

describe('toneLut', () => {
  it('is the identity when neutral', () => {
    const lut = toneLut(LEVELS_NEUTRAL, CURVES_NEUTRAL);
    for (const v of [0, 64, 128, 255]) expect([lut[v * 4], lut[v * 4 + 1], lut[v * 4 + 2]]).toEqual([v, v, v]);
    expect(curvesNeutral(CURVES_NEUTRAL)).toBe(true);
  });

  it('applies levels, the RGB curve, then each channel', () => {
    const lut = toneLut(
      { ...LEVELS_NEUTRAL, outWhite: 0.5 },
      {
        ...CURVES_NEUTRAL,
        r: [
          [0, 0],
          [0.5, 1],
          [1, 1],
        ],
      },
    );
    expect(lut[255 * 4]).toBe(255); // red: 255 → 0.5 by levels → 1 by its curve
    expect(lut[255 * 4 + 1]).toBe(128); // green: just levels
  });
});

describe('histogram and auto levels', () => {
  it('counts levels and finds where the picture really starts and ends', () => {
    const px = new Uint8ClampedArray(1000 * 4);
    for (let i = 0; i < 1000; i++) px.set([50 + (i % 101), 50 + (i % 101), 50 + (i % 101), 255], i * 4);
    const h = histogram(px);
    expect(h.l[50]).toBeGreaterThan(0);
    expect(h.l[49]).toBe(0);
    const a = autoLevels(h.l);
    expect(Math.round(a.inBlack * 255)).toBe(50);
    expect(Math.round(a.inWhite * 255)).toBe(150);
  });
});
