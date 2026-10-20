import { describe, expect, it } from 'vitest';
import { EMPTY, advance, cubicBezier, ease, frameAt, hasEffects, outputLength, outputTimeOf, pieces, setKey, setSpeed, stateAt, stretched, type Layer, type Project } from './project';

const layer = (keys: Partial<Layer['keys'][number]>[], extra: Partial<Layer> = {}): Layer => ({
  id: 'l',
  kind: 'image',
  name: 'x',
  start: 0,
  end: 10,
  path: 'straight',
  fadeIn: 0,
  fadeOut: 0,
  w: 10,
  h: 10,
  keys: keys.map((k) => ({ t: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ease: 'linear', ...k })),
  ...extra,
});

describe('easing', () => {
  it('cubic-bezier matches its end points and the CSS ease-in-out midpoint', () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(cubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1);
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier(0.42, 0, 1, 1, 0.25)).toBeLessThan(0.25); // ease-in starts slow
  });
  it('named curves', () => {
    expect(ease('linear', 0.3)).toBeCloseTo(0.3);
    expect(ease('easeOut', 0.25)).toBeGreaterThan(0.25);
    expect(ease('hold', 0.99)).toBe(0);
    expect(ease('bounce', 1)).toBeCloseTo(1);
    expect(ease({ bezier: [0, 1, 0, 1] }, 0.1)).toBeGreaterThan(0.5);
  });
});

describe('keyframes', () => {
  it('interpolates with the easing of the earlier key', () => {
    const l = layer([{ t: 0, x: 0 }, { t: 2, x: 100, opacity: 0 }]);
    expect(stateAt(l, 1).x).toBeCloseTo(50);
    expect(stateAt(l, 1).opacity).toBeCloseTo(0.5);
    expect(stateAt(l, -1).x).toBe(0);
    expect(stateAt(l, 5).x).toBe(100);
    const e = layer([{ t: 0, x: 0, ease: 'easeIn' }, { t: 2, x: 100 }]);
    expect(stateAt(e, 0.5).x).toBeLessThan(25);
  });
  it('smooth paths curve through the keys', () => {
    const l = layer([{ t: 0, x: 0, y: 0 }, { t: 1, x: 100, y: 0 }, { t: 2, x: 100, y: 100 }], { path: 'smooth' });
    expect(stateAt(l, 1).x).toBeCloseTo(100);
    const mid = stateAt(l, 1.5);
    expect(mid.x).toBeGreaterThan(100); // overshoots the corner, a curve
  });
  it('fades multiply opacity', () => {
    const l = layer([{ t: 0 }], { start: 2, end: 6, fadeIn: 1, fadeOut: 2 });
    expect(stateAt(l, 2.5).opacity).toBeCloseTo(0.5);
    expect(stateAt(l, 5).opacity).toBeCloseTo(0.5);
    expect(stateAt(l, 4).opacity).toBe(1);
  });
  it('setKey adds a key at the current state or updates the one there', () => {
    let l = layer([{ t: 0, x: 0 }, { t: 2, x: 100 }]);
    l = setKey(l, 1, { y: 30 });
    expect(l.keys.map((k) => k.t)).toEqual([0, 1, 2]);
    expect(l.keys[1].x).toBeCloseTo(50);
    expect(l.keys[1].y).toBe(30);
    l = setKey(l, 1.001, { y: 40 });
    expect(l.keys.length).toBe(3);
    expect(l.keys[1].y).toBe(40);
  });
});

describe('output timeline', () => {
  const kept: [number, number][] = [
    [0, 4],
    [6, 10],
  ];
  it('speed changes stretch and shrink time', () => {
    const sp = setSpeed([], 0, 2, 2);
    expect(stretched(sp, 0, 4)).toBeCloseTo(3);
    expect(advance(sp, 0, 1, 4)).toBeCloseTo(2);
    expect(advance(sp, 0, 2, 4)).toBeCloseTo(3);
    expect(setSpeed(sp, 1, 3, 0.5)).toEqual([
      { a: 0, b: 1, rate: 2 },
      { a: 1, b: 3, rate: 0.5 },
    ]);
    expect(setSpeed(sp, 0, 2, 1)).toEqual([]);
  });
  it('lays out pieces, overlapping crossfades', () => {
    const p: Project = { ...EMPTY, transitions: [{ at: 4, kind: 'crossfade', dur: 1 }] };
    const ps = pieces(kept, p);
    expect(ps.map((x) => x.out)).toEqual([
      [0, 4],
      [3, 7],
    ]);
    expect(outputLength(ps)).toBe(7);
    const mid = frameAt(ps, p, 3.5)!;
    expect(mid.a.t).toBeCloseTo(3.5);
    expect(mid.b!.t).toBeCloseTo(6.5);
    expect(mid.b!.progress).toBeCloseTo(0.5);
    expect(frameAt(ps, p, 5)!.b).toBeNull();
    expect(frameAt(ps, p, 5)!.a.t).toBeCloseTo(8);
  });
  it('dips darken around the cut without overlapping', () => {
    const p: Project = { ...EMPTY, transitions: [{ at: 4, kind: 'dip', dur: 1 }], fadeIn: 1 };
    const ps = pieces(kept, p);
    expect(outputLength(ps)).toBe(8);
    expect(frameAt(ps, p, 3.75)!.light).toBeCloseTo(0.5);
    expect(frameAt(ps, p, 4.25)!.light).toBeCloseTo(0.5);
    expect(frameAt(ps, p, 2)!.light).toBe(1);
    expect(frameAt(ps, p, 0.5)!.light).toBeCloseTo(0.5);
    expect(outputTimeOf(ps, p, 7)).toBeCloseTo(5);
    expect(outputTimeOf(ps, p, 5)).toBeNull();
  });
  it('knows when there is something to render', () => {
    expect(hasEffects(EMPTY)).toBe(false);
    expect(hasEffects({ ...EMPTY, speeds: [{ a: 0, b: 1, rate: 2 }] })).toBe(true);
  });
});

describe('editing helpers', () => {
  it('rotation coordinate maps are inverses', async () => {
    const { toSource, toOutput } = await import('./project');
    for (const rot of [0, 90, 180, 270]) {
      const [sx, sy] = toSource(30, 10, rot, 200, 100);
      expect(toOutput(sx, sy, rot, 200, 100)).toEqual([30, 10]);
    }
    expect(toSource(0, 0, 90, 200, 100)).toEqual([0, 100]); // output top-left is the source's bottom-left
  });
  it('place moves a static layer or keys an animated one', async () => {
    const { place } = await import('./project');
    const l = layer([{ t: 0, x: 5 }]);
    expect(place(l, 3, { x: 9 }, false).keys).toHaveLength(1);
    expect(place(l, 3, { x: 9 }, true).keys.map((k) => k.t)).toEqual([0, 3]);
  });
});
