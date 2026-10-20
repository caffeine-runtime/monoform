import { describe, expect, it } from 'vitest';
import { createRenderer, slugify } from './render';

const md = createRenderer();
const env = { base: '/notes/day.md', token: 'tok' };

describe('markdown renderer', () => {
  it('escapes raw HTML', () => {
    const html = md.render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', env);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });
  it('rewrites relative images to the file endpoint', () => {
    const html = md.render('![cat](assets/cat%201.png)', env);
    expect(html).toContain('src="/__hia/file?t=tok&amp;path=%2Fnotes%2Fassets%2Fcat%201.png"');
    expect(html).toContain('data-path="/notes/assets/cat 1.png"');
  });
  it('does not fetch remote images', () => {
    const html = md.render('![x](https://example.com/x.png)', env);
    expect(html).toContain('data-remote="https://example.com/x.png"');
    expect(html).not.toContain('src="https://');
  });
  it('marks links for in-app navigation', () => {
    const html = md.render('[other](../other.md#top) [web](https://x.org) [here](#intro)', env);
    expect(html).toContain('data-file="/other.md"');
    expect(html).toContain('data-anchor="top"');
    expect(html).toContain('data-external="https://x.org"');
    expect(html).toContain('data-anchor="intro"');
  });
  it('blocks javascript: links', () => {
    const html = md.render('[x](javascript:alert(1))', env);
    expect(html).not.toContain('href="javascript');
  });
  it('adds heading ids and source lines', () => {
    const html = md.render('# Hello World\n\ntext\n\n# Hello World', env);
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('id="hello-world-1"');
    expect(html).toContain('data-line="3"');
  });
  it('turns mermaid and dot fences into diagram placeholders', () => {
    const html = md.render('text\n\n```mermaid\ngraph TD; A-->B\n```\n\n```dot\ndigraph { a -> b }\n```\n\n```js\nx<1\n```', env);
    expect(html).toContain('<div class="diagram" data-kind="mermaid" data-line="3"><pre class="diagram-src">graph TD; A--&gt;B\n</pre></div>');
    expect(html).toContain('data-kind="dot" data-line="7"');
    expect(html).toContain('class="language-js">x&lt;1');
  });
  it('slugifies unicode', () => {
    expect(slugify('Zażółć gęślą!')).toBe('zażółć-gęślą');
  });
});
