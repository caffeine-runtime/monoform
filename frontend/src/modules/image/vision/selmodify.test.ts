import { describe, expect, it } from 'vitest';
import { modifyMask, signedDistance } from './selmodify';

const W = 100;
const H = 80;

/** A 40×30 rectangle at (30, 25). */
function rect(): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H);
  for (let y = 25; y < 55; y++) for (let x = 30; x < 70; x++) a[y * W + x] = 255;
  return a;
}
const on = (a: Uint8ClampedArray, x: number, y: number) => a[y * W + x] > 127;
const count = (a: Uint8ClampedArray) => a.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);

describe('modifyMask', () => {
  it('expands by the radius, with round corners', () => {
    const a = modifyMask(rect(), W, H, 'expand', 5);
    expect(on(a, 25, 40) && on(a, 74, 40) && on(a, 50, 20) && on(a, 50, 59)).toBe(true);
    expect(on(a, 23, 40) || on(a, 76, 40)).toBe(false);
    // A corner rounds off: 5 px out diagonally from (30, 25) is beyond the radius.
    expect(on(a, 25, 20)).toBe(false);
    expect(on(a, 27, 22)).toBe(true);
  });

  it('contracts by the radius', () => {
    const a = modifyMask(rect(), W, H, 'contract', 5);
    expect(on(a, 35, 40) && on(a, 64, 40)).toBe(true);
    expect(on(a, 33, 40) || on(a, 66, 40) || on(a, 50, 27)).toBe(false);
    expect(count(a)).toBe(30 * 20);
  });

  it('borders the edge: a band of the width across it, the middle empty', () => {
    const a = modifyMask(rect(), W, H, 'border', 6);
    expect(on(a, 30, 40) && on(a, 27, 40) && on(a, 32, 40)).toBe(true);
    expect(on(a, 50, 40) || on(a, 20, 40)).toBe(false);
  });

  it('feathers: soft from inside to outside, the middle untouched', () => {
    const a = modifyMask(rect(), W, H, 'feather', 8);
    expect(a[40 * W + 50]).toBe(255);
    expect(a[40 * W + 30]).toBeGreaterThan(80);
    expect(a[40 * W + 30]).toBeLessThan(200);
    expect(a[40 * W + 26]).toBeGreaterThan(0);
    expect(a[40 * W + 10]).toBe(0);
  });

  it('smooths away specks and rounds corners', () => {
    const a = rect();
    a[10 * W + 10] = 255; // a stray pixel
    const s = modifyMask(a, W, H, 'smooth', 6);
    expect(on(s, 10, 10)).toBe(false);
    expect(on(s, 50, 40)).toBe(true);
    expect(on(s, 30, 25)).toBe(false); // the sharp corner is cut
  });

  it('leaves an empty selection empty and a radius of 0 as it was', () => {
    expect(count(modifyMask(new Uint8ClampedArray(W * H), W, H, 'expand', 5))).toBe(0);
    expect(modifyMask(rect(), W, H, 'feather', 0)).toEqual(rect());
  });
});

describe('signedDistance', () => {
  it('is half a pixel at the edge, negative inside', () => {
    const s = new Float32Array(10);
    for (let i = 0; i < 5; i++) s[i] = 1;
    const d = signedDistance(s, 10, 1);
    expect(d[4]).toBeCloseTo(-0.5);
    expect(d[5]).toBeCloseTo(0.5);
    expect(d[0]).toBeCloseTo(-4.5);
    expect(d[9]).toBeCloseTo(4.5);
  });
});
