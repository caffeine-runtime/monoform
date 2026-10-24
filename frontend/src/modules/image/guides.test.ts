import { describe, expect, it } from 'vitest';
import { autoGrid, gridLines, rulerSteps, snapSpan, snapValue } from './guides';

describe('snapping', () => {
  it('moves a value onto the nearest target within reach', () => {
    expect(snapValue(37, [0, 40, 100], 4)).toEqual({ v: 40, to: 40 });
    expect(snapValue(37, [0, 40, 100], 2)).toEqual({ v: 37, to: null });
    expect(snapValue(51, [50, 52], 3).v).toBe(50); // the first of equally near ones
  });
  it('moves a span by its start, middle or end', () => {
    expect(snapSpan(12, 42, [10], 3)).toBe(-2); // start onto 10
    expect(snapSpan(12, 42, [28], 3)).toBe(1); // middle (27) onto 28
    expect(snapSpan(12, 42, [44], 3)).toBe(2); // end onto 44
    expect(snapSpan(12, 42, [60], 3)).toBe(0);
  });
});

describe('grid and rulers', () => {
  it('a round grid size, about 16 cells across', () => {
    expect(autoGrid(1600, 900)).toBe(100);
    expect(autoGrid(200, 100)).toBe(20);
    expect(autoGrid(4000, 3000)).toBe(500);
  });
  it('grid lines inside a range', () => {
    expect(gridLines(50, 0, 200)).toEqual([0, 50, 100, 150, 200]);
    expect(gridLines(50, 30, 120)).toEqual([50, 100]);
    expect(gridLines(0, 0, 100)).toEqual([]);
  });
  it('ruler ticks readable at any zoom', () => {
    expect(rulerSteps(1)).toEqual({ major: 100, minor: 20 });
    expect(rulerSteps(4).major).toBe(20);
    expect(rulerSteps(0.1).major).toBe(1000);
    const s = rulerSteps(0.37);
    expect(s.major * 0.37).toBeGreaterThanOrEqual(60);
  });
});
