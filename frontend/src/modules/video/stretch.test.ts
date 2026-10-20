import { describe, expect, it } from 'vitest';
import { timeStretch } from './stretch';

const SR = 48000;
function sine(freq: number, seconds: number): Float32Array {
  const a = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  return a;
}
/** Frequency from zero crossings, ignoring the edges. */
function freqOf(a: Float32Array): number {
  const from = Math.round(a.length * 0.1);
  const to = Math.round(a.length * 0.9);
  let n = 0;
  for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) n++;
  return n / ((to - from) / SR);
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('timeStretch', () => {
  for (const rate of [2, 0.5, 1.5]) {
    it(`changes length but not pitch at ${rate}×`, () => {
      const [out] = timeStretch([sine(440, 1)], rate, SR);
      expect(out.length).toBe(Math.round(SR / rate));
      expect(freqOf(out)).toBeGreaterThan(430);
      expect(freqOf(out)).toBeLessThan(450);
      expect(rms(out.subarray(out.length * 0.1, out.length * 0.9))).toBeGreaterThan(0.3); // no cancellation
    });
  }
  it('keeps channels separate and passes 1× through', () => {
    const l = sine(300, 0.5);
    const r = new Float32Array(l.length);
    const [ol, or] = timeStretch([l, r], 2, SR);
    expect(rms(or)).toBe(0);
    expect(rms(ol)).toBeGreaterThan(0.3);
    expect(timeStretch([l], 1, SR)[0]).toEqual(l);
  });
});
