import { describe, expect, it } from 'vitest';
import { centered, fitZoom, keepAspect, normRect, stepZoom, zoomAt } from './geometry';

describe('image geometry', () => {
  it('fits without upscaling', () => {
    expect(fitZoom(4000, 2000, 1048, 1048, 24)).toBeCloseTo(0.25);
    expect(fitZoom(100, 50, 1000, 800)).toBe(1);
    expect(fitZoom(100, 50, 1048, 800, 24, true)).toBeCloseTo(10);
  });
  it('centres', () => {
    expect(centered(100, 50, 300, 150, 1)).toEqual({ zoom: 1, x: 100, y: 50 });
  });
  it('zooms around the pointer', () => {
    const v = zoomAt({ zoom: 1, x: 0, y: 0 }, 100, 100, 2);
    // Image point (100,100) stays under the pointer.
    expect(100 * v.zoom + v.x).toBe(100);
    expect(v).toEqual({ zoom: 2, x: -100, y: -100 });
  });
  it('steps through nice zoom levels', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.3, 1)).toBe(0.33);
  });
  it('normalises and clamps rects', () => {
    expect(normRect({ x: 50, y: 50, width: -30, height: -60 }, 100, 100)).toEqual({ x: 20, y: 0, width: 30, height: 50 });
    expect(normRect({ x: 90, y: 90, width: 50, height: 50 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 });
  });
  it('keeps aspect ratio', () => {
    expect(keepAspect(1920, 1080, 'w', 960)).toEqual({ w: 960, h: 540 });
    expect(keepAspect(1920, 1080, 'h', 540)).toEqual({ w: 960, h: 540 });
  });
});
