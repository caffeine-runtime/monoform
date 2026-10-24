// Spot healing: what was painted over is replaced by a patch from nearby that
// fits, blended in seamlessly. The patch is found by comparing the ring of
// pixels just outside the painted area with the same ring shifted to each
// candidate place (coarse grid, then refined); it must not overlap the
// painted area. Pasted as is it would show its own brightness, so the
// difference between the surroundings and the patch along the edge is spread
// smoothly over the inside (a membrane: Laplace's equation, solved by
// successive over-relaxation) — the patch keeps its texture and takes on the
// light of where it goes. Pure functions, unit-tested; the vision worker runs
// them on a crop around the spot.

/** px: RGBA w×h; mask: >0 where painted. Returns new RGBA (only painted pixels change). */
export function heal(px: Uint8ClampedArray, w: number, h: number, mask: Uint8Array | Uint8ClampedArray): Uint8ClampedArray {
  const out = px.slice();
  const n = w * h;
  const M = new Uint8Array(n);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (mask[i] <= 127) continue;
      M[i] = 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return out;
  const ring = dilate(M, w, h, 3);
  for (let i = 0; i < n; i++) if (M[i]) ring[i] = 0;
  const d = findSource(px, w, h, M, ring, { x0, y0, x1, y1 });
  if (!d) return out;
  // Seamless paste: source + membrane of the edge differences, per channel.
  const idx: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (M[y * w + x]) idx.push(y * w + x);
  const pos = new Int32Array(n).fill(-1);
  idx.forEach((p, k) => (pos[p] = k));
  for (let c = 0; c < 4; c++) {
    const D = membrane(px, w, h, M, idx, pos, d, c);
    for (let k = 0; k < idx.length; k++) {
      const p = idx[k];
      const s = p + d.dy * w + d.dx;
      out[p * 4 + c] = px[s * 4 + c] + D[k];
    }
  }
  return out;
}

/** Pixels within r of the mask (box neighbourhood). */
function dilate(M: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!M[y * w + x]) continue;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/** The shift (dx, dy) whose ring best matches the painted area's ring, the shifted area clear of the painted one. */
export function findSource(px: Uint8ClampedArray, w: number, h: number, M: Uint8Array, ring: Uint8Array, b: { x0: number; y0: number; x1: number; y1: number }): { dx: number; dy: number } | null {
  const ringPts: number[] = [];
  for (let y = Math.max(0, b.y0 - 3); y <= Math.min(h - 1, b.y1 + 3); y++) for (let x = Math.max(0, b.x0 - 3); x <= Math.min(w - 1, b.x1 + 3); x++) if (ring[y * w + x]) ringPts.push(y * w + x);
  // At most ~600 ring pixels are compared for speed.
  const stepR = Math.max(1, Math.floor(ringPts.length / 600));
  const sample = ringPts.filter((_, k) => k % stepR === 0);
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const size = Math.max(bw, bh);
  const reach = Math.max(12, size * 2.5);
  const clear = (dx: number, dy: number) => {
    // The source box (with its ring) inside the picture and away from the painted box.
    if (b.x0 - 3 + dx < 0 || b.y0 - 3 + dy < 0 || b.x1 + 3 + dx >= w || b.y1 + 3 + dy >= h) return false;
    return Math.abs(dx) > bw + 3 || Math.abs(dy) > bh + 3;
  };
  const cost = (dx: number, dy: number) => {
    let s = 0;
    const off = dy * w + dx;
    for (const p of sample) {
      const q = (p + off) * 4;
      const pp = p * 4;
      for (let c = 0; c < 3; c++) {
        const e = px[pp + c] - px[q + c];
        s += e * e;
      }
    }
    return s;
  };
  let best: { dx: number; dy: number } | null = null;
  let bestCost = Infinity;
  const step = Math.max(1, Math.round(size / 6));
  for (let dy = -reach; dy <= reach; dy += step) {
    for (let dx = -reach; dx <= reach; dx += step) {
      const ix = Math.round(dx), iy = Math.round(dy);
      if (!clear(ix, iy)) continue;
      // Nearer sources win ties (the picture changes with distance).
      const c = cost(ix, iy) * (1 + 0.15 * Math.hypot(ix, iy) / reach);
      if (c < bestCost) {
        bestCost = c;
        best = { dx: ix, dy: iy };
      }
    }
  }
  if (!best) return null;
  const c0 = best;
  for (let dy = -step; dy <= step; dy++) {
    for (let dx = -step; dx <= step; dx++) {
      const ix = c0.dx + dx, iy = c0.dy + dy;
      if (!clear(ix, iy)) continue;
      const c = cost(ix, iy) * (1 + 0.15 * Math.hypot(ix, iy) / reach);
      if (c < bestCost) {
        bestCost = c;
        best = { dx: ix, dy: iy };
      }
    }
  }
  return best;
}

/** Laplace's equation over the painted pixels, its edge values target − source (channel c). */
function membrane(px: Uint8ClampedArray, w: number, h: number, M: Uint8Array, idx: number[], pos: Int32Array, d: { dx: number; dy: number }, c: number): Float32Array {
  const off = d.dy * w + d.dx;
  const diff = (p: number) => px[p * 4 + c] - px[(p + off) * 4 + c];
  const D = new Float32Array(idx.length);
  // Start from the mean edge difference: far fewer sweeps to settle.
  let sum = 0, cnt = 0;
  for (const p of idx) {
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (q < 0 || q >= w * h || M[q]) continue;
      sum += diff(q);
      cnt++;
    }
  }
  D.fill(cnt ? sum / cnt : 0);
  const omega = 1.9;
  const iters = Math.min(2000, 40 + 4 * Math.ceil(Math.sqrt(idx.length)));
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < idx.length; k++) {
      const p = idx[k];
      const x = p % w;
      let s = 0, m = 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h) continue;
        m++;
        s += M[q] ? D[pos[q]] : diff(q);
      }
      if (m) D[k] += omega * (s / m - D[k]);
    }
  }
  return D;
}
