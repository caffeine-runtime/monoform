import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, highlightSegments } from './fuzzy';

describe('fuzzyMatch', () => {
  it('requires a subsequence', () => {
    expect(fuzzyMatch('xyz', 'Open File')).toBeNull();
    expect(fuzzyMatch('opf', 'Open File')).not.toBeNull();
    expect(fuzzyMatch('', 'anything')?.score).toBe(0);
  });
  it('is case-insensitive and ignores spaces in the query', () => {
    expect(fuzzyMatch('OPEN file', 'Open File')).not.toBeNull();
  });
  it('reports matched positions', () => {
    expect(fuzzyMatch('of', 'Open File')?.positions).toEqual([0, 5]);
  });
  it('prefers word starts and consecutive runs', () => {
    const a = fuzzyMatch('tt', 'Toggle Theme')!.score;
    const b = fuzzyMatch('tt', 'Settings')!.score;
    expect(a).toBeGreaterThan(b);
    const c = fuzzyMatch('save', 'File: Save')!.score;
    const d = fuzzyMatch('save', 'Show All Values Everywhere')!.score;
    expect(c).toBeGreaterThan(d);
  });
});

describe('fuzzyFilter', () => {
  const cmds = ['File: Save', 'File: Save As…', 'View: Toggle Sidebar', 'View: Toggle Theme', 'Tabs: Close Tab'];
  it('ranks the best match first', () => {
    const r = fuzzyFilter('tog theme', cmds, (s) => s);
    expect(r[0].item).toBe('View: Toggle Theme');
    expect(r.length).toBe(1);
  });
  it('keeps original order with an empty query', () => {
    expect(fuzzyFilter('', cmds, (s) => s).map((r) => r.item)).toEqual(cmds);
  });
  it('save ranks Save before Save As', () => {
    const r = fuzzyFilter('save', cmds, (s) => s);
    expect(r[0].item).toBe('File: Save');
    expect(r[1].item).toBe('File: Save As…');
  });
  it('limits results', () => {
    expect(fuzzyFilter('', cmds, (s) => s, 2).length).toBe(2);
  });
});

describe('highlightSegments', () => {
  it('groups runs', () => {
    expect(highlightSegments('abcd', [1, 2])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'd', hit: false },
    ]);
  });
});
