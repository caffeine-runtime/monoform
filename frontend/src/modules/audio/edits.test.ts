import { describe, expect, it } from 'vitest';
import { cutsOnly, fade, gain, gainAt, insert, isIdentity, keep, length, locate, remove, silence, slice, whole } from './edits';

describe('audio edits', () => {
  const t0 = whole(1000);

  it('delete and trim', () => {
    const t = remove(t0, 100, 300);
    expect(t).toEqual([{ start: 0, end: 100 }, { start: 300, end: 1000 }]);
    expect(length(t)).toBe(800);
    expect(keep(t, 50, 150)).toEqual([{ start: 50, end: 100 }, { start: 300, end: 350 }]);
    // Reversed and out-of-range bounds are clamped.
    expect(length(remove(t0, 1200, 900))).toBe(900);
  });

  it('cut and paste moves audio; undoing a split merges back', () => {
    const clip = slice(t0, 200, 400);
    const cut = remove(t0, 200, 400);
    const moved = insert(cut, 0, clip);
    expect(moved).toEqual([{ start: 200, end: 400 }, { start: 0, end: 200 }, { start: 400, end: 1000 }]);
    // Pasting it back where it came from restores a single segment.
    expect(insert(cut, 200, clip)).toEqual([{ start: 0, end: 1000 }]);
    expect(isIdentity(insert(cut, 200, clip), 1000)).toBe(true);
  });

  it('locate maps output to source', () => {
    const t = remove(t0, 100, 300);
    expect(locate(t, 150)).toMatchObject({ index: 1, src: 350, outStart: 100 });
    expect(locate(t, 800)).toBeNull();
  });

  it('gain, silence and fades', () => {
    let t = gain(t0, 0, 1000, 0.5);
    expect(gainAt(t, 10)).toBeCloseTo(0.5);
    t = fade(t, 0, 100, 'in');
    expect(gainAt(t, 0)).toBeCloseTo(0);
    expect(gainAt(t, 50)).toBeCloseTo(0.25);
    expect(gainAt(t, 500)).toBeCloseTo(0.5);
    t = fade(t, 900, 1000, 'out');
    expect(gainAt(t, 950)).toBeCloseTo(0.25);
    t = silence(t, 400, 500);
    expect(gainAt(t, 450)).toBe(0);
    expect(length(t)).toBe(1000);
    expect(cutsOnly(t)).toBe(false);
    expect(cutsOnly(remove(t0, 1, 2))).toBe(true);
  });

  it('slicing keeps ramps continuous', () => {
    const t = fade(t0, 0, 1000, 'in');
    // Delete the middle: the envelope of what's left is unchanged.
    const r = remove(t, 400, 600);
    expect(gainAt(r, 399)).toBeCloseTo(0.399, 3);
    expect(gainAt(r, 400)).toBeCloseTo(0.6, 3);
  });
});
