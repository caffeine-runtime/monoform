// Destructive edits on the base raster. Each returns a new canvas so the old
// one can stay in the undo history.
import type { Rect } from './geometry';
import { t } from '../../core/i18n';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: false })!;
}

export function fromImage(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

export function clone(src: HTMLCanvasElement): HTMLCanvasElement {
  return fromImage(src, src.width, src.height);
}

export function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = makeCanvas(r.width, r.height);
  ctx2d(c).drawImage(src, -r.x, -r.y);
  return c;
}

export function rotate(src: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const c = makeCanvas(src.height, src.width);
  const g = ctx2d(c);
  g.translate(clockwise ? c.width : 0, clockwise ? 0 : c.height);
  g.rotate(((clockwise ? 90 : -90) * Math.PI) / 180);
  g.drawImage(src, 0, 0);
  return c;
}

export function flip(src: HTMLCanvasElement, horizontal: boolean): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = ctx2d(c);
  if (horizontal) {
    g.translate(c.width, 0);
    g.scale(-1, 1);
  } else {
    g.translate(0, c.height);
    g.scale(1, -1);
  }
  g.drawImage(src, 0, 0);
  return c;
}

/** High-quality resize; large reductions go in halving steps to avoid aliasing. */
export function resize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = makeCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const g = ctx2d(half);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = makeCanvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return out;
}

/**
 * Blur a region irreversibly: scale it down hard and back up with smoothing,
 * twice. Works without ctx.filter (not available in every webview).
 */
export function blurRegion(src: HTMLCanvasElement, r: Rect, strength = 1): HTMLCanvasElement {
  const out = clone(src);
  if (r.width < 2 || r.height < 2) return out;
  const g = ctx2d(out);
  const factor = Math.max(4, Math.round((Math.min(r.width, r.height) / 6) * strength));
  let region = crop(src, r);
  for (let pass = 0; pass < 2; pass++) {
    const small = makeCanvas(Math.max(1, r.width / factor), Math.max(1, r.height / factor));
    const sg = ctx2d(small);
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(region, 0, 0, small.width, small.height);
    const back = makeCanvas(r.width, r.height);
    const bg = ctx2d(back);
    bg.imageSmoothingEnabled = true;
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(small, 0, 0, r.width, r.height);
    region = back;
  }
  g.clearRect(r.x, r.y, r.width, r.height);
  g.drawImage(region, r.x, r.y);
  return out;
}

/** Pixelate a region with square blocks. */
export function pixelateRegion(src: HTMLCanvasElement, r: Rect, block?: number): HTMLCanvasElement {
  const out = clone(src);
  if (r.width < 2 || r.height < 2) return out;
  const size = block ?? Math.max(6, Math.round(Math.max(src.width, src.height) / 80));
  const small = makeCanvas(Math.ceil(r.width / size), Math.ceil(r.height / size));
  const sg = ctx2d(small);
  sg.imageSmoothingQuality = 'medium';
  sg.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, small.width, small.height);
  const g = ctx2d(out);
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.width, r.height);
  g.clip();
  g.imageSmoothingEnabled = false;
  g.clearRect(r.x, r.y, r.width, r.height);
  g.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, small.width * size, small.height * size);
  g.restore();
  return out;
}

export function toPNG(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(t('could not encode image')))), 'image/png'));
}

/** Rotation size: the bounding box of a w×h image rotated by degrees. */
export function rotatedSize(w: number, h: number, degrees: number): { w: number; h: number } {
  const r = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: Math.round(w * c + h * s), h: Math.round(w * s + h * c) };
}

/** Rotate by any angle around the centre; expand grows the canvas (corners transparent), otherwise the size stays. */
export function rotateAny(src: HTMLCanvasElement, degrees: number, expand = true): HTMLCanvasElement {
  const size = expand ? rotatedSize(src.width, src.height, degrees) : { w: src.width, h: src.height };
  const c = makeCanvas(size.w, size.h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.rotate((degrees * Math.PI) / 180);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
