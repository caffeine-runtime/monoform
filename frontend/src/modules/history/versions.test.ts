import { describe, expect, it } from 'vitest';
import { ago, byDay, kindLabel, sizeDelta, type Version } from './versions';

const now = new Date(2026, 9, 20, 15, 0, 0).getTime();
const v = (hoursAgo: number, k = 'saved', s = 100): Version => ({ t: now - hoursAgo * 3_600_000, h: String(hoursAgo), s, k });

describe('file history display', () => {
  it('names the kinds of version', () => {
    expect(kindLabel(v(0, 'original'))).toBe('Before the first save');
    expect(kindLabel(v(0, 'outside'))).toBe('Changed by another program');
    expect(kindLabel(v(0))).toBe('Saved');
    expect(kindLabel({ ...v(0, 'restored'), n: new Date(now - 60_000).toISOString() })).toMatch(/^Restored the version of /);
  });

  it('says how long ago', () => {
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 72 * 3_600_000, now)).toBe('3 days ago');
  });

  it('groups by day, newest first', () => {
    const g = byDay([v(1), v(2), v(20), v(60)], now);
    expect(g.map((x) => [x.day, x.versions.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [g[2].day, 1],
    ]);
    expect(g[2].day).not.toBe('Yesterday');
  });

  it('shows the size change from the previous version', () => {
    const vs = [v(1, 'saved', 1500), v(2, 'saved', 1000), v(3, 'saved', 1000)];
    const fmt = (n: number) => `${n} B`;
    expect(sizeDelta(vs, 0, fmt)).toBe('+500 B');
    expect(sizeDelta(vs, 1, fmt)).toBe('same size');
    expect(sizeDelta(vs, 2, fmt)).toBe('');
    expect(sizeDelta([v(1, 'saved', 10), v(2, 'saved', 40)], 0, fmt)).toBe('−30 B');
  });
});
