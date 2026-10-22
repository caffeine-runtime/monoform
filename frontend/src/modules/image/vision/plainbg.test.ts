import { describe, expect, it } from 'vitest';
import { plainBorder, removePlain, type RGB } from './plainbg';

/** A w×h image filled with c, then each [x, y, colour] painted. */
function img(w: number, h: number, c: RGB, paint: [number, number, RGB][] = []): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...c, 255], i * 4);
  for (const [x, y, k] of paint) px.set([...k, 255], (y * w + x) * 4);
  return px;
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

/** A 20×20 white picture with a black square outline (5..14) and a grey pixel on it. */
function drawing(): Uint8ClampedArray {
  const paint: [number, number, RGB][] = [];
  for (let i = 5; i <= 14; i++) paint.push([i, 5, [0, 0, 0]], [i, 14, [0, 0, 0]], [5, i, [0, 0, 0]], [14, i, [0, 0, 0]]);
  paint.push([2, 2, [128, 128, 128]]);
  return img(20, 20, [255, 255, 255], paint);
}

describe('plain background', () => {
  it('finds the colour of a plain border, not of a busy one', () => {
    expect(plainBorder(img(30, 20, [250, 250, 248]), 30, 20)).toEqual([250, 250, 248]);
    const busy = img(30, 20, [255, 255, 255]);
    for (let i = 0; i < 30 * 20; i++) busy[i * 4] = (i * 37) % 256;
    expect(plainBorder(busy, 30, 20)).toBeNull();
  });

  it('clears it everywhere in a drawing, keeping lines and their soft edges', () => {
    const r = removePlain(drawing(), 20, 20, [255, 255, 255]);
    expect(r.everywhere).toBe(true); // mostly background → a drawing
    expect(at(r.rgba, 20, 0, 0)[3]).toBe(0);
    expect(at(r.rgba, 20, 10, 10)[3]).toBe(0); // inside the closed square too
    expect(at(r.rgba, 20, 5, 9)).toEqual([0, 0, 0, 255]);
    // A soft edge (mid-grey) becomes a darker grey, partly transparent: over white it looks as before.
    const grey = at(r.rgba, 20, 2, 2);
    expect(grey[0]).toBeLessThan(60);
    expect(Math.abs(255 + (grey[0] - 255) * (grey[3] / 255) - 128)).toBeLessThan(3);
    expect(grey[3]).toBeGreaterThan(130);
    expect(grey[3]).toBeLessThan(170);
  });

  it('only from the edges keeps closed areas', () => {
    const r = removePlain(drawing(), 20, 20, [255, 255, 255], false);
    expect(r.everywhere).toBe(false);
    expect(at(r.rgba, 20, 0, 0)[3]).toBe(0);
    expect(at(r.rgba, 20, 10, 10)).toEqual([255, 255, 255, 255]);
    expect(at(r.rgba, 20, 14, 9)).toEqual([0, 0, 0, 255]);
  });

  it('picks "from the edges" when the subject fills most of the picture', () => {
    // A 20×20 white frame two pixels wide around a red block with a white spot.
    const paint: [number, number, RGB][] = [];
    for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) paint.push([x, y, x === 10 && y === 10 ? [255, 255, 255] : [200, 30, 30]]);
    const r = removePlain(img(20, 20, [255, 255, 255], paint), 20, 20, [255, 255, 255]);
    expect(r.everywhere).toBe(false);
    expect(at(r.rgba, 20, 10, 10)).toEqual([255, 255, 255, 255]); // the white spot in the subject stays
    expect(at(r.rgba, 20, 0, 10)[3]).toBe(0);
    expect(at(r.rgba, 20, 5, 5)).toEqual([200, 30, 30, 255]); // the subject stays solid, in its own colour
  });

  it('ignores slight noise in the background', () => {
    const r = removePlain(img(10, 10, [255, 255, 255], [[3, 3, [250, 251, 249]]]), 10, 10, [255, 255, 255]);
    expect(at(r.rgba, 10, 3, 3)[3]).toBe(0);
  });
});
