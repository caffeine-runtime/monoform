import { describe, expect, it } from 'vitest';
import { Tracker, toGray, type Gray } from './track';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const W = 200;
const H = 120;
const background = Float32Array.from({ length: W * H }, () => rnd() * 0.3);
const object = Float32Array.from({ length: 20 * 20 }, (_, i) => 0.5 + 0.5 * (((i % 20) ^ ((i / 20) | 0)) & 4 ? 1 : 0) * rnd());

/** Background noise with a textured 20×20 object whose centre is at (cx, cy). */
function frame(cx: number, cy: number): Gray {
  const data = background.slice();
  const x0 = Math.round(cx - 10);
  const y0 = Math.round(cy - 10);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) data[(y0 + y) * W + x0 + x] = object[y * 20 + x];
  return { w: W, h: H, data };
}

describe('Tracker', () => {
  it('follows a moving, accelerating object', () => {
    let cx = 40;
    let cy = 60;
    const t = new Tracker(frame(cx, cy), { x: cx, y: cy, w: 20, h: 20 });
    for (let i = 1; i <= 30; i++) {
      cx += 2 + i * 0.1; // ends near x = 147, inside the frame
      cy += Math.sin(i / 4) * 3;
      const p = t.next(frame(cx, cy));
      expect(p).not.toBeNull();
      expect(Math.abs(p!.x - Math.round(cx))).toBeLessThan(1.01);
      expect(Math.abs(p!.y - Math.round(cy))).toBeLessThan(1.01);
      expect(p!.score).toBeGreaterThan(0.9);
    }
  });

  it('reports a lost object', () => {
    const t = new Tracker(frame(50, 50), { x: 50, y: 50, w: 20, h: 20 });
    expect(t.next({ w: W, h: H, data: background.slice() })).toBeNull();
  });

  it('converts RGBA to gray', () => {
    const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(g.data[0]).toBeCloseTo(1);
    expect(g.data[1]).toBe(0);
  });
});

describe('Tracker on an ambiguous edge', () => {
  it('does not slide along a plain vertical edge', () => {
    const data = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = x < 100 ? 0.9 : 0.1;
    const f = { w: W, h: H, data };
    const t = new Tracker(f, { x: 100, y: 60, w: 20, h: 20 });
    for (let i = 0; i < 50; i++) {
      const p = t.next(f)!;
      expect(Math.hypot(p.x - 100, p.y - 60)).toBeLessThan(1);
    }
  });
});
