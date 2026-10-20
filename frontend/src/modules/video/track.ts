// Object tracking for pinning overlays: template matching by normalized
// cross-correlation (NCC) in a search window around the predicted position
// (previous position + velocity), with sub-pixel refinement
// and a slowly updated template so gradual changes in appearance are
// followed. Works on small grayscale frames; pure and unit-tested.

export interface Gray {
  w: number;
  h: number;
  data: Float32Array; // 0..1
}

export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return { w, h, data };
}

export interface TrackPoint {
  x: number; // centre of the tracked box, frame pixels
  y: number;
  score: number; // NCC 0..1
}

export class Tracker {
  private tpl: Float32Array;
  private tw: number;
  private th: number;
  private x: number;
  private y: number;
  private vx = 0;
  private vy = 0;

  /** box: centre and size in frame pixels. */
  constructor(
    first: Gray,
    box: { x: number; y: number; w: number; h: number },
    private search = 24,
    private minScore = 0.45,
  ) {
    this.tw = Math.max(8, Math.round(box.w)) | 0;
    this.th = Math.max(8, Math.round(box.h)) | 0;
    this.x = box.x;
    this.y = box.y;
    this.tpl = this.patch(first, Math.round(box.x - this.tw / 2), Math.round(box.y - this.th / 2));
  }

  private patch(f: Gray, x0: number, y0: number): Float32Array {
    const p = new Float32Array(this.tw * this.th);
    for (let y = 0; y < this.th; y++) {
      const sy = Math.min(f.h - 1, Math.max(0, y0 + y));
      for (let x = 0; x < this.tw; x++) p[y * this.tw + x] = f.data[sy * f.w + Math.min(f.w - 1, Math.max(0, x0 + x))];
    }
    return p;
  }

  /** NCC of the template with the frame patch whose top-left is (x0, y0). */
  private ncc(f: Gray, x0: number, y0: number): number {
    const { tw, th, tpl } = this;
    let st = 0, si = 0, stt = 0, sii = 0, sti = 0;
    for (let y = 0; y < th; y++) {
      const row = (y0 + y) * f.w + x0;
      for (let x = 0; x < tw; x++) {
        const t = tpl[y * tw + x];
        const i = f.data[row + x];
        st += t;
        si += i;
        stt += t * t;
        sii += i * i;
        sti += t * i;
      }
    }
    const n = tw * th;
    const cov = sti - (st * si) / n;
    const vt = stt - (st * st) / n;
    const vi = sii - (si * si) / n;
    return vt > 1e-9 && vi > 1e-9 ? cov / Math.sqrt(vt * vi) : 0;
  }

  /** Find the object in the next frame; null when it is lost. */
  next(f: Gray): TrackPoint | null {
    const { tw, th } = this;
    const px = this.x + this.vx;
    const py = this.y + this.vy;
    const cx0 = Math.round(px - tw / 2);
    const cy0 = Math.round(py - th / 2);
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x + tw <= f.w && y + th <= f.h;
    let best = -2;
    let bx = cx0;
    let by = cy0;
    // Along a plain edge many positions match equally well (the aperture
    // problem); a small penalty for distance from the prediction keeps the
    // track from sliding along it.
    const R2 = this.search * this.search;
    const tryAt = (x: number, y: number) => {
      if (!inside(x, y)) return;
      const s = this.ncc(f, x, y) - (0.02 * ((x - cx0) ** 2 + (y - cy0) ** 2)) / R2;
      if (s > best) {
        best = s;
        bx = x;
        by = y;
      }
    };
    // Exhaustive search: frames are small (≤ 320 px), and fine textures have peaks a single pixel wide.
    const R = this.search;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) tryAt(cx0 + dx, cy0 + dy);
    best = this.ncc(f, bx, by);
    if (best < this.minScore) return null;
    // Sub-pixel: parabola through the neighbours' scores.
    const sub = (a: number, b: number, c: number) => {
      const d = a - 2 * b + c;
      return Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0;
    };
    const s0 = best;
    const sx = inside(bx - 1, by) && inside(bx + 1, by) ? sub(this.ncc(f, bx - 1, by), s0, this.ncc(f, bx + 1, by)) : 0;
    const sy = inside(bx, by - 1) && inside(bx, by + 1) ? sub(this.ncc(f, bx, by - 1), s0, this.ncc(f, bx, by + 1)) : 0;
    const nx = bx + sx + tw / 2;
    const ny = by + sy + th / 2;
    this.vx = 0.6 * (nx - this.x) + 0.4 * this.vx;
    this.vy = 0.6 * (ny - this.y) + 0.4 * this.vy;
    this.x = nx;
    this.y = ny;
    if (best > 0.8) {
      // Follow slow changes in appearance.
      const cur = this.patch(f, bx, by);
      for (let i = 0; i < cur.length; i++) this.tpl[i] = 0.9 * this.tpl[i] + 0.1 * cur[i];
    }
    return { x: nx, y: ny, score: best };
  }
}
