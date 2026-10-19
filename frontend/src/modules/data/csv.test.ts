import { describe, expect, it } from 'vitest';
import { contentEnd, detectDelimiter, detectHeader, fieldAt, indexRecords, parseRecord, serializeRecord, terminator, toNumber } from './csv';

function all(text: string, delim = ',') {
  const { starts, count } = indexRecords(text);
  const out: string[][] = [];
  for (let k = 0; k < count; k++) out.push(parseRecord(text, starts[k], contentEnd(text, starts[k], starts[k + 1]), delim));
  return out;
}

describe('csv parsing', () => {
  it('parses quoted fields, escaped quotes and embedded newlines', () => {
    const t = 'a,"b,c","say ""hi"""\r\n1,"multi\nline",3\n';
    expect(all(t)).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', 'multi\nline', '3'],
    ]);
  });
  it('handles empty fields and missing final newline', () => {
    expect(all('a,,c\n,,\nx')).toEqual([['a', '', 'c'], ['', '', ''], ['x']]);
  });
  it('keeps exact record spans including terminators', () => {
    const t = 'h1,h2\r\n1,2\n3,4';
    const { starts, count } = indexRecords(t);
    expect(count).toBe(3);
    expect([terminator(t, starts[0], starts[1]), terminator(t, starts[1], starts[2]), terminator(t, starts[2], starts[3])]).toEqual(['\r\n', '\n', '']);
  });
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(detectDelimiter('name,city\n"Doe; John",Paris\n"Roe; Jane",Rome\n')).toBe(',');
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|');
    expect(detectDelimiter('x', 'tsv')).toBe('\t');
  });
  it('detects headers', () => {
    expect(detectHeader('name,age\nAnn,31\nBob,42\n', ',')).toBe(true);
    expect(detectHeader('1,2\n3,4\n5,6\n', ',')).toBe(false);
    expect(detectHeader('id,date\n1,2026-01-01\n2,2026-02-01\n', ',')).toBe(true);
    expect(detectHeader('apple,red\nbanana,yellow\n', ',')).toBe(true);
    expect(detectHeader('apple,red\napple,green\n', ',')).toBe(false);
  });
  it('serializes with minimal quoting and round-trips', () => {
    const rec = ['plain', 'a,b', 'say "x"', 'two\nlines', ' pad', ''];
    const s = serializeRecord(rec, ',');
    expect(s).toBe('plain,"a,b","say ""x""","two\nlines"," pad",');
    expect(parseRecord(s, 0, s.length, ',')).toEqual(rec);
  });
  it('converts numbers for sorting', () => {
    expect(toNumber('12')).toBe(12);
    expect(toNumber('-1.5e3')).toBe(-1500);
    expect(toNumber('3,5')).toBe(3.5);
    expect(toNumber('40%')).toBe(40);
    expect(toNumber('abc')).toBeNaN();
  });
});

describe('fieldAt', () => {
  it('matches parseRecord for every column', () => {
    const rows = ['a,"b,""x""",c', ',,', 'one', '"q",2,"3\n4"', 'x,y,'];
    for (const r of rows) {
      const full = parseRecord(r, 0, r.length, ',');
      for (let c = 0; c < full.length + 1; c++) expect(fieldAt(r, 0, r.length, c, ',')).toBe(full[c] ?? '');
    }
  });
});
