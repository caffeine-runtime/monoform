// Image analysis off the main thread: magic-wand flood fill, background
// removal (U²-Netp) and click-to-select objects (SlimSAM). Model masks are
// snapped to the image's real edges (refine.ts). Masks come back as
// ImageBitmaps (white, alpha = selection) plus an edge outline, so the main
// thread only draws bitmaps. Models are bundled assets loaded on first use.
import * as ort from 'onnxruntime-web/wasm';
import { initOrtWasm } from '../../../core/ortwasm';
import { fetchBytes } from '../../../core/fetchbytes';
import { refineMask, sample } from './refine';
import u2netpUrl from '../models/u2netp.onnx?url';
import samEncUrl from '../models/slimsam-77-vision_encoder_quantized.onnx?url';
import samDecUrl from '../models/slimsam-77-prompt_encoder_mask_decoder_quantized.onnx?url';

export interface MaskResult {
  mask: ImageBitmap;
  edges: ImageBitmap;
  edgeScale: number;
  bounds: { x: number; y: number; width: number; height: number };
  millis: number;
}

export type VisionIn =
  | { id: number; type: 'wand'; image: ImageBitmap; x: number; y: number; tolerance: number; contiguous: boolean }
  | { id: number; type: 'removeBg'; image: ImageBitmap }
  | { id: number; type: 'samEncode'; image: ImageBitmap; key: string }
  | { id: number; type: 'samDecode'; key: string; points: { x: number; y: number; positive: boolean }[] }
  | { id: number; type: 'edges'; image: ImageBitmap };

export type VisionOut = { id: number; ok: true; result: MaskResult | { millis: number } } | { id: number; ok: false; error: string };

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function pixels(img: ImageBitmap, w = img.width, h = img.height): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/** alpha (0..255 per pixel) → white RGBA bitmap, edge bitmap and bounds. */
function finish(alpha: Uint8ClampedArray, w: number, h: number, t0: number): MaskResult {
  const rgba = new Uint8ClampedArray(w * h * 4);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const a = alpha[i];
      if (!a) continue;
      const j = i * 4;
      rgba[j] = rgba[j + 1] = rgba[j + 2] = 255;
      rgba[j + 3] = a;
      if (a > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const mc = new OffscreenCanvas(w, h);
  mc.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
  const { edges, scale } = edgeBitmap(alpha, w, h);
  const bounds = x1 < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  return { mask: mc.transferToImageBitmap(), edges, edgeScale: scale, bounds, millis: Math.round(performance.now() - t0) };
}

/** Outline of a mask, at most 2048 px on the long side. */
function edgeBitmap(alpha: Uint8ClampedArray, w: number, h: number): { edges: ImageBitmap; scale: number } {
  const scale = Math.min(1, 2048 / Math.max(w, h));
  const ew = Math.max(1, Math.round(w * scale));
  const eh = Math.max(1, Math.round(h * scale));
  const sel = (x: number, y: number) => {
    const sx = Math.min(w - 1, Math.floor(x / scale));
    const sy = Math.min(h - 1, Math.floor(y / scale));
    return alpha[sy * w + sx] > 127;
  };
  const out = new Uint8ClampedArray(ew * eh * 4);
  for (let y = 0; y < eh; y++) {
    for (let x = 0; x < ew; x++) {
      if (!sel(x, y)) continue;
      if (x === 0 || y === 0 || x === ew - 1 || y === eh - 1 || !sel(x - 1, y) || !sel(x + 1, y) || !sel(x, y - 1) || !sel(x, y + 1)) {
        const j = (y * ew + x) * 4;
        out[j] = out[j + 1] = out[j + 2] = 255;
        out[j + 3] = 255;
      }
    }
  }
  const c = new OffscreenCanvas(ew, eh);
  c.getContext('2d')!.putImageData(new ImageData(out, ew, eh), 0, 0);
  return { edges: c.transferToImageBitmap(), scale };
}

// ---- magic wand ----

function wand(img: ImageBitmap, sx: number, sy: number, tol: number, contiguous: boolean): MaskResult {
  const t0 = performance.now();
  const w = img.width;
  const h = img.height;
  const px = pixels(img);
  const alpha = new Uint8ClampedArray(w * h);
  const s = (Math.max(0, Math.min(h - 1, Math.round(sy))) * w + Math.max(0, Math.min(w - 1, Math.round(sx)))) * 4;
  const r0 = px[s], g0 = px[s + 1], b0 = px[s + 2], a0 = px[s + 3];
  const near = (i: number) => {
    const j = i * 4;
    return Math.abs(px[j] - r0) <= tol && Math.abs(px[j + 1] - g0) <= tol && Math.abs(px[j + 2] - b0) <= tol && Math.abs(px[j + 3] - a0) <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (near(i)) alpha[i] = 255;
  } else {
    // Scanline flood fill.
    const stack: number[] = [s / 4];
    while (stack.length) {
      const i = stack.pop()!;
      const y = (i / w) | 0;
      let x = i - y * w;
      while (x > 0 && !alpha[y * w + x - 1] && near(y * w + x - 1)) x--;
      let up = false;
      let down = false;
      for (; x < w; x++) {
        const k = y * w + x;
        if (alpha[k] || !near(k)) break;
        alpha[k] = 255;
        if (y > 0) {
          const u = k - w;
          if (!alpha[u] && near(u)) {
            if (!up) stack.push(u);
            up = true;
          } else up = false;
        }
        if (y < h - 1) {
          const d = k + w;
          if (!alpha[d] && near(d)) {
            if (!down) stack.push(d);
            down = true;
          } else down = false;
        }
      }
    }
  }
  img.close();
  return finish(alpha, w, h, t0);
}

// ---- models ----

const sessions = new Map<string, Promise<ort.InferenceSession>>();
function session(url: string): Promise<ort.InferenceSession> {
  let s = sessions.get(url);
  if (!s) {
    s = initOrtWasm(ort)
      .then(() => fetchBytes(new URL(url, location.href).href))
      .then((b) => ort.InferenceSession.create(b, { graphOptimizationLevel: 'all', executionProviders: ['wasm'] }));
    sessions.set(url, s);
    s.catch(() => sessions.delete(url));
  }
  return s;
}

/** Image → normalized CHW tensor of size×size; the image keeps its aspect ratio, padded bottom/right. */
function tensorFor(img: ImageBitmap, size: number): { tensor: ort.Tensor; scale: number } {
  const scale = size / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const px = pixels(img, w, h);
  const data = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const k = y * size + x;
      for (let c = 0; c < 3; c++) data[c * plane + k] = (px[j + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return { tensor: new ort.Tensor('float32', data, [1, 3, size, size]), scale };
}

async function removeBg(img: ImageBitmap): Promise<MaskResult> {
  const t0 = performance.now();
  const S = 320;
  const s = await session(u2netpUrl);
  const { tensor, scale } = tensorFor(img, S);
  const out = await s.run({ [s.inputNames[0]]: tensor });
  const pred = out[s.outputNames[0]].data as Float32Array;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of pred) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const W = img.width;
  const H = img.height;
  const work = workPixels(img);
  const k = scale / work.s; // working px → model px
  const prior = new Float32Array(work.w * work.h);
  for (let y = 0; y < work.h; y++) {
    for (let x = 0; x < work.w; x++) prior[y * work.w + x] = (sample(pred, S, S, (x + 0.5) * k - 0.5, (y + 0.5) * k - 0.5) - lo) / (hi - lo || 1);
  }
  // One model pixel is 1/k working pixels; the true edge is within ~2 of them.
  const alpha = refined(work, prior, 2 / k, W, H);
  img.close();
  return finish(alpha, W, H, t0);
}

/** Refinement runs at most this large (long side); bigger images get the result upscaled. */
const WORK = 2048;

interface Work {
  px: Uint8ClampedArray;
  w: number;
  h: number;
  s: number; // working px per image px
}

function workPixels(img: ImageBitmap): Work {
  const s = Math.min(1, WORK / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  return { px: pixels(img, w, h), w, h, s };
}

/** Snap prior (working resolution) to the image's edges; alpha 0..255 at W×H. */
function refined(work: Work, prior: Float32Array, band: number, W: number, H: number): Uint8ClampedArray {
  const a = refineMask(work.px, work.w, work.h, prior, Math.max(2, band));
  const alpha = new Uint8ClampedArray(W * H);
  if (work.w === W && work.h === H) {
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(a[i] * 255);
    return alpha;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) alpha[y * W + x] = Math.round(sample(a, work.w, work.h, (x + 0.5) * work.s - 0.5, (y + 0.5) * work.s - 0.5) * 255);
  }
  return alpha;
}

const samCache = new Map<string, { emb: ort.Tensor; pos: ort.Tensor; scale: number; w: number; h: number; work: Work }>();

async function samEncode(img: ImageBitmap, key: string): Promise<{ millis: number }> {
  const t0 = performance.now();
  const enc = await session(samEncUrl);
  const { tensor, scale } = tensorFor(img, 1024);
  const out = await enc.run({ pixel_values: tensor });
  samCache.clear(); // one image at a time keeps memory bounded
  samCache.set(key, { emb: out.image_embeddings, pos: out.image_positional_embeddings, scale, w: img.width, h: img.height, work: workPixels(img) });
  img.close();
  return { millis: Math.round(performance.now() - t0) };
}

async function samDecode(key: string, points: { x: number; y: number; positive: boolean }[]): Promise<MaskResult> {
  const t0 = performance.now();
  const c = samCache.get(key);
  if (!c) throw new Error('image not analysed');
  const dec = await session(samDecUrl);
  const pts = new Float32Array(points.length * 2);
  const labels = new BigInt64Array(points.length);
  points.forEach((p, i) => {
    pts[i * 2] = p.x * c.scale;
    pts[i * 2 + 1] = p.y * c.scale;
    labels[i] = p.positive ? 1n : 0n;
  });
  const out = await dec.run({
    image_embeddings: c.emb,
    image_positional_embeddings: c.pos,
    input_points: new ort.Tensor('float32', pts, [1, 1, points.length, 2]),
    input_labels: new ort.Tensor('int64', labels, [1, 1, points.length]),
  });
  const iou = out.iou_scores.data as Float32Array;
  let best = 0;
  for (let i = 1; i < iou.length; i++) if (iou[i] > iou[best]) best = i;
  const masks = out.pred_masks.data as Float32Array; // [1,1,3,256,256] logits over the padded 1024² input
  const M = 256;
  const plane = masks.subarray(best * M * M, (best + 1) * M * M);
  const { work } = c;
  const k = (c.scale * M) / 1024 / work.s; // working px → mask px
  const prior = new Float32Array(work.w * work.h);
  for (let y = 0; y < work.h; y++) {
    for (let x = 0; x < work.w; x++) {
      const v = sample(plane, M, M, (x + 0.5) * k - 0.5, (y + 0.5) * k - 0.5);
      prior[y * work.w + x] = 1 / (1 + Math.exp(-v));
    }
  }
  // One mask pixel is 1/k working pixels; the true edge is within ~1.5 of them.
  const alpha = refined(work, prior, 1.5 / k, c.w, c.h);
  return finish(alpha, c.w, c.h, t0);
}

function edgesOnly(img: ImageBitmap): MaskResult {
  const t0 = performance.now();
  const px = pixels(img);
  const alpha = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  const w = img.width;
  const h = img.height;
  img.close();
  return finish(alpha, w, h, t0);
}

self.onmessage = async (e: MessageEvent<VisionIn>) => {
  const m = e.data;
  try {
    let result: MaskResult | { millis: number };
    if (m.type === 'wand') result = wand(m.image, m.x, m.y, m.tolerance, m.contiguous);
    else if (m.type === 'removeBg') result = await removeBg(m.image);
    else if (m.type === 'samEncode') result = await samEncode(m.image, m.key);
    else if (m.type === 'samDecode') result = await samDecode(m.key, m.points);
    else result = edgesOnly(m.image);
    const transfer = 'mask' in result ? [result.mask, result.edges] : [];
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, result } satisfies VisionOut, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies VisionOut);
  }
};
