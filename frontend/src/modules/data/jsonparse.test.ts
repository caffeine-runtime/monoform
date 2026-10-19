import { describe, expect, it } from 'vitest';
import { formatPath, parseJson } from './jsonparse';

const err = (t: string, c = false) => {
  const r = parseJson(t, c);
  if (r.ok) throw new Error('expected error');
  return r.error;
};

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":[1,2,{"b":null}]}')).toEqual({ ok: true, value: { a: [1, 2, { b: null }] } });
  });
  it('reports line and column of a missing comma', () => {
    const e = err('{\n  "a": 1\n  "b": 2\n}');
    expect([e.line, e.col]).toEqual([3, 3]);
    expect(e.message).toMatch(/Expected ',' or '}'/);
  });
  it('reports trailing commas', () => {
    const e = err('[1,2,]');
    expect([e.line, e.col]).toEqual([1, 6]);
    expect(e.message).toMatch(/Trailing comma/);
  });
  it('reports unterminated strings at their start', () => {
    const e = err('{"a": "abc\n}');
    expect([e.line, e.col]).toEqual([1, 11]);
  });
  it('reports single quotes and bad words', () => {
    expect(err("{'a':1}").message).toMatch(/double quotes/);
    expect(err('[tru]').message).toMatch(/Unknown word 'tru'/);
    expect(err('[01]').message).toMatch(/leading zeros/);
    expect(err('').message).toMatch(/Empty/);
    expect(err('{} x').message).toMatch(/after the end/);
  });
  it('handles escapes and unicode columns', () => {
    expect(parseJson('"a\\u0041\\n"')).toEqual({ ok: true, value: 'aA\n' });
    const e = err('{"zażółć": 1,, }');
    expect(e.col).toBe(14);
  });
  it('supports JSONC comments and trailing commas', () => {
    expect(parseJson('// c\n{ /* x */ "a": [1,], }', true)).toEqual({ ok: true, value: { a: [1] } });
  });
  it('keeps __proto__ as data', () => {
    const r = parseJson('{"__proto__": {"x": 1}}', true);
    expect(r.ok && Object.keys(r.value as object)).toEqual(['__proto__']);
  });
  it('formats paths', () => {
    expect(formatPath(['a', 0, 'b c', '$ok'])).toBe('$.a[0]["b c"].$ok');
  });
});
