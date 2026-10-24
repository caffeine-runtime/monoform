import { describe, expect, it } from 'vitest';
import { heal } from './heal';

const W = 120;
const H = 90;

/** A picture from a colour function (RGBA). */
function picture(fn: (x: number, y: number) => number[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set([...fn(x, y), 255], (y * W + x) * 4);
  return px;
}
function disc(cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * W + x] = 255;
  return m;
}
const at = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

describe('heal', () => {
  it('removes a spot from a smooth gradient, matching the light around it', () => {
    // A left-to-right gradient with a dark spot at (60, 45).
    const g = (x: number) => [60 + x, 80 + x, 100 + x];
    const px = picture((x, y) => ((x - 60) ** 2 + (y - 45) ** 2 <= 36 ? [10, 10, 10] : g(x)));
    const out = heal(px, W, H, disc(60, 45, 8));
    for (const [x, y] of [[60, 45], [55, 45], [65, 48]]) {
      const want = g(x);
      const got = at(out, x, y);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c])).toBeLessThanOrEqual(3);
    }
  });

  it('keeps texture: a striped background stays striped where the spot was', () => {
    const stripe = (x: number) => (Math.floor(x / 4) % 2 ? [200, 200, 200] : [40, 40, 40]);
    const px = picture((x, y) => ((x - 60) ** 2 + (y - 45) ** 2 <= 25 ? [255, 0, 0] : stripe(x)));
    const out = heal(px, W, H, disc(60, 45, 7));
    // No red left, and still both stripe colours inside.
    let red = 0, light = 0, dark = 0;
    for (let y = 40; y <= 50; y++) {
      for (let x = 55; x <= 65; x++) {
        const [r, g] = at(out, x, y);
        if (r > 150 && g < 80) red++;
        if (g > 150) light++;
        if (g < 90) dark++;
      }
    }
    expect(red).toBe(0);
    expect(light).toBeGreaterThan(20);
    expect(dark).toBeGreaterThan(20);
  });

  it('changes nothing outside what was painted', () => {
    const px = picture((x, y) => [x * 2, y * 2, 128]);
    const out = heal(px, W, H, disc(30, 30, 5));
    expect(at(out, 50, 50)).toEqual(at(px, 50, 50));
    expect(at(out, 30, 37)).toEqual(at(px, 30, 37));
    expect(heal(px, W, H, new Uint8Array(W * H))).toEqual(px);
  });
});
