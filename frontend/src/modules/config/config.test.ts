import { describe, expect, it } from 'vitest';
import { kindOf, looksSecret, parse, setValue } from './config';

describe('config files', () => {
  it('detects the kind by name', () => {
    expect([kindOf('/a/.env'), kindOf('.env.local'), kindOf('prod.env'), kindOf('app.properties'), kindOf('setup.cfg'), kindOf('php.ini')]).toEqual(['env', 'env', 'env', 'properties', 'ini', 'ini']);
  });
  it('reads INI sections, comments, quotes and duplicates', () => {
    const text = '; top\nname = demo\n\n[server]\nhost=localhost ; inline\nport = 8080\npath = "/a b ; c"\n[Server]\nPORT=9090\nport = 1\nbroken line\n';
    const { entries, issues } = parse(text, 'ini');
    expect(entries.map((e) => `${e.section}|${e.key}|${e.value}`)).toEqual(['|name|demo', 'server|host|localhost', 'server|port|8080', 'server|path|/a b ; c', 'Server|PORT|9090', 'Server|port|1']);
    expect(issues).toEqual([
      { line: 10, message: '“port” is already set on line 9 (this one wins in most readers)' },
      { line: 11, message: 'Expected key = value' },
    ]);
    // Editing keeps everything else, including the inline comment and quotes.
    const host = entries[1];
    expect(setValue(text, host, '0.0.0.0', 'ini')).toContain('host=0.0.0.0 ; inline\n');
    expect(setValue(text, entries[3], 'x;y', 'ini')).toContain('path = "x;y"\n');
  });
  it('reads .properties with separators, escapes and continuations', () => {
    const text = '# c\n! also\na=1\nb : two\nc three\nkey\\ with\\ space = v\nlong = first \\\n    second\nuni = caf\\u00e9\n';
    const { entries } = parse(text, 'properties');
    expect(entries.map((e) => `${e.key}=${e.value}`)).toEqual(['a=1', 'b=two', 'c=three', 'key with space=v', 'long=first second', 'uni=café']);
    const out = setValue(text, entries[4], 'short ü', 'properties');
    expect(out).toContain('long = short \\u00fc\nuni');
  });
  it('reads .env with export, quotes, multi-line values and comments', () => {
    const text = 'export A=1\nB="two words" # c\nC=\'lit $X\'\nD="line1\nline2"\nE=plain # comment\nbad line\nA=2\n';
    const { entries, issues } = parse(text, 'env');
    expect(entries.map((e) => `${e.key}=${JSON.stringify(e.value)}`)).toEqual(['A="1"', 'B="two words"', 'C="lit $X"', 'D="line1\\nline2"', 'E="plain"', 'A="2"']);
    expect(issues.map((i) => i.line)).toEqual([7, 8]);
    expect(setValue(text, entries[1], 'x', 'env')).toContain('B="x" # c');
    expect(setValue(text, entries[4], 'has space', 'env')).toContain('E="has space" # comment');
    expect(setValue(text, entries[3], 'one', 'env')).toContain('D="one"\nE=');
    expect(looksSecret('DB_PASSWORD') && looksSecret('API_TOKEN') && !looksSecret('PORT')).toBe(true);
  });
});
