import { describe, expect, it } from 'vitest';
import { clickSelect, isIdentity, moveOrder, parseRanges } from './pages';

describe('pdf page helpers', () => {
  it('moves single pages', () => {
    expect(moveOrder(4, [1], 4)).toEqual([2, 3, 4, 1]);
    expect(moveOrder(4, [4], 0)).toEqual([4, 1, 2, 3]);
    expect(moveOrder(4, [2], 3)).toEqual([1, 3, 2, 4]);
    expect(isIdentity(moveOrder(4, [2], 1))).toBe(true);
    expect(isIdentity(moveOrder(4, [2], 2))).toBe(true);
  });
  it('moves a multi-selection as a block', () => {
    expect(moveOrder(6, [2, 4], 6)).toEqual([1, 3, 5, 6, 2, 4]);
    expect(moveOrder(6, [5, 6], 1)).toEqual([1, 5, 6, 2, 3, 4]);
  });
  it('selects with modifiers', () => {
    expect(clickSelect([1], 1, 3, { toggle: false, range: false })).toEqual({ sel: [3], anchor: 3 });
    expect(clickSelect([1], 1, 3, { toggle: true, range: false })).toEqual({ sel: [1, 3], anchor: 3 });
    expect(clickSelect([1], 1, 3, { toggle: false, range: true }).sel).toEqual([1, 2, 3]);
    expect(clickSelect([1, 3], 3, 3, { toggle: true, range: false }).sel).toEqual([1]);
  });
  it('parses ranges', () => {
    expect(parseRanges('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parseRanges('8-', 10)).toEqual([8, 9, 10]);
    expect(parseRanges('-2', 10)).toEqual([1, 2]);
    expect(parseRanges('11', 10)).toBeNull();
    expect(parseRanges('a', 10)).toBeNull();
    expect(parseRanges('', 10)).toBeNull();
  });
});
