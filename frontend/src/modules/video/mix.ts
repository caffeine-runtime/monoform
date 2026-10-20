// Audio for rendered video: each kept part stretched by its speed changes
// (pitch kept), overlapping transitions cross-faded, fades and dips
// following the picture. Pure; runs in mixWorker.ts; unit-tested.

import { frameAt, speedAt, type Piece, type Project } from './project';
import { timeStretch } from './stretch';

export interface MixInput {
  pieces: Piece[];
  project: Project;
  /** Decoded PCM of each piece's source range, in order. */
  parts: { pcm: Float32Array[]; rate: number }[];
  total: number; // output seconds
  outRate: number;
}

export function mixAudio({ pieces: ps, project, parts, total, outRate }: MixInput): Float32Array[] {
  const n = Math.ceil(total * outRate);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < ps.length; i++) {
    const pc = ps[i];
    const { pcm, rate } = parts[i];
    // Split at speed changes; stretch each run.
    const cuts = [pc.src[0], ...project.speeds.flatMap((s) => [s.a, s.b]).filter((x) => x > pc.src[0] && x < pc.src[1]), pc.src[1]].sort((x, y) => x - y);
    const runs: Float32Array[][] = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = Math.round((cuts[k] - pc.src[0]) * rate);
      const b = Math.round((cuts[k + 1] - pc.src[0]) * rate);
      runs.push(timeStretch(pcm.map((c) => c.subarray(a, b)), speedAt(project.speeds, (cuts[k] + cuts[k + 1]) / 2), rate));
    }
    // Concatenate, resample to the output rate (linear), mix in with transition ramps.
    const len = runs.reduce((s, r) => s + r[0].length, 0);
    const start = Math.round(pc.out[0] * outRate);
    const ramp = pc.enter && pc.enter.kind !== 'dip' ? pc.enter.dur * outRate : 0;
    const nextEnter = ps[i + 1]?.enter;
    const tail = nextEnter && nextEnter.kind !== 'dip' ? nextEnter.dur * outRate : 0;
    const outLen = Math.round((len * outRate) / rate);
    for (let c = 0; c < 2; c++) {
      const src = new Float32Array(len);
      let o = 0;
      for (const r of runs) {
        src.set(r[Math.min(c, r.length - 1)], o);
        o += r[0].length;
      }
      for (let j = 0; j < outLen; j++) {
        const x = (j * rate) / outRate;
        const x0 = Math.floor(x);
        const v = x0 + 1 < len ? src[x0] + (src[x0 + 1] - src[x0]) * (x - x0) : (src[x0] ?? 0);
        let g = 1;
        if (ramp && j < ramp) g = j / ramp;
        if (tail && j > outLen - tail) g = Math.min(g, (outLen - j) / tail);
        const k = start + j;
        if (k >= 0 && k < n) out[c][k] += v * g;
      }
    }
  }
  // Fades and dips follow the picture's brightness.
  const step = Math.max(1, Math.round(outRate / 100));
  for (let j = 0; j < n; j += step) {
    const light = frameAt(ps, project, j / outRate)?.light ?? 1;
    if (light >= 1) continue;
    for (let c = 0; c < 2; c++) for (let k = j; k < Math.min(n, j + step); k++) out[c][k] *= light;
  }
  return out;
}
