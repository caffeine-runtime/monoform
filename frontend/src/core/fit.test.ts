// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isNarrow, layoutBar } from './fit';

/** A bar whose content needs `full` px, `compact` px with icons only, in `width` px. */
function bar(width: number | (() => number), full: number, compact: number) {
  const w = typeof width === 'number' ? () => width : width;
  const el = document.createElement('div');
  el.innerHTML =
    '<button class="btn"><svg></svg> Expand all</button>' +
    '<button class="btn" title="Indent with two spaces"><svg></svg> Format</button>' +
    '<button class="btn" title="Copy the path"><svg></svg> Copy</button>' +
    '<button class="btn">Text only</button>';
  Object.defineProperty(el, 'clientWidth', { get: w });
  Object.defineProperty(el, 'scrollWidth', {
    get: () => Math.max(w(), el.classList.contains('wrapped') ? 0 : el.classList.contains('compact') ? compact : full),
  });
  return el;
}

describe('layoutBar', () => {
  it('leaves a bar that fits alone', () => {
    const el = bar(800, 600, 300);
    layoutBar(el);
    expect(el.className).toBe('');
    expect(el.querySelector('button')!.title).toBe('');
  });

  it('drops labels to icons and names them on hover', () => {
    const el = bar(400, 600, 300);
    layoutBar(el);
    expect(el.classList.contains('compact')).toBe(true);
    expect(el.classList.contains('wrapped')).toBe(false);
    const [a, b, c, d] = el.querySelectorAll('button');
    expect(a.title).toBe('Expand all');
    expect(a.getAttribute('aria-label')).toBe('Expand all');
    expect(b.title).toBe('Format — Indent with two spaces');
    expect(c.title).toBe('Copy the path'); // already names it
    expect(d.title).toBe(''); // no icon: keeps its text, needs no tooltip
  });

  it('wraps when icons alone still do not fit', () => {
    const el = bar(200, 600, 300);
    layoutBar(el);
    expect(el.classList.contains('compact')).toBe(true);
    expect(el.classList.contains('wrapped')).toBe(true);
  });

  it('restores the buttons own titles when there is room again', () => {
    let w = 400;
    const el = bar(() => w, 600, 300);
    layoutBar(el);
    w = 900;
    layoutBar(el);
    const [a, b] = el.querySelectorAll('button');
    expect(el.className).toBe('');
    expect(a.hasAttribute('title')).toBe(false);
    expect(a.hasAttribute('aria-label')).toBe(false);
    expect(b.title).toBe('Indent with two spaces');
  });
});

describe('isNarrow', () => {
  it('treats unmeasured panes as wide', () => {
    expect(isNarrow(0)).toBe(false);
    expect(isNarrow(420)).toBe(true);
    expect(isNarrow(900)).toBe(false);
  });
});
