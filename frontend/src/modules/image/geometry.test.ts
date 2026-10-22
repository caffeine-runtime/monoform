import { describe, expect, it } from 'vitest';
import { centered, fitZoom, keepAspect, normRect, stepZoom, viewWith, wheelIntent, zoomAt } from './geometry';

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

  it('tells a mouse wheel from a touchpad', () => {
    const ev = (o: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; wheelDeltaY: number }>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });
    expect(wheelIntent(ev({ deltaY: 100, wheelDeltaY: -120 }))).toBe('zoom'); // a notch
    expect(wheelIntent(ev({ deltaY: 3, deltaMode: 1 }))).toBe('zoom'); // lines (Firefox)
    expect(wheelIntent(ev({ deltaY: 4.5, wheelDeltaY: -13 }))).toBe('pan'); // two fingers
    expect(wheelIntent(ev({ deltaX: 12, deltaY: 0 }))).toBe('pan'); // sideways
    expect(wheelIntent(ev({ deltaY: 2, ctrlKey: true }))).toBe('zoom'); // pinch
    expect(wheelIntent(ev({ deltaY: 40, wheelDeltaY: -120 }), true)).toBe('pan'); // mid-gesture
  });

  it('puts a document point at a screen point, turned', () => {
    const v = viewWith(2, 90, { x: 10, y: 0 }, { x: 100, y: 100 });
    // Turned 90° clockwise and doubled, (10, 0) lands 20 below the origin.
    expect(v.zoom).toBe(2);
    expect(v.x).toBeCloseTo(100);
    expect(v.y).toBeCloseTo(80);
    expect(viewWith(1, 0, { x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
