import { describe, expect, it } from 'vitest';
import { parseStyle, renderStyle, shadowOffset, stylePad, styleEmpty } from './styles';

/** A w × h alpha with an opaque square [x0, x1) × [y0, y1). */
function square(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  return a;
}

/** RGBA of the render at a pixel of the layer. */
function at(r: NonNullable<ReturnType<typeof renderStyle>>, x: number, y: number): number[] {
  const lx = x - r.x;
  const ly = y - r.y;
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return [0, 0, 0, 0];
  const k = (ly * r.w + lx) * 4;
  return Array.from(r.rgba.slice(k, k + 4));
}

describe('layer styles', () => {
  const a = square(60, 60, 20, 20, 40, 40);

  it('nothing on, or an empty layer: nothing drawn', () => {
    expect(styleEmpty({})).toBe(true);
    expect(styleEmpty({ shadow: null })).toBe(true);
    expect(renderStyle(a, 60, 60, {})).toBeNull();
    expect(renderStyle(new Uint8ClampedArray(100), 10, 10, { stroke: { color: '#ff0000', opacity: 1, size: 2 } })).toBeNull();
  });

  it('a stroke rings the shape outside, as wide as its size', () => {
    const r = renderStyle(a, 60, 60, { stroke: { color: '#ff0000', opacity: 1, size: 3 } })!;
    expect(r.x).toBeLessThan(20 - 3);
    expect(at(r, 18, 30)).toEqual([255, 0, 0, 255]); // 2 px out
    expect(at(r, 16, 30)[3]).toBe(0); // 4 px out
    expect(at(r, 30, 30)[3]).toBe(0); // inside: not under the shape
    expect(at(r, 41, 41)[3]).toBe(255); // round the corner
  });

  it('a drop shadow falls away from the light, softened', () => {
    const s = { color: '#000000', opacity: 1, angle: 90, distance: 10, size: 0 };
    expect(shadowOffset(s).dx).toBeCloseTo(0);
    expect(shadowOffset(s).dy).toBeCloseTo(10); // light from above: shadow below
    const r = renderStyle(a, 60, 60, { shadow: s })!;
    expect(at(r, 30, 45)[3]).toBe(255); // under the shape
    expect(at(r, 30, 15)[3]).toBe(0); // not above it
    const soft = renderStyle(a, 60, 60, { shadow: { ...s, size: 8, opacity: 0.5 } })!;
    const edge = at(soft, 30, 50)[3]; // the shadow's bottom edge
    expect(edge).toBeGreaterThan(20);
    expect(edge).toBeLessThan(110);
    expect(at(soft, 30, 40)[3]).toBeGreaterThan(edge);
  });

  it('a glow fades out over its size', () => {
    const r = renderStyle(a, 60, 60, { glow: { color: '#ffff00', opacity: 1, size: 10 } })!;
    const near = at(r, 41, 30)[3];
    const mid = at(r, 45, 30)[3];
    const far = at(r, 51, 30)[3];
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBe(0);
    expect(at(r, 45, 30).slice(0, 3)).toEqual([255, 255, 0]);
  });

  it('stroke over glow over shadow; the pad covers them all', () => {
    const style = { shadow: { color: '#0000ff', opacity: 1, angle: 0, distance: 6, size: 0 }, stroke: { color: '#ff0000', opacity: 1, size: 2 } };
    const r = renderStyle(a, 60, 60, style)!;
    expect(at(r, 19, 30)).toEqual([255, 0, 0, 255]); // the stroke on top of the shadow there
    expect(at(r, 15, 30)).toEqual([0, 0, 255, 255]); // light from the right: the shadow to the left
    expect(at(r, 45, 30)[3]).toBe(0); // and not to the right
    expect(stylePad(style)).toBeGreaterThanOrEqual(8);
  });

  it('reads a style back from a file, keeping it in range', () => {
    expect(parseStyle(undefined)).toBeNull();
    expect(parseStyle('nonsense')).toBeNull();
    expect(parseStyle('{}')).toBeNull();
    const s = parseStyle(JSON.stringify({ stroke: { color: '#00ff00', size: 9999, opacity: 2 }, glow: { color: 'red' } }))!;
    expect(s.stroke).toEqual({ color: '#00ff00', size: 250, opacity: 1 });
    expect(s.glow!.color).toBe('#ffd84d');
    expect(s.shadow).toBeUndefined();
  });
});
