// Image analysis off the main thread: magic-wand flood fill, background
// removal (U²-Netp) and click-to-select objects (SlimSAM). Model masks are
// snapped to the image's real edges (refine.ts). Masks come back as
// ImageBitmaps (white, alpha = selection) plus an edge outline, so the main
// thread only draws bitmaps. Models are bundled assets loaded on first use.
// With the optional models installed, the subject comes from BiRefNet and
// object removal from Moebius, both run natively by the Go side: this worker
// only prepares the pixels and puts the answers together.
import * as ort from 'onnxruntime-web/wasm';
import { initOrtWasm } from '../../../core/ortwasm';
import { fetchBytes } from '../../../core/fetchbytes';
import { measure, pickMask } from './pick';
import { refineMask, sample } from './refine';
import { dilate, ERASE_SIZE, feather, type Rect } from './erase';
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
  | { id: number; type: 'edges'; image: ImageBitmap }
  | { id: number; type: 'aiSubject'; image: ImageBitmap; base: string }
  | { id: number; type: 'eraseBegin'; image: ImageBitmap; mask: ImageBitmap; rect: Rect; base: string; seed: number }
  | { id: number; type: 'eraseFinish'; started: EraseStarted; base: string };

/** A removal under way: the backend job, and what finishing it needs (kept by the caller: the worker may stop meanwhile). */
export interface EraseStarted {
  job: string;
  rect: Rect;
  blend: Uint8Array;
}
export interface ErasePatch {
  patch: ImageBitmap;
  rect: Rect;
}

export type VisionOut = { id: number; ok: true; result: MaskResult | { millis: number } | EraseStarted | ErasePatch } | { id: number; ok: false; error: string };

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
  const masks = out.pred_masks.data as Float32Array; // [1,1,3,256,256] logits over the padded 1024² input
  const M = 256;
  // The image covers the top-left of the padded square.
  const vw = Math.max(1, Math.round((c.w * c.scale * M) / 1024));
  const vh = Math.max(1, Math.round((c.h * c.scale * M) / 1024));
  const cands = Array.from(iou, (score, i) => ({ score, ...measure(masks.subarray(i * M * M, (i + 1) * M * M), M, vw, vh) }));
  const best = pickMask(cands, points.some((p) => !p.positive));
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

// ---- optional native models (Go side) ----

// Pieces of at most 256 KB: the app's own requests are handled on the UI
// thread, where a 3 MB body costs a ~80 ms frame.
const PIECE = 256 << 10;

/** An /__mf/ai/… URL from the token-bearing base the page sent. */
function aiUrl(base: string, path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(base, self.location.href);
  u.pathname = `/__mf/ai/${path}`;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Send a model input in pieces; returns its id. */
async function sendInput(base: string, data: Uint8Array): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  for (let off = 0; off < data.length; off += PIECE) {
    const res = await fetch(aiUrl(base, 'input', { id, off, total: data.length }), { method: 'POST', body: data.subarray(off, off + PIECE) as BodyInit });
    if (!res.ok) throw await failure(res);
  }
  return id;
}

async function failure(res: Response): Promise<Error> {
  try {
    return new Error((await res.json()).error ?? res.statusText);
  } catch {
    return new Error(res.statusText || `HTTP ${res.status}`);
  }
}

/** The subject from BiRefNet: the picture goes as 1024² RGB, opacity comes back. */
async function aiSubject(img: ImageBitmap, base: string): Promise<MaskResult> {
  const t0 = performance.now();
  const S = 1024;
  const px = pixels(img, S, S); // stretched to the square, as the model was trained
  const rgb = new Uint8Array(S * S * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i];
    rgb[j + 1] = px[i + 1];
    rgb[j + 2] = px[i + 2];
  }
  const input = await sendInput(base, rgb);
  const res = await fetch(aiUrl(base, 'subject', { input }), { method: 'POST', headers: { 'X-Empty-Body': '1' } });
  if (!res.ok) throw await failure(res);
  const { result } = await res.json();
  const out = await fetchBytes(aiUrl(base, 'result', { id: result }), undefined, PIECE);
  if (out.length !== S * S) throw new Error('unexpected answer from the subject model');
  const pred = new Float32Array(S * S);
  for (let i = 0; i < pred.length; i++) pred[i] = out[i] / 255;
  const W = img.width;
  const H = img.height;
  const work = workPixels(img);
  const kx = S / work.w;
  const ky = S / work.h;
  const prior = new Float32Array(work.w * work.h);
  for (let y = 0; y < work.h; y++) {
    for (let x = 0; x < work.w; x++) prior[y * work.w + x] = sample(pred, S, S, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
  }
  // BiRefNet's edge is good to about a model pixel; snap within that.
  const alpha = refined(work, prior, 1.5 / Math.min(kx, ky), W, H);
  img.close();
  return finish(alpha, W, H, t0);
}

// Object removal: begin sends the 512² crop and mask and returns the job id;
// finish fetches the fill and makes the patch to paste (fill with a soft
// edge, transparent elsewhere).

async function eraseBegin(img: ImageBitmap, maskImg: ImageBitmap, rect: Rect, base: string, seed: number): Promise<EraseStarted> {
  const E = ERASE_SIZE;
  const c = new OffscreenCanvas(E, E);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, E, E);
  const px = g.getImageData(0, 0, E, E).data;
  g.clearRect(0, 0, E, E);
  g.drawImage(maskImg, rect.x, rect.y, rect.width, rect.height, 0, 0, E, E);
  const mp = g.getImageData(0, 0, E, E).data;
  img.close();
  maskImg.close();
  const sel = new Uint8Array(E * E);
  for (let i = 0; i < sel.length; i++) sel[i] = mp[i * 4 + 3] >= 64 ? 255 : 0;
  // A little extra around the selection takes edges, halos and shadows with it.
  const grown = dilate(sel, E, E, 6);
  const body = new Uint8Array(E * E * 4);
  for (let i = 0, j = 0; i < E * E; i++, j += 3) {
    body[j] = px[i * 4];
    body[j + 1] = px[i * 4 + 1];
    body[j + 2] = px[i * 4 + 2];
  }
  body.set(grown, E * E * 3);
  const input = await sendInput(base, body);
  const res = await fetch(aiUrl(base, 'erase', { input, seed }), { method: 'POST', headers: { 'X-Empty-Body': '1' } });
  if (!res.ok) throw await failure(res);
  const { id } = await res.json();
  return { job: id, rect, blend: feather(grown, E, E, 2) };
}

async function eraseFinish(st: EraseStarted, base: string): Promise<ErasePatch> {
  const rgb = await fetchBytes(aiUrl(base, 'result', { id: st.job }), undefined, PIECE);
  const E = ERASE_SIZE;
  if (rgb.length !== E * E * 3) throw new Error('unexpected answer from the removal model');
  const out = new Uint8ClampedArray(E * E * 4);
  for (let i = 0, j = 0; i < E * E; i++, j += 3) {
    out[i * 4] = rgb[j];
    out[i * 4 + 1] = rgb[j + 1];
    out[i * 4 + 2] = rgb[j + 2];
    out[i * 4 + 3] = st.blend[i];
  }
  const small = new OffscreenCanvas(E, E);
  small.getContext('2d')!.putImageData(new ImageData(out, E, E), 0, 0);
  const { rect } = st;
  const big = new OffscreenCanvas(rect.width, rect.height);
  const g = big.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, rect.width, rect.height);
  return { patch: big.transferToImageBitmap(), rect };
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
    let result: MaskResult | { millis: number } | EraseStarted | ErasePatch;
    if (m.type === 'wand') result = wand(m.image, m.x, m.y, m.tolerance, m.contiguous);
    else if (m.type === 'aiSubject') result = await aiSubject(m.image, m.base);
    else if (m.type === 'eraseBegin') result = await eraseBegin(m.image, m.mask, m.rect, m.base, m.seed);
    else if (m.type === 'eraseFinish') result = await eraseFinish(m.started, m.base);
    else if (m.type === 'removeBg') result = await removeBg(m.image);
    else if (m.type === 'samEncode') result = await samEncode(m.image, m.key);
    else if (m.type === 'samDecode') result = await samDecode(m.key, m.points);
    else result = edgesOnly(m.image);
    const transfer = 'mask' in result ? [result.mask, result.edges] : 'patch' in result ? [result.patch] : [];
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, result } satisfies VisionOut, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies VisionOut);
  }
};
