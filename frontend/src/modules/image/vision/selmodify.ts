// Select › Modify: feather, expand, contract, smooth and border a selection
// mask (alpha 0..255, w×h). Expand, contract and border measure the true
// (Euclidean) distance to the selection's edge, so corners stay round and
// edges anti-aliased; feather is a Gaussian-like blur; smooth rounds corners
// and drops specks (blur, then threshold). Work is done on the selection's
// box plus the radius only. Pure functions, unit-tested; the vision worker
// runs them.

export type ModifyOp = 'feather' | 'expand' | 'contract' | 'smooth' | 'border';

export function modifyMask(alpha: Uint8ClampedArray, w: number, h: number, op: ModifyOp, amount: number): Uint8ClampedArray {
  const r = Math.max(0, amount);
  if (!r) return alpha.slice();
  // The work area: the selection's box (anything partly selected) plus the reach.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (!alpha[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  if (x1 < 0) return out;
  const m = Math.ceil(r) + 2;
  const cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m);
  const cw = Math.min(w, x1 + m + 1) - cx, ch = Math.min(h, y1 + m + 1) - cy;
  const a = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) a[y * cw + x] = alpha[(y + cy) * w + x + cx] / 255;
  let res: Float32Array;
  if (op === 'feather') res = blur(a, cw, ch, r / 2);
  else if (op === 'smooth') {
    const b = blur(binary(a), cw, ch, r / 2);
    res = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) res[i] = b[i] >= 0.5 ? 1 : 0;
  } else {
    const sd = signedDistance(binary(a), cw, ch);
    res = new Float32Array(sd.length);
    for (let i = 0; i < sd.length; i++) {
      // The edge is at sd = 0 (negative inside); a pixel is covered as far as it lies inside the new edge.
      const v = op === 'expand' ? 0.5 + r - sd[i] : op === 'contract' ? 0.5 - r - sd[i] : r / 2 + 0.5 - Math.abs(sd[i]);
      res[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[(y + cy) * w + x + cx] = Math.round(res[y * cw + x] * 255);
  return out;
}

function binary(a: Float32Array): Float32Array {
  const b = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) b[i] = a[i] >= 0.5 ? 1 : 0;
  return b;
}

/** Distance from each pixel to the selection's edge: negative inside, positive outside (half a pixel at the boundary). */
export function signedDistance(sel: Float32Array, w: number, h: number): Float32Array {
  const toIn = edt(sel, w, h, true); // outside pixels: distance to the nearest selected one
  const toOut = edt(sel, w, h, false); // inside pixels: distance to the nearest unselected one
  const sd = new Float32Array(w * h);
  for (let i = 0; i < sd.length; i++) sd[i] = sel[i] ? 0.5 - Math.sqrt(toOut[i]) : Math.sqrt(toIn[i]) - 0.5;
  return sd;
}

const INF = 1e20;

/** Squared Euclidean distance to the nearest pixel whose sel is `target` (Felzenszwalb & Huttenlocher). */
function edt(sel: Float32Array, w: number, h: number, target: boolean): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = (sel[i] > 0) === target ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const o = new Float64Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    dt1(f, h, o, v, z);
    for (let y = 0; y < h; y++) d[y * w + x] = o[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    dt1(f, w, o, v, z);
    for (let x = 0; x < w; x++) d[y * w + x] = o[x];
  }
  return d;
}

/** One-dimensional squared distance transform of f (length n) into o. */
function dt1(f: Float64Array, n: number, o: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    o[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Gaussian-like blur of standard deviation sigma: three box blurs (edges repeated). */
export function blur(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return a.slice();
  // Three boxes of radius r give a variance of 3·((2r+1)² − 1)/12.
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let cur = a;
  for (let pass = 0; pass < 3; pass++) cur = box(cur, w, h, r);
  return cur;
}

function box(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
