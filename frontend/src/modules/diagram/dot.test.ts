import { describe, expect, it } from 'vitest';
import { DotError, labelText, parseDot } from './dot';
import { cssColor, layoutDot } from './dotLayout';

const measure = (t: string) => t.length * 7;

const SAMPLE = `// build pipeline
digraph "Build" {
  rankdir=LR; node [shape=box, style="rounded,filled", fillcolor="#eef"]
  edge [color=gray40]
  subgraph cluster_src {
    label = "Sources"; style=dashed
    lexer; parser [label="Parser\\n(LL)"]
  }
  lexer -> parser -> { checker emit } [label="ast"]
  emit -> "out.o":p1 [arrowhead=vee, style=bold]
  /* a comment
     over two lines */
  checker -> lexer [dir=back]
  "out.o" [shape=record, label="<p1> text | <p2> data"]
}`;

describe('DOT parser', () => {
  it('reads nodes, edges, attributes and clusters', () => {
    const g = parseDot(SAMPLE);
    expect(g.directed).toBe(true);
    expect(g.name).toBe('Build');
    expect(g.attrs.rankdir).toBe('LR');
    expect([...g.nodes.keys()]).toEqual(['lexer', 'parser', 'checker', 'emit', 'out.o']);
    expect(g.nodes.get('parser')!.attrs).toMatchObject({ shape: 'box', label: 'Parser\\n(LL)', fillcolor: '#eef' });
    expect(g.nodes.get('lexer')!.cluster).toBe('cluster_src');
    expect(g.nodes.get('emit')!.cluster).toBeUndefined();
    expect(g.clusters[0]).toMatchObject({ id: 'cluster_src', attrs: { label: 'Sources', style: 'dashed' } });
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['lexer>parser', 'parser>checker', 'parser>emit', 'emit>out.o', 'checker>lexer']);
    expect(g.edges[1].attrs).toMatchObject({ label: 'ast', color: 'gray40' });
    expect(g.edges[3]).toMatchObject({ toPort: 'p1', line: 10, attrs: { arrowhead: 'vee' } });
    expect(g.edges[4].line).toBe(13);
    expect(g.nodes.get('out.o')!.line).toBe(10);
  });

  it('handles strict graphs, concatenation, HTML labels and preprocessor lines', () => {
    const g = parseDot('#include "x"\nstrict graph { a -- b; b -- a; a -- b [color=red]; c [label=<<b>Bold</b><br/>line>]; d [label="a" + "b"] }');
    expect(g.strict && !g.directed).toBe(true);
    expect(g.edges).toHaveLength(1);
    expect(labelText(g.nodes.get('c')!.attrs.label, 'c', '')).toBe('Bold\nline');
    expect(g.nodes.get('d')!.attrs.label).toBe('ab');
    expect(labelText('\\N says\\lhi', 'n1', '')).toBe('n1 says\nhi');
  });

  it('reports errors with line numbers', () => {
    expect(() => parseDot('digraph {\n a -> b\n c -- d\n}')).toThrow(/Line 3/);
    expect(() => parseDot('digraph { a -> }')).toThrow(DotError);
    expect(() => parseDot('graph { a [label="x }')).toThrow(/unterminated/);
    expect(() => parseDot('flowchart TD')).toThrow(/starts with/);
  });
});

describe('DOT layout', () => {
  it('draws nodes, clusters, edges and arrowheads with source lines', () => {
    const l = layoutDot(parseDot(SAMPLE), measure);
    expect(l.nodes).toBe(5);
    expect(l.edges).toBe(5);
    expect(l.width).toBeGreaterThan(300); // left to right
    expect(l.svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(l.svg).toContain('class="cluster" data-line="5"');
    expect(l.svg).toContain('stroke-dasharray="5,2"'); // dashed cluster
    expect(l.svg.match(/class="node"/g)).toHaveLength(5);
    expect(l.svg.match(/class="edge"/g)).toHaveLength(5);
    expect(l.svg).toContain('>Parser</tspan><tspan x=');
    expect(l.svg).toContain('>(LL)</tspan>');
    expect(l.svg).toContain('fill="#eef"');
    expect(l.svg).toContain('rgb(102,102,102)'); // gray40 edges
    expect(l.svg).toContain('>text</tspan>'); // record field
  });

  it('lays out a larger graph quickly', () => {
    // 300 nodes, 600 edges between nearby nodes (a dependency graph's shape).
    let src = 'digraph {';
    for (let i = 0; i < 300; i++) src += `n${i} -> n${Math.min(299, i + 1 + (i % 3))}; n${i} -> n${Math.min(299, i + 4 + (i % 5))};`;
    const t = performance.now();
    const l = layoutDot(parseDot(src + '}'), measure);
    expect(l.nodes).toBe(300);
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it('converts Graphviz colours', () => {
    expect(cssColor('0.000 1.000 1.000', '')).toBe('rgb(255,0,0)');
    expect(cssColor('grey50', '')).toBe('rgb(128,128,128)');
    expect(cssColor('red:blue', '')).toBe('red');
    expect(cssColor('#ff000080', '')).toBe('#ff000080');
    expect(cssColor(undefined, 'black')).toBe('black');
    expect(cssColor('0.5,0.5', 'x')).toBe('x');
  });
});
