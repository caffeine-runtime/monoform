// Levels and Curves: per-channel tone maps, combined into one 256-entry
// lookup table per channel that the adjustment shader samples. Curves pass
// smoothly through their points without overshooting (monotone cubic,
// Fritsch–Carlson), as in Photoshop. Pure functions, unit-tested.

/** A curve point (input, output), both 0..1. */
export type CurvePoint = [number, number];

export interface Levels {
  inBlack: number; // 0..1: this input and below become outBlack
  inWhite: number; // 0..1: this input and above become outWhite
  gamma: number; // midtones, 0.1..10 (>1 brightens)
  outBlack: number;
  outWhite: number;
}

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
export type Curves = Record<CurveChannel, CurvePoint[]>;

export const LEVELS_NEUTRAL: Levels = { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 };
export const CURVE_NEUTRAL: CurvePoint[] = [
  [0, 0],
  [1, 1],
];
export const CURVES_NEUTRAL: Curves = { rgb: CURVE_NEUTRAL, r: CURVE_NEUTRAL, g: CURVE_NEUTRAL, b: CURVE_NEUTRAL };

export function levelsNeutral(l: Levels): boolean {
  return l.inBlack === 0 && l.inWhite === 1 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 1;
}

export function curveNeutral(p: CurvePoint[]): boolean {
  return p.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

export function curvesNeutral(c: Curves): boolean {
  return curveNeutral(c.rgb) && curveNeutral(c.r) && curveNeutral(c.g) && curveNeutral(c.b);
}

export function levelsFn(l: Levels): (x: number) => number {
  const span = Math.max(1e-4, l.inWhite - l.inBlack);
  const g = 1 / Math.max(0.01, l.gamma);
  return (x) => {
    const t = Math.min(1, Math.max(0, (x - l.inBlack) / span));
    return l.outBlack + (l.outWhite - l.outBlack) * Math.pow(t, g);
  };
}

/** A smooth curve through the points (sorted by input); flat before the first and after the last. */
export function curveFn(points: CurvePoint[]): (x: number) => number {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => p[0][1];
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  // Secant slopes, then tangents limited so the curve never overshoots between points.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** RGBA 256×1: entry v of channel k is where input v/255 goes (levels, then the RGB curve, then the channel's). */
export function toneLut(levels: Levels, curves: Curves): Uint8Array {
  const lv = levelsFn(levels);
  const all = curveFn(curves.rgb);
  const ch = [curveFn(curves.r), curveFn(curves.g), curveFn(curves.b)];
  const lut = new Uint8Array(256 * 4);
  for (let v = 0; v < 256; v++) {
    const base = all(lv(v / 255));
    for (let k = 0; k < 3; k++) lut[v * 4 + k] = Math.round(Math.min(1, Math.max(0, ch[k](Math.min(1, Math.max(0, base))))) * 255);
    lut[v * 4 + 3] = 255;
  }
  return lut;
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array; // luminance
}

/** Counts per level of RGBA pixels (transparent ones skipped). */
export function histogram(px: Uint8ClampedArray): Histogram {
  const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    h.r[px[i]]++;
    h.g[px[i + 1]]++;
    h.b[px[i + 2]]++;
    h.l[Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
  }
  return h;
}

/** Auto levels: black and white points where 0.1 % of the pixels are clipped at each end. */
export function autoLevels(hist: Uint32Array): { inBlack: number; inWhite: number } {
  let total = 0;
  for (const v of hist) total += v;
  if (!total) return { inBlack: 0, inWhite: 1 };
  const clip = total * 0.001;
  let lo = 0;
  for (let acc = 0; lo < 255 && acc + hist[lo] <= clip; lo++) acc += hist[lo];
  let hi = 255;
  for (let acc = 0; hi > 0 && acc + hist[hi] <= clip; hi--) acc += hist[hi];
  if (hi <= lo) return { inBlack: 0, inWhite: 1 };
  return { inBlack: lo / 255, inWhite: hi / 255 };
}
