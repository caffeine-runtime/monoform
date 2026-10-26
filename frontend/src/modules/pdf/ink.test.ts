import { describe, expect, it } from 'vitest';
import { bounds, densify, insidePolygon, rgb, segmentDistance, shapeStrokes, touchesStroke } from './ink';

describe('shapeStrokes', () => {
  it('draws a line as one stroke', () => {
    expect(shapeStrokes('line', 0, 0, 10, 5)).toEqual([[0, 0, 10, 5]]);
  });

  it('closes a rectangle', () => {
    const [r] = shapeStrokes('rect', 1, 2, 11, 7);
    expect(r).toEqual([1, 2, 11, 2, 11, 7, 1, 7, 1, 2]);
  });

  it('gives an arrow a head at its end', () => {
    const [shaft, head] = shapeStrokes('arrow', 0, 0, 100, 0, false, 10);
    expect(shaft).toEqual([0, 0, 100, 0]);
    expect(head.slice(2, 4)).toEqual([100, 0]); // the tip
    expect(head[0]).toBeLessThan(100);
    expect(head[1]).toBeCloseTo(-head[5]); // the wings mirror each other
    expect(Math.hypot(100 - head[0], head[1])).toBeCloseTo(10);
  });

  it('keeps a short arrow’s head shorter than half of it', () => {
    const [, head] = shapeStrokes('arrow', 0, 0, 8, 0, false, 12);
    expect(Math.hypot(8 - head[0], head[1])).toBeCloseTo(4);
  });

  it('closes an ellipse inside its box', () => {
    const [e] = shapeStrokes('ellipse', 0, 0, 40, 20);
    expect(e.length).toBeGreaterThanOrEqual(50);
    expect(e[0]).toBeCloseTo(e[e.length - 2]);
    expect(e[1]).toBeCloseTo(e[e.length - 1]);
    const [x0, y0, x1, y1] = bounds([e]);
    expect([x0, y0, x1, y1].map((v) => Math.round(v))).toEqual([0, 0, 40, 20]);
  });

  it('snaps with Shift: 45° lines, squares and circles', () => {
    const [h] = shapeStrokes('line', 0, 0, 10, 1, true);
    expect(h[2]).toBeCloseTo(Math.hypot(10, 1));
    expect(h[3]).toBeCloseTo(0);
    const [d] = shapeStrokes('line', 0, 0, 10, 9, true);
    expect(d[2]).toBeCloseTo(d[3]);
    expect(shapeStrokes('rect', 0, 0, 10, -4, true)[0].slice(4, 6)).toEqual([10, -10]);
    const [x0, y0, x1, y1] = bounds(shapeStrokes('ellipse', 0, 0, 30, 10, true));
    expect(Math.round(x1 - x0)).toBe(Math.round(y1 - y0));
  });
});

describe('densify', () => {
  it('adds points along each side and keeps the corners', () => {
    const d = densify([0, 0, 10, 0, 10, 4], 2);
    expect(d).toEqual([0, 0, 2, 0, 4, 0, 6, 0, 8, 0, 10, 0, 10, 2, 10, 4]);
  });
  it('leaves a single point alone', () => {
    expect(densify([3, 4], 2)).toEqual([3, 4]);
  });
});

describe('hit testing', () => {
  it('measures distance to a segment, ends included', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });

  it('touches a polyline within the radius only', () => {
    const s = [0, 0, 10, 0, 10, 10];
    expect(touchesStroke(10.5, 5, 1, s)).toBe(true);
    expect(touchesStroke(5, 5, 1, s)).toBe(false); // inside the corner, away from both segments
    expect(touchesStroke(0.5, 0.5, 1, [0, 0])).toBe(true);
    expect(touchesStroke(5, 0, 1, [0, 0, NaN, NaN, 20, 20])).toBe(false); // gaps aren't segments
  });

  it('finds points inside a polygon', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(insidePolygon(5, 5, sq)).toBe(true);
    expect(insidePolygon(15, 5, sq)).toBe(false);
  });

  it('reads colours', () => {
    expect(rgb('#ff8000')).toEqual([255, 128, 0]);
    expect(rgb('nope')).toEqual([0, 0, 0]);
  });
});
