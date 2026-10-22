// Removing a plain background (one colour: a scan, a drawing, a product shot
// on white) without a model: the colour is read from the image's border and
// turned transparent the way GIMP's "Color to Alpha" does it — a pixel that
// is part background becomes part transparent, so anti-aliased lines and
// soft edges keep their shape on any new background. Runs in the vision
// worker; pure functions over RGBA arrays so they can be unit-tested.

export type RGB = [number, number, number];

/** How much a colour differs from the background, 0..1 (the largest channel difference). */
function diff(px: Uint8ClampedArray, i: number, bg: RGB): number {
  return Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) / 255;
}

/**
 * The background colour when the image's border is (nearly) one colour, else
 * null: the median of the border pixels, if at least `share` of them are
 * within `tolerance` of it and opaque.
 */
export function plainBorder(px: Uint8ClampedArray, w: number, h: number, tolerance = 0.11, share = 0.85): RGB | null {
  const idx: number[] = [];
  const step = Math.max(1, Math.floor((w + h) / 2000)); // at most ~4000 samples
  for (let x = 0; x < w; x += step) idx.push(x * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y += step) idx.push(y * w * 4, (y * w + w - 1) * 4);
  const median = (k: number) => {
    const v = idx.map((i) => px[i + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const bg: RGB = [median(0), median(1), median(2)];
  let near = 0;
  for (const i of idx) if (px[i + 3] > 250 && diff(px, i, bg) <= tolerance) near++;
  return near >= idx.length * share ? bg : null;
}

/** GIMP-style colour-to-alpha opacity of one pixel against bg (0 = pure background). */
function opacity(px: Uint8ClampedArray, i: number, bg: RGB): number {
  let a = 0;
  for (let k = 0; k < 3; k++) {
    const p = px[i + k];
    const b = bg[k];
    const ak = p > b ? (p - b) / (255 - b || 1) : p < b ? (b - p) / (b || 1) : 0;
    if (ak > a) a = ak;
  }
  return a;
}

export interface PlainResult {
  /** The image with the background transparent. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** True when enclosed areas of the background colour went too (not only what touches the border). */
  everywhere: boolean;
}

/**
 * Make bg transparent. `everywhere` also clears closed areas of the colour
 * (the inside of a drawn circle); otherwise only background connected to the
 * border goes, so white parts of a product on white stay. 'auto' picks
 * everywhere when most of the image is background (drawings, documents).
 * `tolerance` (0..1) ignores small noise around the colour (JPEG, paper);
 * pixels at least `opaque` different stay solid with their own colour (pure
 * colour-to-alpha would leave a red subject on grey slightly see-through),
 * and those in between — soft edges — fade.
 */
export function removePlain(px: Uint8ClampedArray, w: number, h: number, bg: RGB, everywhere: boolean | 'auto' = 'auto', tolerance = 0.06, opaque = 0.8): PlainResult {
  const n = w * h;
  const op = new Float32Array(n);
  let bgCount = 0;
  for (let p = 0; p < n; p++) {
    const a = px[p * 4 + 3] === 0 ? 0 : opacity(px, p * 4, bg);
    op[p] = a;
    if (a < 0.1) bgCount++;
  }
  const all = everywhere === 'auto' ? bgCount >= n * 0.6 : everywhere;
  // From the border only: flood through pixels that are mostly background,
  // then take in the one-pixel rim around that (the soft edge of the shapes).
  let inRegion: Uint8Array | null = null;
  if (!all) {
    const reg = new Uint8Array(n);
    const stack: number[] = [];
    const seed = (p: number) => {
      if (!reg[p] && op[p] < 0.75) {
        reg[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
    for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < n - w) seed(p + w);
    }
    inRegion = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (reg[p]) {
        inRegion[p] = 1;
        continue;
      }
      const x = p % w;
      if ((x > 0 && reg[p - 1]) || (x < w - 1 && reg[p + 1]) || (p >= w && reg[p - w]) || (p < n - w && reg[p + w])) inRegion[p] = 1;
    }
  }
  const out = new Uint8ClampedArray(px.length);
  out.set(px);
  for (let p = 0; p < n; p++) {
    if (inRegion && !inRegion[p]) continue;
    const i = p * 4;
    const a = Math.max(0, Math.min(1, (op[p] - tolerance) / (opaque - tolerance)));
    if (a <= 0) {
      out[i + 3] = 0;
      continue;
    }
    // The colour that, laid over bg at opacity a, gives the pixel.
    for (let k = 0; k < 3; k++) out[i + k] = bg[k] + (px[i + k] - bg[k]) / a;
    out[i + 3] = Math.round((px[i + 3] / 255) * a * 255);
  }
  return { rgba: out, everywhere: all };
}
