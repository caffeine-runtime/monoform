import { describe, expect, it } from 'vitest';
import { insertionIndex, zoneOf } from './tabdrag.svelte';

const boxes = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));

describe('insertionIndex', () => {
  it('keeps the place while over its own half-widths', () => {
    expect(insertionIndex(140, boxes, 1)).toBe(1);
    expect(insertionIndex(60, boxes, 1)).toBe(1);
  });
  it('moves past a neighbour once the pointer passes its middle', () => {
    expect(insertionIndex(40, boxes, 1)).toBe(0);
    expect(insertionIndex(260, boxes, 1)).toBe(2);
    expect(insertionIndex(399, boxes, 0)).toBe(3);
    expect(insertionIndex(-50, boxes, 3)).toBe(0);
  });
});

describe('zoneOf', () => {
  const bar = { bottom: 40 } as DOMRect;
  it('tells the tab bar, the views and outside the window apart', () => {
    expect(zoneOf(100, 30, bar, 800, 600)).toBe('strip');
    expect(zoneOf(100, 50, bar, 800, 600)).toBe('strip'); // some slack below the bar
    expect(zoneOf(100, 200, bar, 800, 600)).toBe('views');
    expect(zoneOf(-5, 30, bar, 800, 600)).toBe('outside');
    expect(zoneOf(100, 620, bar, 800, 600)).toBe('outside');
  });
});
