import { describe, expect, it } from 'vitest';
import { BLUR_TYPES, EFFECTS, NEUTRAL, hexRgb, isNeutral } from './adjust';

describe('adjustments', () => {
  it('treats blur shape settings alone as no change', () => {
    expect(isNeutral({ ...NEUTRAL, blurType: 'motion', blurAngle: 45, blurX: 0.2, blurY: 0.9, blurBand: 0.3 })).toBe(true);
    expect(isNeutral({ ...NEUTRAL, blurType: 'lens', blur: 10 })).toBe(false);
  });

  it('counts clean-up as a change, its tolerance alone not', () => {
    expect(isNeutral({ ...NEUTRAL, markTolerance: 0.5 })).toBe(true);
    expect(isNeutral({ ...NEUTRAL, lightMarks: 0.3 })).toBe(false);
    expect(isNeutral({ ...NEUTRAL, markColor: '#d0d0d0' })).toBe(false);
  });

  it('counts an effect as a change, one at strength 0 not', () => {
    expect(isNeutral({ ...NEUTRAL, effects: { vintage: 0 } })).toBe(true);
    expect(isNeutral({ ...NEUTRAL, effects: { vintage: 0.3 } })).toBe(false);
    expect(isNeutral({ ...NEUTRAL, effects: { bw: 0, invert: 1 } })).toBe(false);
    expect(new Set(EFFECTS.map((l) => l.id)).size).toBe(EFFECTS.length);
    expect(EFFECTS.length).toBe(18);
    expect(EFFECTS.slice(0, 3).map((e) => e.id)).toEqual(['bw', 'sepia', 'invert']);
  });

  it('reads colours for the clean-up', () => {
    expect(hexRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexRgb('')).toBeNull();
    expect(hexRgb('red')).toBeNull();
  });

  it('offers eight kinds of blur, each explained', () => {
    expect(BLUR_TYPES.map((b) => b.id)).toEqual(['gaussian', 'motion', 'zoom', 'spin', 'lens', 'tiltshift', 'surface', 'frosted']);
    for (const b of BLUR_TYPES) expect(b.help.length).toBeGreaterThan(10);
  });
});
