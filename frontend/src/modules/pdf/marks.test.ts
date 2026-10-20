import { describe, expect, it } from 'vitest';
import { inkBox, markPolygon, matchRects, paperToAlpha, stampMatrix, type Viewport } from './marks';

/** A viewport like pdf.js's for a 600×800 pt page at scale 1, rotated 0 or 90. */
function vp(rotation: 0 | 90): Viewport {
  const W = 600;
  const H = 800;
  if (rotation === 0)
    return {
      width: W,
      height: H,
      convertToPdfPoint: (x, y) => [x, H - y],
      convertToViewportPoint: (x, y) => [x, H - y],
    };
  // Rotated 90° clockwise: displayed width = H; user (x, y) shows at (y, x).
  return {
    width: H,
    height: W,
    convertToPdfPoint: (x, y) => [y, x],
    convertToViewportPoint: (x, y) => [y, x],
  };
}

describe('pdf marks', () => {
  it('maps a mark to a stamp matrix (unrotated page)', () => {
    const m = stampMatrix({ x: 0.5, y: 0.25, w: 0.25, h: 0.1 }, vp(0));
    // 150 pt wide, 80 pt tall, bottom-left at (300, 800 - 280).
    expect(m).toEqual([150, 0, 0, 80, 300, 520]);
  });
  it('keeps the image upright on a rotated page', () => {
    const m = stampMatrix({ x: 0.1, y: 0.2, w: 0.25, h: 0.1 }, vp(90));
    // The image x axis follows the displayed x axis → user y; its y axis (displayed up) → user −x.
    expect(m[0]).toBeCloseTo(0);
    expect(m[1]).toBeCloseTo(200);
    expect(m[2]).toBeCloseTo(-60);
    expect(m[3]).toBeCloseTo(0);
  });
  it('carries a mark into the unrotated viewport for rasterising', () => {
    const poly = markPolygon({ x: 0, y: 0, w: 0.5, h: 0.5 }, vp(90), vp(0));
    expect(poly).toEqual([
      [0, 800],
      [0, 400],
      [300, 400],
      [300, 800],
    ]);
  });
  it('finds text matches as page rectangles', () => {
    const runs = [{ str: 'Total: 1234 EUR', transform: [10, 0, 0, 10, 100, 700], width: 150, height: 10 }];
    const r = matchRects(runs, '1234', false, vp(0));
    expect(r).toHaveLength(1);
    // "1234" is characters 7–10 of 15: x ≈ 100 + 70 … 100 + 110 pt.
    expect(r[0].x * 600).toBeCloseTo(170 - 0.8, 1);
    expect((r[0].x + r[0].w) * 600).toBeCloseTo(210 + 0.8, 1);
    expect(r[0].y * 800).toBeCloseTo(800 - 710, 1);
    expect(matchRects(runs, 'eur', true, vp(0))).toHaveLength(0);
    expect(matchRects(runs, 'eur', false, vp(0))).toHaveLength(1);
  });
  it('trims ink and makes paper transparent', () => {
    const w = 4;
    const h = 3;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    // One dark pixel at (2, 1), one mid-grey at (1, 1).
    px.set([20, 20, 30, 255], (1 * w + 2) * 4);
    px.set([150, 150, 150, 255], (1 * w + 1) * 4);
    paperToAlpha(px);
    expect(px[3]).toBe(0);
    expect(px[(1 * w + 2) * 4 + 3]).toBe(255);
    expect(px[(1 * w + 1) * 4 + 3]).toBeGreaterThan(0);
    expect(px[(1 * w + 1) * 4 + 3]).toBeLessThan(255);
    expect(inkBox(px, w, h)).toEqual({ x: 1, y: 1, w: 2, h: 1 });
    expect(inkBox(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});
