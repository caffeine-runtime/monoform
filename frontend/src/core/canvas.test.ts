import { describe, expect, it } from 'vitest';
import { IMAGE_UNDO, darkColor, darkMatrix, isLight, parseColor } from './canvas';

describe('dark canvas colours', () => {
  it('parses hex colours and transparency', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#1e1e1e80')).toEqual([30, 30, 30, 128 / 255]);
    expect(parseColor('transparent')?.[3]).toBe(0);
  });

  it('turns white paper near-black and black ink near-white, as Excalidraw does', () => {
    expect(darkColor('#ffffff')).toBe('rgb(18, 18, 18)');
    expect(darkColor('#000')).toBe('rgb(237, 237, 237)');
  });

  it('keeps hues: red stays red, blue stays blue', () => {
    const rgb = (css: string) => css.match(/\d+/g)!.map(Number);
    const [r, g, b] = rgb(darkColor('#e03131'));
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
    const blue = rgb(darkColor('#1971c2'));
    expect(blue[2]).toBeGreaterThan(blue[0] + 40);
  });

  it('only darkens light backgrounds', () => {
    expect(isLight('#ffffff')).toBe(true);
    expect(isLight('#fff8e1')).toBe(true);
    expect(isLight('transparent')).toBe(true);
    expect(isLight('#121212')).toBe(false);
    expect(isLight('#1e3a5f')).toBe(false);
  });

  it('flips images back: the image filter then the canvas filter leaves greys close to where they were', () => {
    const u = IMAGE_UNDO.split(' ').map(Number);
    expect(u).toHaveLength(20);
    const m = darkMatrix();
    for (const v of [0.2, 0.5, 0.8]) {
      const after = u.slice(0, 3).reduce((a, k) => a + k * v, 0) + u[4];
      const shown = m[0].slice(0, 3).reduce((a, k) => a + k * after, 0) + m[0][3];
      expect(Math.abs(shown - v)).toBeLessThan(0.08);
    }
  });
});
