import { describe, expect, it } from 'vitest';
import { ADDED, CHANGE, canonical, fold, dataChanges, DEL, diff, EQ, hunks, ignoreWhitespace, INS, intern, pixelDiff, REMOVED, rows, SAME, stats, tableChanges, wordDiff, type Edits } from './diff';

const lines = (s: string) => s.split('\n');
function lineDiff(a: string, b: string, key?: (s: string) => string) {
  const ids = new Map<string, number>();
  return diff(intern(lines(a), ids, key), intern(lines(b), ids, key));
}

/** Apply an edit script to a, reading inserted items from b: must give b. */
function replay(a: string[], b: string[], e: Edits): string[] {
  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const [op, c] of e) {
    if (op === EQ) {
      for (let k = 0; k < c; k++) {
        expect(a[i]).toBe(b[j]);
        out.push(a[i++]);
        j++;
      }
    } else if (op === DEL) i += c;
    else for (let k = 0; k < c; k++) out.push(b[j++]);
  }
  expect(i).toBe(a.length);
  return out;
}

describe('diff', () => {
  it('finds the minimal edit script', () => {
    // Classic example: ABCABBA → CBABAC has edit distance 5.
    const a = [...'ABCABBA'].map((c) => c.charCodeAt(0));
    const b = [...'CBABAC'].map((c) => c.charCodeAt(0));
    const e = diff(a, b);
    const cost = e.filter(([op]) => op !== EQ).reduce((n, [, c]) => n + c, 0);
    expect(cost).toBe(5);
    expect(replay([...'ABCABBA'], [...'CBABAC'], e).join('')).toBe('CBABAC');
  });
  it('handles empty and identical inputs', () => {
    expect(diff([], [])).toEqual([]);
    expect(diff([1, 2], [1, 2])).toEqual([[EQ, 2]]);
    expect(diff([], [1, 2])).toEqual([[INS, 2]]);
    expect(diff([1], [])).toEqual([[DEL, 1]]);
  });
  it('replays correctly on random sequences', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 40) }, () => String(Math.floor(rnd() * 6)));
      const b = a.filter(() => rnd() > 0.2).map((x) => (rnd() > 0.85 ? String(Math.floor(rnd() * 6)) : x));
      if (rnd() > 0.5) b.splice(Math.floor(rnd() * b.length), 0, 'x', 'y');
      const ids = new Map<string, number>();
      expect(replay(a, b, diff(intern(a, ids), intern(b, ids)))).toEqual(b);
    }
  });
  it('pairs changed lines side by side and counts them', () => {
    const r = rows(lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne'));
    expect(Array.from(r)).toEqual([SAME, 0, 0, CHANGE, 1, 1, SAME, 2, 2, SAME, 3, 3, ADDED, -1, 4]);
    expect(hunks(r)).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(stats(r)).toEqual({ same: 3, changed: 1, removed: 0, added: 1 });
    const r2 = rows(lineDiff('x\ny\nz', 'z'));
    expect(Array.from(r2)).toEqual([REMOVED, 0, -1, REMOVED, 1, -1, SAME, 2, 0]);
  });
  it('folds unchanged runs around changes', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l10', 'X');
    const f = fold(rows(lineDiff(a, b)), 2);
    // 0–7 hidden, 8–12 shown, 13–19 hidden.
    expect(Array.from(f.disp)).toEqual([-1, 8, 9, 10, 11, 12, -2]);
    expect(f.gaps).toEqual([
      [0, 8],
      [13, 7],
    ]);
  });
  it('can ignore whitespace', () => {
    expect(lineDiff('a  b\n  c', 'a b\nc', ignoreWhitespace)).toEqual([[EQ, 2]]);
  });
  it('diffs words inside a line', () => {
    const [a, b] = wordDiff('let total = price * 2;', 'let total = price * 3;');
    expect(a.map((s) => (s.changed ? `[${s.text}]` : s.text)).join('')).toBe('let total = price * [2];');
    expect(b.map((s) => (s.changed ? `[${s.text}]` : s.text)).join('')).toBe('let total = price * [3];');
  });
  it('lists structural changes', () => {
    const a = { name: 'x', tags: ['a', 'b'], deep: { n: 1, gone: true } };
    const b = { name: 'x', tags: ['a', 'c', 'd'], deep: { n: 2 }, 'new key': {} };
    expect(dataChanges(a, b)).toEqual([
      { path: '$.tags[1]', kind: 'changed', a: 'b', b: 'c' },
      { path: '$.deep.n', kind: 'changed', a: 1, b: 2 },
      { path: '$.deep.gone', kind: 'removed', a: true },
      { path: '$.tags[2]', kind: 'added', b: 'd' },
      { path: '$["new key"]', kind: 'added', b: {} },
    ]);
    expect(canonical({ b: 1, a: [2] }, true, 0)).toBe('{"a":[2],"b":1}');
  });
  it('matches table rows by key', () => {
    const a = [
      ['1', 'Ann', 'Berlin'],
      ['2', 'Bob', 'Paris'],
      ['3', 'Cid', 'Rome'],
    ];
    const b = [
      ['3', 'Cid', 'Roma'],
      ['1', 'Ann', 'Berlin'],
      ['4', 'Dee', 'Oslo'],
    ];
    const ch = tableChanges(a, b, 0, ['id', 'name', 'city']);
    expect(ch.map((c) => `${c.kind}:${c.key}`)).toEqual(['removed:2', 'changed:3', 'added:4']);
    expect(ch[1].cells).toEqual([{ col: 2, name: 'city', a: 'Rome', b: 'Roma' }]);
  });
  it('counts changed pixels', () => {
    const a = new Uint8ClampedArray(4 * 4 * 4).fill(100);
    const b = a.slice();
    b.set([110, 100, 100, 100], (1 * 4 + 2) * 4); // (2,1) off by 10
    b.set([200, 100, 100, 100], (3 * 4 + 0) * 4); // (0,3) off by 100
    expect(pixelDiff(a, b, 4, 4, 0).changed).toBe(2);
    const d = pixelDiff(a, b, 4, 4, 20);
    expect(d.changed).toBe(1);
    expect(d.box).toEqual([0, 3, 1, 4]);
    expect(d.mask[(3 * 4) * 4 + 3]).toBeGreaterThan(0);
  });
});
