// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findRanges, replaceAll, replaceRange } from './docFind';
import { cleanPaste } from './docPaste';

function page(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('find and replace', () => {
  it('finds across runs in a paragraph, not across paragraphs, never in marks', () => {
    const p = page('<p>Hello <b>wor</b>ld, world.</p><p>wor</p><p>ld <span class="atom" contenteditable="false">world</span></p>');
    expect(findRanges(p, 'world').map((r) => r.toString())).toEqual(['world', 'world']);
    expect(findRanges(p, 'WORLD', true)).toEqual([]);
    expect(findRanges(p, '')).toEqual([]);
  });

  it('replaces one match keeping its formatting, or all of them', () => {
    const p = page('<p>a cat, <i>a cat</i>, A CAT</p>');
    replaceRange(findRanges(p, 'cat')[1], 'dog');
    expect(p.innerHTML).toBe('<p>a cat, <i>a dog</i>, A CAT</p>');
    expect(replaceAll(p, 'cat', 'fox')).toBe(2);
    expect(p.textContent).toBe('a fox, a dog, A fox');
    expect(replaceAll(p, 'a ', '', true)).toBe(2);
  });
});

describe('paste', () => {
  it('keeps what a document can hold and drops the rest', () => {
    const html = `<meta charset="utf-8"><style>p{color:red}</style><b style="font-weight:normal" id="docs-internal-guid-1">
      <h2>Plan</h2>
      <p class="x" onclick="evil()">Some <span style="font-weight:700">bold</span>, <em>italic</em>, <span style="color:rgb(192, 0, 0)">red</span> and <a href="https://example.com/?a=1&amp;b=2">a link</a><script>bad()</script>.</p>
      <ul><li>One</li><li>Two<ul><li>Two a</li></ul></li></ul>
      <ol><li>First</li></ol>
      <img src="x.png"><a href="javascript:alert(1)">not a link</a></b>`;
    const out = cleanPaste(html)!;
    expect(out).toContain('<h2>Plan</h2>');
    expect(out).toContain('Some <b>bold</b>, <i>italic</i>, <span style="color:rgb(192, 0, 0)">red</span> and <a data-new-href="https://example.com/?a=1&amp;b=2" title="https://example.com/?a=1&amp;b=2">a link</a>.');
    expect(out).toContain('<p data-list="bullet" data-level="0">One</p>');
    expect(out).toContain('<p data-list="bullet" data-level="1">Two a</p>');
    expect(out).toContain('<p data-list="number" data-level="0">First</p>');
    expect(out).not.toContain('<br></p>');
    expect(out).not.toMatch(/script|onclick|class=|<img|javascript|<style|bad\(\)|evil/);
    expect(out).toContain('not a link');
  });

  it('plain text stays a plain paste', () => {
    expect(cleanPaste('<p>just text</p><p>more</p>')).toBeNull();
  });

  it('tables come across with their cells', () => {
    const out = cleanPaste('<table><tr><td><b>A</b></td><td>B</td></tr></table>')!;
    expect(out).toBe('<table><tr><td><p><b>A</b></p></td><td><p>B</p></td></tr></table>');
  });
});
