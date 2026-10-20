import { describe, expect, it } from 'vitest';
import { mixAudio } from './mix';
import { EMPTY, pieces, type Project } from './project';

const R = 8000;
const tone = (sec: number, v: number) => [new Float32Array(Math.round(sec * R)).fill(v), new Float32Array(Math.round(sec * R)).fill(v)];

describe('mixAudio', () => {
  it('places parts, crossfades overlaps and applies fades', () => {
    const p: Project = { ...EMPTY, transitions: [{ at: 2, kind: 'crossfade', dur: 1 }], fadeIn: 0.5 };
    const ps = pieces([[0, 2], [3, 5]], p);
    const out = mixAudio({ pieces: ps, project: p, parts: [{ pcm: tone(2, 0.5), rate: R }, { pcm: tone(2, 0.25), rate: R }], total: 3, outRate: R });
    expect(out[0].length).toBe(3 * R);
    expect(out[0][Math.round(0.1 * R)]).toBeLessThan(0.15); // fading in
    expect(out[0][Math.round(0.8 * R)]).toBeCloseTo(0.5, 2);
    // Mid-crossfade: half of each.
    expect(out[0][Math.round(1.5 * R)]).toBeCloseTo(0.25 + 0.125, 1);
    expect(out[0][Math.round(2.5 * R)]).toBeCloseTo(0.25, 2);
  });
  it('speed changes shorten the part', () => {
    const p: Project = { ...EMPTY, speeds: [{ a: 0, b: 2, rate: 2 }] };
    const ps = pieces([[0, 2]], p);
    const out = mixAudio({ pieces: ps, project: p, parts: [{ pcm: tone(2, 0.5), rate: R }], total: 1, outRate: R });
    expect(out[0].length).toBe(R);
    expect(out[0][R / 2]).toBeCloseTo(0.5, 1);
  });
});
