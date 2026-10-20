// Audio time-stretch without changing pitch (WSOLA: overlap-add of windowed
// input frames, each shifted within a small range to line up with the
// previous one's natural continuation). Used for speed changes in rendered
// video. Pure; unit-tested.

/**
 * Stretch audio by 1/rate (rate 2 = twice as fast, half as long).
 * channels: planar PCM; returns planar PCM of length ≈ n / rate.
 */
export function timeStretch(channels: Float32Array[], rate: number, sampleRate: number): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  if (Math.abs(rate - 1) < 1e-3 || n === 0) return channels.map((c) => c.slice());
  const W = Math.max(256, Math.round(sampleRate * 0.03) & ~1); // 30 ms frames
  const Hs = W / 2; // output hop (50 % overlap)
  const Ha = Hs * rate; // input hop
  const tol = Math.round(sampleRate * 0.008); // ±8 ms search
  const outLen = Math.max(1, Math.round(n / rate));
  const out = channels.map(() => new Float32Array(outLen + W));
  const norm = new Float32Array(outLen + W);
  const win = new Float32Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
  // Mono mix for alignment.
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;

  let prev = 0; // input position of the previous frame
  for (let k = 0, o = 0; o < outLen; k++, o += Hs) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // Align with where the previous frame would have continued.
      const natural = prev + Hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(n - W, nominal + tol);
      for (let p = lo; p <= hi; p += 2) {
        let s = 0;
        for (let i = 0; i < Hs; i += 4) {
          const a = natural + i < n ? mono[natural + i] : 0;
          s += a * mono[p + i];
        }
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
      }
    }
    best = Math.max(0, Math.min(Math.max(0, n - 1), best));
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < W; i++) {
        const v = best + i < n ? src[best + i] : 0;
        dst[o + i] += v * win[i];
      }
    }
    for (let i = 0; i < W; i++) norm[o + i] += win[i];
    prev = best;
  }
  return out.map((c) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? c[i] / norm[i] : 0;
    return r;
  });
}
