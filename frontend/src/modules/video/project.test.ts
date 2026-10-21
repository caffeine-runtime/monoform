import { describe, expect, it } from 'vitest';
import { EMPTY, advance, cubicBezier, ease, frameAt, hasEffects, maskOf, newLayer, outlineToBox, outputLength, outputTimeOf, pieces, place, setKey, setSpeed, simplify, stateAt, stretched, toOutput, toSource, withMask, type Layer, type Project } from './project';

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
  it('rotation coordinate maps are inverses', () => {
    for (const rot of [0, 90, 180, 270]) {
      const [sx, sy] = toSource(30, 10, rot, 200, 100);
      expect(toOutput(sx, sy, rot, 200, 100)).toEqual([30, 10]);
    }
    expect(toSource(0, 0, 90, 200, 100)).toEqual([0, 100]); // output top-left is the source's bottom-left
  });
  it('place moves a static layer or keys an animated one', () => {
    const l = layer([{ t: 0, x: 5 }]);
    expect(place(l, 3, { x: 9 }, false).keys).toHaveLength(1);
    expect(place(l, 3, { x: 9 }, true).keys.map((k) => k.t)).toEqual([0, 3]);
  });
});

describe('masks', () => {
  it('reads and writes a blur area through the same mask view', () => {
    const b = newLayer('blur', { start: 0, end: 5, x: 50, y: 50, w: 20, h: 20 });
    expect(maskOf(b)).toMatchObject({ shape: 'ellipse', invert: false });
    const r = withMask(b, { shape: 'none', invert: true });
    expect(r.blur).toMatchObject({ shape: 'rect', invert: true }); // a blur always has an area
    const p = withMask(b, { shape: 'path' });
    expect(maskOf(p).points!.length).toBe(12); // starts as an ellipse-like outline
  });

  it('gives image overlays no mask until one is set, and drops it again', () => {
    const l = layer([{ t: 0 }]);
    expect(maskOf(l).shape).toBe('none');
    const m = withMask(l, { shape: 'ellipse', feather: 0.2 });
    expect(m.mask).toEqual({ shape: 'ellipse', feather: 0.2, invert: false });
    expect(withMask(m, { shape: 'none' }).mask).toBeUndefined();
  });

  it('simplifies a drawn outline but keeps its corners', () => {
    const sq: [number, number][] = [];
    for (let i = 0; i < 40; i++) sq.push([-0.5 + i / 40, -0.5]);
    for (let i = 0; i < 40; i++) sq.push([0.5, -0.5 + i / 40]);
    for (let i = 0; i < 40; i++) sq.push([0.5 - i / 40, 0.5]);
    for (let i = 0; i < 40; i++) sq.push([-0.5, 0.5 - i / 40]);
    const s = simplify(sq, 0.01);
    expect(s).toHaveLength(4);
    expect(s).toEqual(expect.arrayContaining([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]));
    const circle = Array.from({ length: 500 }, (_, i) => [Math.cos(i / 80), Math.sin(i / 80)] as [number, number]);
    expect(simplify(circle, 0.0001, 64).length).toBeLessThanOrEqual(64);
  });

  it('turns an outline drawn over the picture into the layer box', () => {
    // A 40×20 rectangle centred at (130, 60); the layer sits at (100, 50), unrotated, scale 2.
    const r = outlineToBox([[110, 50], [150, 50], [150, 70], [110, 70]], { x: 100, y: 50, scale: 2, rotation: 0 })!;
    expect([r.w, r.h]).toEqual([20, 10]); // box size at scale 1
    expect(r.shift).toEqual([30, 10]);
    expect(r.points).toEqual([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
    // Rotated 90°: screen x runs along the box's -y.
    const q = outlineToBox([[90, 40], [110, 40], [110, 80], [90, 80]], { x: 100, y: 60, scale: 1, rotation: 90 })!;
    expect([q.w, q.h]).toEqual([40, 20]);
    expect(q.shift.map((v) => Math.round(v))).toEqual([0, 0]);
    expect(outlineToBox([[0, 0], [1, 1]], { x: 0, y: 0, scale: 1, rotation: 0 })).toBeNull();
  });
});
