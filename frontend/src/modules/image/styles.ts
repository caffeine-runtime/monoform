// Layer styles: a drop shadow, an outside stroke and an outer glow, drawn
// beneath a layer from the shape of its pixels (their alpha), as in
// Photoshop's Layer Style. The effects are one picture per layer, worked out
// here from the layer's content (in the vision worker while editing, here on
// the main thread when a picture is needed at once). Pure functions.
import { blur, signedDistance } from './vision/selmodify';

export interface DropShadow {
  color: string;
  opacity: number; // 0..1
  /** Where the light comes from, in degrees (0 = from the right, 90 = from above); the shadow falls the other way. */
  angle: number;
  distance: number; // px
  size: number; // px of softness
}

export interface Stroke {
  color: string;
  opacity: number;
  size: number; // px, outside the shape
}

export interface Glow {
  color: string;
  opacity: number;
  size: number; // px it reaches out
}

export interface LayerStyle {
  shadow?: DropShadow | null;
  stroke?: Stroke | null;
  glow?: Glow | null;
}

export const SHADOW_DEFAULT: DropShadow = { color: '#000000', opacity: 0.6, angle: 120, distance: 8, size: 10 };
export const STROKE_DEFAULT: Stroke = { color: '#000000', opacity: 1, size: 3 };
export const GLOW_DEFAULT: Glow = { color: '#ffd84d', opacity: 0.75, size: 16 };

export function styleEmpty(s: LayerStyle | null | undefined): boolean {
  return !s || (!s.shadow && !s.stroke && !s.glow);
}

/** The shadow's offset: away from the light. */
export function shadowOffset(s: DropShadow): { dx: number; dy: number } {
  const a = (s.angle * Math.PI) / 180;
  return { dx: -Math.cos(a) * s.distance, dy: Math.sin(a) * s.distance };
}

/** How far beyond the content the effects can reach. */
export function stylePad(s: LayerStyle): number {
  let p = 0;
  if (s.shadow) p = Math.max(p, s.shadow.distance + s.shadow.size * 1.5 + 2);
  if (s.stroke) p = Math.max(p, s.stroke.size + 2);
  if (s.glow) p = Math.max(p, s.glow.size + 2);
  return Math.ceil(p);
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface StyleRender {
  /** RGBA, w × h, placed at (x, y) in the layer's pixels (may start outside them). */
  rgba: Uint8ClampedArray;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The effects beneath a layer whose alpha is given (w × h, 0..255): the
 * shadow, the glow over it, the stroke over both. Null when the layer is
 * empty or the style has nothing on.
 */
export function renderStyle(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, s: LayerStyle): StyleRender | null {
  if (styleEmpty(s)) return null;
  // What the layer covers.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = stylePad(s);
  const ox = x0 - pad;
  const oy = y0 - pad;
  const W = x1 - x0 + 1 + 2 * pad;
  const H = y1 - y0 + 1 + 2 * pad;
  const a = new Float32Array(W * H);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[(y - oy) * W + x - ox] = alpha[y * w + x] / 255;

  // Straight-alpha colour layers, drawn bottom first.
  const out = new Float32Array(W * H * 4); // r, g, b in 0..255, a in 0..1
  const over = (cover: Float32Array, color: string, opacity: number) => {
    const [r, g, b] = rgb(color);
    for (let i = 0; i < cover.length; i++) {
      const sa = cover[i] * opacity;
      if (sa <= 0) continue;
      const k = i * 4;
      const da = out[k + 3];
      const oa = sa + da * (1 - sa);
      const f = da * (1 - sa);
      out[k] = (r * sa + out[k] * f) / oa;
      out[k + 1] = (g * sa + out[k + 1] * f) / oa;
      out[k + 2] = (b * sa + out[k + 2] * f) / oa;
      out[k + 3] = oa;
    }
  };

  if (s.shadow) {
    const soft = blur(a, W, H, s.shadow.size / 2);
    const { dx, dy } = shadowOffset(s.shadow);
    const sx = Math.round(dx);
    const sy = Math.round(dy);
    const moved = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const fy = y - sy;
      if (fy < 0 || fy >= H) continue;
      for (let x = 0; x < W; x++) {
        const fx = x - sx;
        if (fx >= 0 && fx < W) moved[y * W + x] = soft[fy * W + fx];
      }
    }
    over(moved, s.shadow.color, s.shadow.opacity);
  }
  const sd =
    s.glow || s.stroke
      ? signedDistance(
          a.map((v) => (v >= 0.5 ? 1 : 0)),
          W,
          H,
        )
      : null;
  if (s.glow && sd) {
    const size = Math.max(1, s.glow.size);
    const g = new Float32Array(W * H);
    for (let i = 0; i < g.length; i++) {
      const f = 1 - clamp01(sd[i] / size);
      g[i] = f * f;
    }
    over(g, s.glow.color, s.glow.opacity);
  }
  if (s.stroke && sd) {
    const st = new Float32Array(W * H);
    // Outside the shape up to its size, and under its soft edge (not inside it).
    for (let i = 0; i < st.length; i++) st[i] = clamp01(0.5 + s.stroke.size - sd[i]) * clamp01(sd[i] + 1.5);
    over(st, s.stroke.color, s.stroke.opacity);
  }

  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    rgba[k] = out[k];
    rgba[k + 1] = out[k + 1];
    rgba[k + 2] = out[k + 2];
    rgba[k + 3] = Math.round(out[k + 3] * 255);
  }
  return { rgba, x: ox, y: oy, w: W, h: H };
}

/** A style read back from a file (anything odd in it dropped or brought into range). */
export function parseStyle(json: string | undefined): LayerStyle | null {
  if (!json) return null;
  let v: Record<string, Record<string, unknown> | null | undefined>;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const col = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : d);
  const out: LayerStyle = {};
  const sh = v.shadow;
  if (sh && typeof sh === 'object')
    out.shadow = {
      color: col(sh.color, SHADOW_DEFAULT.color),
      opacity: num(sh.opacity, SHADOW_DEFAULT.opacity, 0, 1),
      angle: num(sh.angle, SHADOW_DEFAULT.angle, -360, 360),
      distance: num(sh.distance, SHADOW_DEFAULT.distance, 0, 500),
      size: num(sh.size, SHADOW_DEFAULT.size, 0, 250),
    };
  const st = v.stroke;
  if (st && typeof st === 'object') out.stroke = { color: col(st.color, STROKE_DEFAULT.color), opacity: num(st.opacity, 1, 0, 1), size: num(st.size, STROKE_DEFAULT.size, 1, 250) };
  const gl = v.glow;
  if (gl && typeof gl === 'object') out.glow = { color: col(gl.color, GLOW_DEFAULT.color), opacity: num(gl.opacity, GLOW_DEFAULT.opacity, 0, 1), size: num(gl.size, GLOW_DEFAULT.size, 1, 250) };
  return styleEmpty(out) ? null : out;
}
