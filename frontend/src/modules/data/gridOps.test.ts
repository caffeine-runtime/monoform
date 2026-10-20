import { describe, expect, it } from 'vitest';
import { completeFrom, fillSeries, formatStats, addStats, emptyStats, parseTSV, shiftFormula, toTSV } from './gridOps';
import { toNumber } from './csv';

describe('clipboard TSV', () => {
  it('round-trips awkward values', () => {
    const rows = [
      ['a', 'tab\there', 'line\nbreak'],
      ['say "hi"', '', '3.5'],
    ];
    expect(parseTSV(toTSV(rows))).toEqual(rows);
  });
  it('reads what Excel puts on the clipboard', () => {
    expect(parseTSV('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseTSV('single')).toEqual([['single']]);
    expect(parseTSV('a\t\tc')).toEqual([['a', '', 'c']]);
  });
});

describe('formula references', () => {
  it('shifts relative parts only', () => {
    expect(shiftFormula('=A1+$B$2+C$3+$D4', 2, 1)).toBe('=B3+$B$2+D$3+$D6');
    expect(shiftFormula('=SUM(A1:A10)', 1, 0)).toBe('=SUM(A2:A11)');
    expect(shiftFormula('=Sheet2!B5*2', -1, 0)).toBe('=Sheet2!B4*2');
  });
  it('leaves functions, strings and plain values alone', () => {
    expect(shiftFormula('=LOG10(A1)', 1, 0)).toBe('=LOG10(A2)');
    expect(shiftFormula('="A1 "&A1', 1, 0)).toBe('="A1 "&A2');
    expect(shiftFormula('A1', 1, 1)).toBe('A1');
  });
  it('turns references off the sheet into #REF!', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  });
});

describe('fill series', () => {
  it('numbers follow their trend; a single number is copied', () => {
    expect(fillSeries(['1', '2'], 3)).toEqual(['3', '4', '5']);
    expect(fillSeries(['10', '7.5'], 2)).toEqual(['5', '2.5']);
    expect(fillSeries(['5'], 2)).toEqual(['5', '5']);
  });
  it('counts up text with numbers, keeping padding', () => {
    expect(fillSeries(['Item 1'], 2)).toEqual(['Item 2', 'Item 3']);
    expect(fillSeries(['A-009'], 2)).toEqual(['A-010', 'A-011']);
    expect(fillSeries(['Q1 2026', 'Q3 2026'], 3)).toEqual(['Q1 2026', 'Q3 2026', 'Q1 2026']); // not one pattern: repeats
  });
  it('continues days, months and dates', () => {
    expect(fillSeries(['Mon'], 3)).toEqual(['Tue', 'Wed', 'Thu']);
    expect(fillSeries(['november'], 2)).toEqual(['december', 'january']);
    expect(fillSeries(['2026-01-30'], 3)).toEqual(['2026-01-31', '2026-02-01', '2026-02-02']);
    expect(fillSeries(['2026-01-01', '2026-01-08'], 1)).toEqual(['2026-01-15']);
  });
  it('repeats anything else', () => {
    expect(fillSeries(['x', 'y'], 3)).toEqual(['x', 'y', 'x']);
  });
});

describe('autocomplete', () => {
  const entries = ['Warsaw', 'Wroclaw', 'Berlin', 'berlin', '123'];
  it('completes a unique match only', () => {
    expect(completeFrom(entries, 'Wa')).toBe('Warsaw');
    expect(completeFrom(entries, 'W')).toBeNull();
    expect(completeFrom(entries, 'be')).toBe('Berlin');
    expect(completeFrom(entries, 'Warsaw')).toBeNull();
    expect(completeFrom(entries, '12')).toBeNull();
  });
});

describe('stats', () => {
  it('counts and sums like the Excel status bar', () => {
    const s = emptyStats();
    for (const v of ['1', '2', 'x', '', '3']) addStats(s, v, toNumber);
    expect(formatStats(s)).toBe('Average: 2 · Count: 4 · Sum: 6');
  });
});
