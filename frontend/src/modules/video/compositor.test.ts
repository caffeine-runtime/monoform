import { describe, expect, it } from 'vitest';
import { frameMatrix, layerMatrix } from './compositor';

const apply = (m: number[], x: number, y: number) => [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]].map((v) => Math.round(v * 1000) / 1000 + 0);

describe('compositor matrices', () => {
  it('fits a frame, rotated, into the output', () => {
    expect(apply(frameMatrix(0, 320, 180, 320, 180), 1, 1)).toEqual([320, 180]);
    // 90° clockwise: the source's top-left lands at the output's top-right.
    const m = frameMatrix(90, 320, 180, 180, 320);
    expect(apply(m, 0, 0)).toEqual([180, 0]);
    expect(apply(m, 1, 0)).toEqual([180, 320]);
    expect(apply(m, 0, 1)).toEqual([0, 0]);
  });
  it('centres a layer on its position', () => {
    const m = layerMatrix(100, 50, 40, 20, 2, 0);
    expect(apply(m, 0, 0)).toEqual([60, 30]);
    expect(apply(m, 1, 1)).toEqual([140, 70]);
    const r = layerMatrix(0, 0, 10, 10, 1, 90);
    expect(apply(r, 1, 0.5)).toEqual([0, 5]);
  });
});
