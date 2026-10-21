// Object removal helpers (pure, unit-tested): where to crop around the
// selection, and how to grow and soften the mask. The fill model works on a
// 512×512 square, so it sees the selection with some surroundings (to know
// what to paint) and the result is pasted back through a soft edge.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ERASE_SIZE = 512;

/**
 * The part of a W×H picture to repaint for a selection with bounds b: a
 * square about 1.8× the selection (at least 512 px, or the whole picture if
 * smaller), centred on it and kept inside the picture.
 */
export function eraseRect(b: Rect, W: number, H: number): Rect {
  const side = Math.max(Math.max(b.width, b.height) * 1.8 + 48, ERASE_SIZE);
  let w = Math.min(W, Math.max(side, b.width + 32));
  let h = Math.min(H, Math.max(side, b.height + 32));
  w = Math.round(w);
  h = Math.round(h);
  const x = Math.max(0, Math.min(W - w, Math.round(b.x + b.width / 2 - w / 2)));
  const y = Math.max(0, Math.min(H - h, Math.round(b.y + b.height / 2 - h / 2)));
  return { x, y, width: w, height: h };
}

/** Grow a mask (0..255 per pixel, w×h) by r pixels (square max filter, two passes). */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && v < 255; k++) v = Math.max(v, m[y * w + k]);
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && v < 255; k++) v = Math.max(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Soften a mask's edge (box blur of radius r, twice). */
export function feather(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = m;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Uint8Array(cur.length);
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, n++) s += cur[y * w + k];
        tmp[y * w + x] = Math.round(s / n);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, n++) s += tmp[k * w + x];
        out[y * w + x] = Math.round(s / n);
      }
    }
    cur = out;
  }
  return cur;
}
