import { describe, expect, it } from 'vitest';
import { dilate, eraseRect, feather } from './erase';

describe('object removal helpers', () => {
  it('crops a square around the selection, inside the picture', () => {
    // A small object in a big photo: at least 512 px, centred on it.
    expect(eraseRect({ x: 1000, y: 800, width: 100, height: 60 }, 4000, 3000)).toEqual({ x: 794, y: 574, width: 512, height: 512 });
    // A big object: 1.8× plus a margin.
    const r = eraseRect({ x: 1000, y: 1000, width: 800, height: 400 }, 4000, 3000);
    expect(r.width).toBe(1488);
    expect(r.height).toBe(1488);
    expect(r.x + r.width / 2).toBe(1400);
    // Near the edge: shifted inside.
    expect(eraseRect({ x: 0, y: 0, width: 50, height: 50 }, 4000, 3000)).toMatchObject({ x: 0, y: 0, width: 512 });
    // A small picture: all of it.
    expect(eraseRect({ x: 100, y: 50, width: 40, height: 40 }, 300, 200)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    // Always covers the selection.
    const b = { x: 10, y: 20, width: 3900, height: 100 };
    const c = eraseRect(b, 4000, 3000);
    expect(c.x <= b.x && c.x + c.width >= b.x + b.width).toBe(true);
  });

  it('grows and softens masks', () => {
    const m = new Uint8Array(9 * 9);
    m[4 * 9 + 4] = 255;
    const d = dilate(m, 9, 9, 2);
    expect(d.filter((v) => v === 255).length).toBe(25);
    expect(d[1 * 9 + 4]).toBe(0);
    const f = feather(d, 9, 9, 1);
    expect(f[4 * 9 + 4]).toBe(255);
    expect(f[1 * 9 + 4]).toBeGreaterThan(0);
    expect(f[2 * 9 + 4]).toBeLessThan(255);
  });
});
