import { describe, expect, it } from 'vitest';
import { BLUR_TYPES, NEUTRAL, isNeutral } from './adjust';

describe('adjustments', () => {
  it('treats blur shape settings alone as no change', () => {
    expect(isNeutral({ ...NEUTRAL, blurType: 'motion', blurAngle: 45, blurX: 0.2, blurY: 0.9, blurBand: 0.3 })).toBe(true);
    expect(isNeutral({ ...NEUTRAL, blurType: 'lens', blur: 10 })).toBe(false);
  });

  it('offers seven kinds of blur, each explained', () => {
    expect(BLUR_TYPES.map((b) => b.id)).toEqual(['gaussian', 'motion', 'zoom', 'spin', 'lens', 'tiltshift', 'surface']);
    for (const b of BLUR_TYPES) expect(b.help.length).toBeGreaterThan(10);
  });
});
