import { describe, expect, it } from 'vitest';
import { extractPalette, formats, hex, hsl, toCss, toGpl } from './palette';

function pixels(parts: [number, [number, number, number, number?]][]): Uint8ClampedArray {
  const total = parts.reduce((s, [n]) => s + n, 0);
  const a = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [n, [r, g, b, al = 255]] of parts) for (let k = 0; k < n; k++, i += 4) a.set([r, g, b, al], i);
  return a;
}

describe('palette', () => {
  it('finds the dominant colours with their shares, ignoring transparency', () => {
    const p = extractPalette(pixels([[600, [220, 40, 30]], [300, [20, 90, 200]], [100, [250, 250, 250]], [500, [0, 255, 0, 0]]]), 5);
    expect(p.map((c) => hex(c.rgb))).toEqual(['#dc281e', '#145ac8', '#fafafa']);
    expect(p.map((c) => Math.round(c.share * 100))).toEqual([60, 30, 10]);
  });

  it('separates a gradient into steps', () => {
    const parts: [number, [number, number, number]][] = [];
    for (let v = 0; v < 256; v += 4) parts.push([10, [v, v, v]]);
    const p = extractPalette(pixels(parts), 4);
    expect(p).toHaveLength(4);
    const greys = p.map((c) => c.rgb[0]).sort((a, b) => a - b);
    expect(greys[0]).toBeLessThan(50);
    expect(greys[3]).toBeGreaterThan(200);
  });

  it('formats colours', () => {
    expect(hsl([255, 0, 0])).toEqual([0, 100, 50]);
    expect(hsl([128, 128, 128])).toEqual([0, 0, 50]);
    expect(formats([18, 52, 86]).map((f) => f.value)).toEqual(['#123456', 'rgb(18, 52, 86)', 'hsl(210, 65%, 20%)']);
    const pal = [{ rgb: [1, 2, 3] as [number, number, number], share: 1 }];
    expect(toGpl('Shot', pal)).toBe('GIMP Palette\nName: Shot\nColumns: 1\n#\n  1   2   3\t#010203\n');
    expect(toCss(pal)).toContain('--color-1: #010203;');
    expect(extractPalette(new Uint8ClampedArray(0), 5)).toEqual([]);
  });
});
