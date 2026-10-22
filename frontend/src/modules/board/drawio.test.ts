// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DrawioBoard, expandFile, htmlToText, parseStyle, styleString } from './drawio';

const measure = (t: string) => t.length * 7;

const PAGE = `<mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" page="1"><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="b" value="Decide?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="240" y="30" width="80" height="80" as="geometry"/></mxCell>
  <mxCell id="e1" value="go" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="lane" value="Lane" style="swimlane;startSize=23;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="200" width="300" height="160" as="geometry"/></mxCell>
  <mxCell id="inner" value="In &lt;b&gt;lane&lt;/b&gt;&lt;br&gt;two" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="lane"><mxGeometry x="20" y="40" width="100" height="60" as="geometry"/></mxCell>
  <mxCell id="grp" value="" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="400" y="200" width="100" height="100" as="geometry"/></mxCell>
  <mxCell id="g1" value="G" style="whiteSpace=wrap;html=1;" vertex="1" parent="grp"><mxGeometry width="50" height="50" as="geometry"/></mxCell>
  <UserObject label="Linked" link="https://example.com" id="u1"><mxCell style="text;html=1;" vertex="1" parent="1"><mxGeometry x="400" y="40" width="80" height="30" as="geometry"/></mxCell></UserObject>
  <mxCell id="e2" style="endArrow=none;html=1;dashed=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="40" y="420" as="sourcePoint"/><mxPoint x="300" y="420" as="targetPoint"/><Array as="points"><mxPoint x="170" y="460"/></Array></mxGeometry></mxCell>
</root></mxGraphModel>`;

const FILE = `<mxfile host="app.diagrams.net"><diagram id="p1" name="Flow">${PAGE}</diagram><diagram id="p2" name="Empty"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

async function compress(xml: string): Promise<string> {
  const data = new TextEncoder().encode(encodeURIComponent(xml));
  const out = new Uint8Array(await new Response(new Response(data).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

describe('draw.io board', () => {
  it('reads pages, cells, containers, groups and wrapped cells', () => {
    const b = new DrawioBoard(FILE, measure);
    expect(b.pages()).toEqual(['Flow', 'Empty']);
    expect(b.items().map((i) => i.id)).toEqual(['a', 'b', 'e1', 'lane', 'inner', 'grp', 'u1', 'e2']);
    expect(b.item('inner')!.box).toEqual({ x: 60, y: 240, w: 100, h: 60 }); // relative to its lane
    expect(b.expand(['g1'])).toEqual(['grp']);
    const svg = b.render();
    for (const id of ['a', 'b', 'e1', 'lane', 'inner', 'g1', 'u1', 'e2']) expect(svg).toContain(`data-id="${id}"`);
    expect(svg).toContain('fill="#dae8fc"');
    expect(svg).toContain('>In lane</tspan>');
    expect(svg).toContain('>Linked</tspan>');
    expect(svg).toContain('stroke-dasharray');
    expect(b.textEdit('u1')!.text).toBe('Linked');
    b.setPage(1);
    expect(b.items()).toEqual([]);
  });

  it('routes an orthogonal edge from side to side', () => {
    const b = new DrawioBoard(FILE, measure);
    const e = b.item('e1')!;
    // From a's right side (x 160, y 70) to b's left corner (x 240, y 70).
    expect(e.box.x).toBe(160);
    expect(e.box.x + e.box.w).toBe(240);
    expect(e.box.y).toBe(70);
  });

  it('moves, resizes, edits labels and keeps edges connected', () => {
    const b = new DrawioBoard(FILE, measure);
    b.move(['b'], 100, 0);
    expect(b.item('e1')!.box.x + b.item('e1')!.box.w).toBe(340);
    b.move(['lane'], 0, 100);
    expect(b.item('inner')!.box.y).toBe(340); // children follow their container
    b.resize('a', { x: 40, y: 40, w: 200, h: 80 });
    b.setText('a', 'First <step>\nnext');
    b.setText('u1', 'Renamed');
    const xml = b.serialize();
    expect(xml).toContain('value="First &amp;lt;step&amp;gt;&lt;br&gt;next"');
    expect(xml).toContain('label="Renamed"');
    expect(xml).toContain('<mxGeometry x="40" y="40" width="200" height="80" as="geometry"/>');
    expect(new DrawioBoard(xml, measure).textEdit('a')!.text).toBe('First <step>\nnext');
    // A free line keeps its waypoints when moved.
    b.move(['e2'], 10, 10);
    expect(b.serialize()).toContain('<mxPoint x="180" y="470"/>');
  });

  it('creates, connects, duplicates, styles, reorders and deletes', () => {
    const b = new DrawioBoard(FILE, measure);
    const r = b.create('rect', { x: 500, y: 400 }, { x: 600, y: 450 })!;
    const e = b.create('arrow', { x: 100, y: 70 }, { x: 550, y: 425 }, { startId: 'a', endId: r })!;
    let xml = b.serialize();
    expect(xml).toContain(`source="a" target="${r}"`);
    const [copy] = b.duplicate(['lane']);
    expect(b.items().filter((i) => i.box.w === 100 && i.box.h === 60)).toHaveLength(2); // inner copied with its lane
    expect(b.item(copy)!.box.x).toBe(50);
    b.setStyle([r], { stroke: '#ff0000', fill: '', dash: 'dotted', width: 3 });
    expect(b.style([r])).toEqual({ stroke: '#ff0000', fill: '', width: 3, dash: 'dotted', edges: 'sharp' });
    b.reorder(['a'], 'front');
    expect(b.items().map((i) => i.id).pop()).toBe('a');
    b.reorder(['a'], 'back');
    expect(b.items()[0].id).toBe('a');
    b.remove(['a']);
    xml = b.serialize();
    expect(xml).not.toContain('id="e1"'); // connected edges go with it
    expect(xml).not.toContain(`id="${e}"`);
    expect(xml).toContain('id="u1"');
  });

  it('expands compressed pages and reads styles and HTML labels', async () => {
    const compressed = `<mxfile><diagram id="x" name="Z">${await compress(PAGE)}</diagram></mxfile>`;
    const { text, compressed: was } = await expandFile(compressed);
    expect(was).toBe(true);
    const b = new DrawioBoard(text, measure);
    expect(b.items()).toHaveLength(8);
    expect(styleString(parseStyle('ellipse;whiteSpace=wrap;fillColor=none;'))).toBe('ellipse;whiteSpace=wrap;fillColor=none;');
    expect(htmlToText('<div>One &amp; <b>two</b></div><div>three</div>')).toBe('One & two\nthree');
    expect(() => new DrawioBoard('<svg/>', measure)).toThrow(/draw.io/);
  });
});
