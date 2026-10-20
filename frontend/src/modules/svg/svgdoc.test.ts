import { describe, expect, it } from 'vitest';
import { aboutPoint, appendChild, apply, attr, duplicate, formatTransform, moveSibling, mul, parseTransform, point, removeEl, scan, setAttr, setAttrs, setContent } from './svgdoc';

const SRC = `<?xml version="1.0"?>
<!-- a drawing -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="r" x="10" y='20' width="30" height="40"/>
  <g transform="translate(5 5)">
    <circle cx="50" cy="50" r="10"></circle>
    <text x="1" y="2">Hi &amp; bye</text>
  </g>
</svg>
`;

describe('scan', () => {
  it('finds elements in document order with attributes and extents', () => {
    const els = scan(SRC);
    expect(els.map((e) => e.tag)).toEqual(['svg', 'rect', 'g', 'circle', 'text']);
    expect(els.map((e) => e.parent)).toEqual([-1, 0, 0, 2, 2]);
    expect(attr(els[1], 'y')).toBe('20');
    expect(attr(els[4], 'x')).toBe('1');
    expect(SRC.slice(els[3].start, els[3].end)).toBe('<circle cx="50" cy="50" r="10"></circle>');
    expect(SRC.slice(els[1].start, els[1].end)).toBe(`<rect id="r" x="10" y='20' width="30" height="40"/>`);
    expect(SRC.slice(els[4].tagEnd, els[4].closeStart)).toBe('Hi &amp; bye');
  });
  it('rejects broken markup', () => {
    expect(() => scan('<svg><rect x=1/></svg>')).toThrow();
    expect(() => scan('<svg><rect x="1"')).toThrow();
  });
});

describe('minimal edits', () => {
  const els = scan(SRC);
  it('changes, adds and removes attributes in place', () => {
    expect(apply(SRC, [setAttr(SRC, els[1], 'x', '12')!])).toContain(`<rect id="r" x="12" y='20'`);
    expect(apply(SRC, [setAttr(SRC, els[1], 'y', "a'b")!])).toContain(`y='a&apos;b'`);
    expect(apply(SRC, [setAttr(SRC, els[1], 'fill', 'red')!])).toContain(`height="40" fill="red"/>`);
    expect(apply(SRC, [setAttr(SRC, els[3], 'fill', '#00f')!])).toContain(`<circle cx="50" cy="50" r="10" fill="#00f"></circle>`);
    expect(apply(SRC, [setAttr(SRC, els[1], 'id', null)!])).toContain(`<rect x="10"`);
    const multi = apply(SRC, setAttrs(SRC, els[1], { x: '0', stroke: 'blue', 'stroke-width': '2' }));
    expect(multi).toContain(`<rect id="r" x="0" y='20' width="30" height="40" stroke="blue" stroke-width="2"/>`);
    expect(() => scan(multi)).not.toThrow();
  });
  it('removes, appends, duplicates and reorders elements tidily', () => {
    const removed = apply(SRC, [removeEl(SRC, els[1])]);
    expect(removed).not.toContain('<rect');
    expect(removed).toContain('viewBox="0 0 100 100">\n  <g');
    const added = apply(SRC, [appendChild(SRC, els[0], '<ellipse cx="1" cy="1" rx="2" ry="3"/>', els)]);
    expect(added).toContain('</g>\n  <ellipse cx="1" cy="1" rx="2" ry="3"/>\n</svg>');
    const dup = apply(SRC, [duplicate(SRC, els[1], new Set(['r']))]);
    expect(dup).toContain(`<rect id="r-2"`);
    expect(scan(dup).length).toBe(6);
    const up = apply(SRC, moveSibling(SRC, els[2], els, -1)!);
    expect(scan(up).map((e) => e.tag)).toEqual(['svg', 'g', 'circle', 'text', 'rect']);
    expect(moveSibling(SRC, els[1], els, -1)).toBeNull();
    expect(apply(SRC, [setContent(SRC, els[4], 'a < b')!])).toContain('<text x="1" y="2">a &lt; b</text>');
  });
});

describe('transforms', () => {
  it('parses lists and prints the shortest form', () => {
    expect(parseTransform('translate(5 5)')).toEqual([1, 0, 0, 1, 5, 5]);
    expect(point(parseTransform('translate(10,0) scale(2)'), 1, 1)).toEqual([12, 2]);
    const r = parseTransform('rotate(90 10 10)');
    const p = point(r, 20, 10).map((v) => Math.round(v * 1e6) / 1e6);
    expect(p).toEqual([10, 20]);
    expect(formatTransform([1, 0, 0, 1, 3, -4])).toBe('translate(3 -4)');
    expect(formatTransform([1, 0, 0, 1, 0, 0])).toBeNull();
    expect(formatTransform([2, 0, 0, 2, 1, 1])).toBe('matrix(2 0 0 2 1 1)');
  });
  it('scales and rotates about a point', () => {
    const m = aboutPoint(10, 10, 2, 0);
    expect(point(m, 10, 10)).toEqual([10, 10]);
    expect(point(m, 11, 10)).toEqual([12, 10]);
    expect(point(mul(aboutPoint(0, 0, 1, 90), [1, 0, 0, 1, 0, 0]), 1, 0).map((v) => Math.round(v))).toEqual([0, 1]);
  });
});
