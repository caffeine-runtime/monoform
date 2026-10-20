import { describe, expect, it } from 'vitest';
import { cut, isUnchanged, keepOnly, keptLength, rangeAt, removed, restore, snap } from './edits';

describe('video edits', () => {
  const all: [number, number][] = [[0, 10]];

  it('cut and keep only', () => {
    const k = cut(all, 2, 4, 10);
    expect(k).toEqual([
      [0, 2],
      [4, 10],
    ]);
    expect(keepOnly(k, 1, 6, 10)).toEqual([
      [1, 2],
      [4, 6],
    ]);
    expect(keptLength(cut(k, 5, 3, 10))).toBe(7);
  });

  it('snaps like the Go side', () => {
    const kf = [0, 1, 2, 3, 4, 5];
    expect(snap([[1.3, 2.6], [4.2, 5.5], [2.5, 2.9]], kf, 6)).toEqual([
      [1, 3],
      [4, 6],
    ]);
    // A keyframe 7 ms after the requested start is taken as the start.
    expect(snap([[2, 4]], [0.007, 1.007, 2.007, 3.007, 4.007, 5.007], 6)).toEqual([[2.007, 4.007]]);
  });

  it('finds where playback should be', () => {
    const k = cut(all, 2, 4, 10);
    expect(rangeAt(k, 1)).toEqual({ inside: true, range: [0, 2] });
    expect(rangeAt(k, 3)).toEqual({ inside: false, range: [4, 10] });
    expect(rangeAt(k, 11).range).toBeNull();
  });

  it('knows when nothing changed', () => {
    expect(isUnchanged({ keep: all, rotate: 0, mute: false }, 10)).toBe(true);
    expect(isUnchanged({ keep: all, rotate: 90, mute: false }, 10)).toBe(false);
    expect(isUnchanged({ keep: cut(all, 2, 3, 10), rotate: 0, mute: false }, 10)).toBe(false);
  });

  it('lists removed parts and restores them', () => {
    const k = cut(cut(all, 2, 3, 10), 8, 10, 10);
    expect(removed(k, 10)).toEqual([[2, 3], [8, 10]]);
    expect(removed(keepOnly(all, 1, 4, 10), 10)).toEqual([[0, 1], [4, 10]]);
    expect(restore(k, 2, 3, 10)).toEqual([[0, 8]]);
    expect(restore(k, 8, 10, 10)).toEqual([[0, 2], [3, 10]]);
    expect(removed(all, 10)).toEqual([]);
  });
});
