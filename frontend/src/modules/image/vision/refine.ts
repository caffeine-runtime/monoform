// Edge refinement for model masks (object selection, select subject).
//
// The models see the image at 256–320 px, so their masks are soft and a few
// pixels off at full size. refineMask re-decides every pixel near the coarse
// edge from the image itself: the mean foreground and background colours
// around it are taken from the pixels that are confidently inside/outside,
// and the pixel's alpha is where its colour lies between the two (a simple
// local matting step). A guided filter then removes speckle without moving
// the edge, so the outline lands on the real pixel boundary. Pure functions,
// unit-tested; the vision worker calls them.

/** Box filter (running sums, edges repeated) over a float image, radius r. */
export function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      const add = x + r + 1;
      const sub = x - r;
      acc += src[row + (add >= w ? w - 1 : add)] - src[row + (sub < 0 ? 0 : sub)];
    }
  }
  // Vertical pass row by row (sequential memory access) with one running sum per column.
  const acc = new Float64Array(w);
  for (let y = -r; y <= r; y++) {
    const row = (y < 0 ? 0 : y >= h ? h - 1 : y) * w;
    for (let x = 0; x < w; x++) acc[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const add = y + r + 1;
    const sub = y - r;
    const ra = (add >= h ? h - 1 : add) * w;
    const rs = (sub < 0 ? 0 : sub) * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = acc[x] * inv;
      acc[x] += tmp[ra + x] - tmp[rs + x];
    }
  }
  return out;
}

/** Guided filter (He et al.): refines a coarse mask p along the edges of guide I. */
export function guided(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxFilter(I, w, h, r);
  const mp = boxFilter(p, w, h, r);
  const mIp = boxFilter(Ip, w, h, r);
  const mII = boxFilter(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r);
  const mb = boxFilter(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

/** Bilinear sample of a w×h float map at (x, y). */
export function sample(m: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const top = m[y0 * w + x0] * (1 - fx) + m[y0 * w + x1] * fx;
  const bot = m[y1 * w + x0] * (1 - fx) + m[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

const SURE = 1e-4;

/**
 * Snap a coarse mask to the image's edges.
 * px: RGBA pixels (w×h); prior: model probability 0..1 per pixel;
 * band: how far (px) the true edge may be from the model's edge.
 * Returns alpha 0..1 per pixel.
 */
export function refineMask(px: Uint8ClampedArray, w: number, h: number, prior: Float32Array, band: number): Float32Array {
  const n = w * h;
  const r = Math.max(1, Math.round(band));
  // Pixels within `band` of the model's 0.5 contour, or where the model is unsure, get re-decided.
  const inside = new Float32Array(n);
  for (let i = 0; i < n; i++) inside[i] = prior[i] > 0.5 ? 1 : 0;
  const near = boxFilter(inside, w, h, r);
  const unknown = new Uint8Array(n);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const p = prior[i];
      if ((near[i] > SURE && near[i] < 1 - SURE) || (p > 0.03 && p < 0.97)) {
        unknown[i] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const alpha = inside; // sure pixels keep 0/1; unknown ones are overwritten below
  if (x1 < 0) return alpha;

  // Work on the band's bounding box plus the filters' reach.
  const gr = Math.max(1, Math.round(r / 4));
  const m = 2 * r + 2 * gr + 2;
  const cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m);
  const cw = Math.min(w, x1 + m + 1) - cx, ch = Math.min(h, y1 + m + 1) - cy;
  const cn = cw * ch;
  const cpx = new Float32Array(cn * 3);
  const cprior = new Float32Array(cn);
  const cunk = new Uint8Array(cn);
  const fg = new Float32Array(cn);
  const bg = new Float32Array(cn);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y + cy) * w + x + cx;
      const j = y * cw + x;
      cpx[j * 3] = px[i * 4] / 255;
      cpx[j * 3 + 1] = px[i * 4 + 1] / 255;
      cpx[j * 3 + 2] = px[i * 4 + 2] / 255;
      cprior[j] = prior[i];
      cunk[j] = unknown[i];
      if (!unknown[i]) (inside[i] ? fg : bg)[j] = 1;
    }
  }
  const ca = decide(cpx, cw, ch, cprior, cunk, fg, bg, r, gr);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const j = y * cw + x;
      if (cunk[j]) alpha[(y + cy) * w + x + cx] = ca[j];
    }
  }
  return alpha;
}

/** Re-decide the unknown pixels of a crop (RGB 0..1, 3 floats per pixel). */
function decide(px: Float32Array, w: number, h: number, prior: Float32Array, unknown: Uint8Array, fg: Float32Array, bg: Float32Array, r: number, gr: number): Float32Array {
  const n = w * h;
  // Local colour means of the sure foreground / background (window 2·band).
  const R2 = 2 * r;
  const planes = (mask: Float32Array) => {
    const out = [boxFilter(mask, w, h, R2)];
    const c = new Float32Array(n);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < n; i++) c[i] = mask[i] ? px[i * 3 + k] : 0;
      out.push(boxFilter(c, w, h, R2));
    }
    return out;
  };
  const [fN, fR, fG, fB] = planes(fg);
  const [bN, bR, bG, bB] = planes(bg);
  const alpha = new Float32Array(n);
  // Guide for the clean-up: colour projected on the local inside→outside axis
  // (luminance where there is no axis). A plain luminance guide would blur
  // edges between colours of equal brightness, such as red on blue.
  const guide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lum = 0.299 * px[i * 3] + 0.587 * px[i * 3 + 1] + 0.114 * px[i * 3 + 2];
    guide[i] = lum;
    if (!unknown[i]) {
      alpha[i] = fg[i];
      if (fN[i] < SURE || bN[i] < SURE) continue;
    }
    const p = prior[i];
    if (fN[i] < SURE || bN[i] < SURE) {
      alpha[i] = p;
      continue;
    }
    const Fr = fR[i] / fN[i], Fg = fG[i] / fN[i], Fb = fB[i] / fN[i];
    const Br = bR[i] / bN[i], Bg = bG[i] / bN[i], Bb = bB[i] / bN[i];
    const dr = Fr - Br, dg = Fg - Bg, db = Fb - Bb;
    const dd = dr * dr + dg * dg + db * db;
    const len = Math.sqrt(dd);
    const proj = (px[i * 3] - Br) * dr + (px[i * 3 + 1] - Bg) * dg + (px[i * 3 + 2] - Bb) * db;
    // How much to trust colour: none when inside and outside look alike.
    const c = Math.min(1, Math.max(0, (len - 0.04) / 0.12));
    const conf = c * c * (3 - 2 * c);
    guide[i] = conf * (proj / (len || 1)) + (1 - conf) * lum;
    if (!unknown[i]) continue;
    const t = proj / (dd || 1);
    alpha[i] = conf * Math.min(1, Math.max(0, t)) + (1 - conf) * p;
  }

  // Edge-preserving clean-up of speckle.
  const q = guided(guide, alpha, w, h, gr, 1e-3);
  for (let i = 0; i < n; i++) {
    if (!unknown[i]) continue;
    // Gentle contrast so edges stay crisp (1–2 px of anti-aliasing).
    const v = Math.min(1, Math.max(0, (q[i] - 0.1) / 0.8));
    alpha[i] = v * v * (3 - 2 * v);
  }
  return alpha;
}
