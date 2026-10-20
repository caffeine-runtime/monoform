import { describe, expect, it } from 'vitest';
import { cell, isTable, parseJsonl, parseTomlText, parseXml, tableColumns } from './formats';

describe('XML', () => {
  it('maps elements, attributes, text and repeated children', () => {
    const r = parseXml(`<?xml version="1.0"?>
<!DOCTYPE note [<!ENTITY x "y">]>
<!-- a comment -->
<catalog lang="en">
  <book id="1"><title>Tom &amp; Jerry</title><price>9.5</price></book>
  <book id="2"><title><![CDATA[<b>Bold</b>]]></title></book>
  <empty/>
  <note>Mixed <i>text</i> here</note>
</catalog>`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(JSON.stringify(r.value))).toEqual({
      catalog: {
        '@lang': 'en',
        book: [
          { '@id': '1', title: 'Tom & Jerry', price: '9.5' },
          { '@id': '2', title: '<b>Bold</b>' },
        ],
        empty: '',
        note: { i: 'text', '#text': 'Mixed  here' },
      },
    });
  });
  it('reports where a document is broken', () => {
    const r = parseXml('<a>\n  <b>\n</a>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toBe('Expected </b>, found </a>');
    expect(r.error.line).toBe(3);
    const r2 = parseXml('<a><b></b>');
    expect(!r2.ok && r2.error.message).toBe('Missing </a>');
    expect(parseXml('<a/><b/>').ok).toBe(false);
    expect(parseXml('<a x="&#x41;&#66;"/>')).toEqual({ ok: true, value: { a: { '@x': 'AB' } } });
  });
});

describe('TOML', () => {
  it('parses tables, arrays and dates', () => {
    const r = parseTomlText('title = "App"\n[server]\nport = 8080\nhosts = ["a", "b"]\nstarted = 2026-10-20T12:00:00Z\n[[users]]\nname = "x"\n');
    expect(r).toEqual({ ok: true, value: { title: 'App', server: { port: 8080, hosts: ['a', 'b'], started: '2026-10-20T12:00:00.000Z' }, users: [{ name: 'x' }] } });
  });
  it('reports errors with line and column', () => {
    const r = parseTomlText('a = 1\nb = = 2\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(2);
  });
});

describe('JSON Lines', () => {
  it('parses one value per line, skipping blank lines', () => {
    expect(parseJsonl('{"a":1}\r\n\n{"a":2,"b":[1]}\n')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2, b: [1] }], documents: 2 });
  });
  it('points at the bad line', () => {
    const r = parseJsonl('{"a":1}\n{"a":}\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(2);
  });
  it('builds table columns', () => {
    const rows = [{ a: 1, b: { x: 1 } }, { c: null, a: 'z' }];
    expect(isTable(rows)).toBe(true);
    expect(isTable([1, 2])).toBe(false);
    expect(tableColumns(rows)).toEqual(['a', 'b', 'c']);
    expect([cell(rows[0].b), cell(null), cell(undefined), cell(3)]).toEqual(['{"x":1}', 'null', '', '3']);
  });
});
