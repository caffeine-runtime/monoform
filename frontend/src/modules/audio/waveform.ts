// Waveform peaks (computed by Go, PEAK_FRAMES source frames per bucket) and
// drawing them through the edit timeline, so cuts, fades and gain show
// immediately without touching the audio.
import { segGain, type Timeline } from './edits';

export const PEAK_FRAMES = 256;

export class Peaks {
  data = new Int16Array(0);
  buckets = 0;
  done = false;
  error = '';
  constructor(readonly lanes: number) {}

  append(chunk: Int16Array) {
    const need = (this.buckets * this.lanes * 2) + chunk.length;
    if (need > this.data.length) {
      const grown = new Int16Array(Math.max(need, this.data.length * 2, 4096));
      grown.set(this.data.subarray(0, this.buckets * this.lanes * 2));
      this.data = grown;
    }
    this.data.set(chunk, this.buckets * this.lanes * 2);
    this.buckets += chunk.length / (this.lanes * 2);
  }

  /** Min/max (−1…1) of a lane over source frames [a, b); null if not computed yet. */
  range(a: number, b: number, lane: number, out: [number, number]): boolean {
    const b0 = Math.floor(a / PEAK_FRAMES);
    const b1 = Math.min(Math.max(b0 + 1, Math.ceil(b / PEAK_FRAMES)), this.buckets);
    if (b0 >= b1) return false;
    let lo = 32767;
    let hi = -32768;
    const d = this.data;
    const stride = this.lanes * 2;
    for (let i = b0 * stride + lane * 2, end = b1 * stride; i < end; i += stride) {
      if (d[i] < lo) lo = d[i];
      if (d[i + 1] > hi) hi = d[i + 1];
    }
    out[0] = lo / 32767;
    out[1] = hi / 32767;
    return true;
  }
}

export interface View {
  start: number; // output frame at the left edge
  fpp: number; // frames per CSS pixel
}

export interface WaveColors {
  wave: string;
  edited: string;
  centre: string;
  silence: string;
}

/**
 * Draw lanes stacked vertically into [0, w) × [top, top + h) (CSS pixels,
 * the context already scaled for devicePixelRatio).
 */
export function drawWave(g: CanvasRenderingContext2D, w: number, top: number, h: number, peaks: Peaks, t: Timeline, view: View, c: WaveColors) {
  const lanes = peaks.lanes;
  const laneH = h / lanes;
  g.fillStyle = c.centre;
  for (let l = 0; l < lanes; l++) g.fillRect(0, Math.round(top + laneH * (l + 0.5)), w, 1);
  if (!t.length) return;
  // Walk segments alongside pixel columns.
  let si = 0;
  let segOut = 0; // output start of segment si
  const mm: [number, number] = [0, 0];
  const lo = new Float32Array(lanes);
  const hi = new Float32Array(lanes);
  for (let x = 0; x < w; x++) {
    const o0 = view.start + x * view.fpp;
    const o1 = o0 + Math.max(view.fpp, 1);
    while (si < t.length && segOut + (t[si].end - t[si].start) <= o0) {
      segOut += t[si].end - t[si].start;
      si++;
    }
    if (si >= t.length) break;
    lo.fill(1);
    hi.fill(-1);
    let any = false;
    let edited = false;
    let silent = true;
    // A column can span several segments (zoomed out after cuts).
    for (let j = si, pos = segOut; j < t.length && pos < o1; pos += t[j].end - t[j].start, j++) {
      const s = t[j];
      const L = s.end - s.start;
      const p0 = Math.max(0, o0 - pos);
      const p1 = Math.min(L, o1 - pos);
      if (p1 <= p0) continue;
      if (s.silence) {
        edited = true;
        continue;
      }
      silent = false;
      const gain = Math.max(segGain(s, p0), segGain(s, p1));
      if (s.gains?.length) edited = true;
      for (let l = 0; l < lanes; l++) {
        if (!peaks.range(s.start + p0, s.start + p1, l, mm)) continue;
        any = true;
        lo[l] = Math.min(lo[l], mm[0] * gain);
        hi[l] = Math.max(hi[l], mm[1] * gain);
      }
    }
    if (!any) {
      if (silent && edited) {
        g.fillStyle = c.silence;
        g.fillRect(x, top, 1, h);
      }
      continue;
    }
    g.fillStyle = edited ? c.edited : c.wave;
    for (let l = 0; l < lanes; l++) {
      const mid = top + laneH * (l + 0.5);
      const amp = laneH / 2 - 1;
      const y0 = mid - hi[l] * amp;
      const y1 = mid - lo[l] * amp;
      g.fillRect(x, Math.floor(y0), 1, Math.max(1, Math.ceil(y1 - y0)));
    }
  }
}

/** Ruler ticks: a "nice" step (seconds) for the zoom level. */
export function tickStep(secondsPerPixel: number): number {
  const target = secondsPerPixel * 90;
  for (const s of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]) {
    if (s >= target) return s;
  }
  return 7200;
}

export function formatTime(sec: number, digits = 3): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
