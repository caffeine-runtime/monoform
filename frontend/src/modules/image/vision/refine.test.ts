import { describe, expect, it } from 'vitest';
import { refineMask, snapMask } from './refine';

const W = 80;
const H = 40;

/** RGBA image from a colour function. */
function image(fn: (x: number, y: number) => number[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = fn(x, y);
      px.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
  }
  return px;
}

/** A soft model mask whose edge is at column `edge` (like an upscaled 256 px mask). */
function prior(edge: number, softness: number): Float32Array {
  const p = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p[y * W + x] = 1 / (1 + Math.exp((x + 0.5 - edge) / softness));
  return p;
}

const at = (a: Float32Array, x: number, y = H / 2) => a[y * W + x];

describe('refineMask', () => {
  it('snaps a blurry, misplaced edge to the real colour edge', () => {
    // Red object on the left (x < 37), blue background on the right; the model says the edge is at 33.
    const px = image((x) => (x < 37 ? [200, 30, 40] : [40, 80, 200]));
    const a = refineMask(px, W, H, prior(33, 2), 6);
    for (let x = 0; x < 37; x++) expect(at(a, x)).toBeGreaterThan(0.95);
    for (let x = 37; x < W; x++) expect(at(a, x)).toBeLessThan(0.05);
  });

  it('gives an anti-aliased edge pixel partial alpha', () => {
    const px = image((x) => (x < 40 ? [255, 255, 255] : x === 40 ? [128, 128, 128] : [0, 0, 0]));
    const a = refineMask(px, W, H, prior(42, 2), 6);
    expect(at(a, 39)).toBeGreaterThan(0.9);
    expect(at(a, 40)).toBeGreaterThan(0.2);
    expect(at(a, 40)).toBeLessThan(0.8);
    expect(at(a, 41)).toBeLessThan(0.1);
  });

  it('keeps the model mask where inside and outside look the same', () => {
    const px = image(() => [120, 120, 120]);
    const p = prior(40, 2);
    const a = refineMask(px, W, H, p, 6);
    expect(at(a, 30)).toBeGreaterThan(0.9);
    expect(at(a, 50)).toBeLessThan(0.1);
    expect(Math.abs(at(a, 40) - 0.5)).toBeLessThan(0.4);
  });

  it('leaves confident pixels untouched', () => {
    const px = image((x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])); // noisy texture everywhere
    const a = refineMask(px, W, H, prior(40, 0.5), 3);
    expect(at(a, 5)).toBe(1);
    expect(at(a, 75)).toBe(0);
  });

  it('finds a noisy round object pixel-exactly from an offset, blurry mask', () => {
    const w = 200;
    const h = 150;
    const inDisc = (x: number, y: number) => (x - 100) ** 2 + (y - 75) ** 2 < 50 ** 2;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 30;
    const px = new Uint8ClampedArray(w * h * 4);
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = inDisc(x, y) ? [200 - rnd(), 30, 40 + rnd()] : [40, 80 + rnd(), 200];
        px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
        p[y * w + x] = 1 / (1 + Math.exp((Math.hypot(x - 103, y - 71) - 50) / 3)); // model is 3–4 px off
      }
    }
    const a = refineMask(px, w, h, p, 8);
    let wrong = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(a[y * w + x] - (inDisc(x, y) ? 1 : 0)) > 0.5) wrong++;
    expect(wrong).toBe(0);
  });
});

describe('snapMask', () => {
  /** A noisy picture (w×h) from an inside test and two colours, with a soft model mask from a distance function. */
  function scene(w: number, h: number, inside: (x: number, y: number) => boolean, fg: number[], bg: number[], modelDist: (x: number, y: number) => number) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 24 - 12;
    const px = new Uint8ClampedArray(w * h * 4);
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = inside(x, y) ? fg : bg;
        px.set([c[0] + rnd(), c[1] + rnd(), c[2] + rnd(), 255], (y * w + x) * 4);
        p[y * w + x] = 1 / (1 + Math.exp(modelDist(x, y) / 2.5));
      }
    }
    return { px, p };
  }

  it('lands a soft, slightly offset edge on the real one', () => {
    const w = 200;
    const h = 150;
    const inDisc = (x: number, y: number) => (x - 100) ** 2 + (y - 75) ** 2 < 50 ** 2;
    const { px, p } = scene(w, h, inDisc, [200, 40, 50], [40, 90, 200], (x, y) => Math.hypot(x - 101.5, y - 74) - 50); // ~2 px off
    const a = snapMask(px, w, h, p, 4);
    let wrong = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > 0.5 !== inDisc(x, y)) wrong++;
    expect(wrong).toBeLessThanOrEqual(3);
  });

  it('keeps out a cloud as light as the object next to it', () => {
    // A light-grey wing (x < 100) beside blue sky with a wisp of white cloud at x 100–109.
    const w = 200;
    const h = 60;
    const wing = (x: number) => x < 100;
    const cloud = (x: number) => x >= 100 && x < 110;
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 16 - 8;
    const px = new Uint8ClampedArray(w * h * 4);
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = wing(x) ? [190, 190, 185] : cloud(x) ? [235, 238, 242] : [50, 80, 160];
        px.set([c[0] + rnd(), c[1] + rnd(), c[2] + rnd(), 255], (y * w + x) * 4);
        p[y * w + x] = 1 / (1 + Math.exp((x + 0.5 - 100) / 2.5)); // the model has the wing right
      }
    }
    const a = snapMask(px, w, h, p, 4);
    for (const x of [103, 105, 108, 120]) expect(a[30 * w + x]).toBeLessThan(0.5);
    for (const x of [60, 90, 96]) expect(a[30 * w + x]).toBeGreaterThan(0.5);
    // Re-deciding by colour (refineMask) takes the cloud for wing — what spoiled cut-outs on photos.
    const old = refineMask(px, w, h, p, 12);
    expect(old[30 * w + 105]).toBeGreaterThan(0.5);
  });

  it('leaves pixels far from the edge as the model has them', () => {
    const w = 120;
    const h = 40;
    const { px, p } = scene(w, h, (x) => x < 60, [230, 230, 230], [20, 20, 20], (x) => x + 0.5 - 60);
    const a = snapMask(px, w, h, p, 3);
    expect(a[20 * w + 10]).toBe(1);
    expect(a[20 * w + 110]).toBe(0);
  });
});
