import { describe, expect, it } from 'vitest';
import { aci, mtextPlain, num, parse } from './dxf';
import { build, bulgePolyline, ccwSweep, measure, rotateAbout, scaleAbout, splinePoints, translate, SNAP } from './geometry';
import { applyPatches, CadDoc, fmt } from './doc';

/** Build DXF text from [code, value] pairs. */
const dxf = (...g: (string | number)[]) => {
  const out: string[] = [];
  for (let i = 0; i < g.length; i += 2) out.push(String(g[i]), String(g[i + 1]));
  return out.join('\n') + '\n';
};

const R2000 = dxf(
  0, 'SECTION', 2, 'HEADER',
  9, '$ACADVER', 1, 'AC1015',
  9, '$HANDSEED', 5, '1F0',
  9, '$INSUNITS', 70, 4,
  0, 'ENDSEC',
  0, 'SECTION', 2, 'TABLES',
  0, 'TABLE', 2, 'LAYER',
  0, 'LAYER', 5, '10', 2, '0', 70, 0, 62, 7, 6, 'CONTINUOUS',
  0, 'LAYER', 5, '11', 2, 'Walls', 70, 0, 62, 1, 6, 'CONTINUOUS',
  0, 'LAYER', 5, '12', 2, 'Off', 70, 0, 62, -3, 6, 'CONTINUOUS',
  0, 'ENDTAB',
  0, 'TABLE', 2, 'BLOCK_RECORD',
  0, 'BLOCK_RECORD', 5, '1F', 2, '*Model_Space',
  0, 'ENDTAB',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'BLOCKS',
  0, 'BLOCK', 8, '0', 2, 'Door', 70, 0, 10, 0, 20, 0,
  0, 'LINE', 8, '0', 62, 0, 10, 0, 20, 0, 11, 1, 21, 0,
  0, 'ENDBLK',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LINE', 5, '100', 330, '1F', 100, 'AcDbEntity', 8, 'Walls', 100, 'AcDbLine', 10, '0.0', 20, '0.0', 30, '0.0', 11, '10.0', 21, '0.0', 31, '0.0',
  0, 'CIRCLE', 5, '101', 330, '1F', 100, 'AcDbEntity', 8, '0', 62, 3, 100, 'AcDbCircle', 10, '5.0', 20, '5.0', 30, '0.0', 40, '2.0',
  0, 'LWPOLYLINE', 5, '102', 100, 'AcDbEntity', 8, '0', 100, 'AcDbPolyline', 90, 4, 70, 1, 10, 0, 20, 0, 10, 4, 20, 0, 10, 4, 20, 3, 10, 0, 20, 3,
  0, 'INSERT', 5, '103', 100, 'AcDbEntity', 8, 'Walls', 62, 5, 100, 'AcDbBlockReference', 2, 'Door', 10, '20.0', 20, '0.0', 30, '0.0',
  0, 'TEXT', 5, '104', 100, 'AcDbEntity', 8, '0', 100, 'AcDbText', 10, '1.0', 20, '1.0', 30, '0.0', 40, '2.5', 1, '%%c50', 100, 'AcDbText',
  0, 'LINE', 5, '105', 100, 'AcDbEntity', 8, 'Off', 100, 'AcDbLine', 10, 0, 20, 0, 11, 1, 21, 1,
  0, 'ACME_THING', 5, '106', 8, '0', 1000, 'kept as is',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'OBJECTS',
  0, 'DICTIONARY', 5, 'C', 3, 'ACAD_GROUP',
  0, 'ENDSEC',
  0, 'EOF',
);

const R12 = ['  0', 'SECTION', '  2', 'ENTITIES', '  0', 'LINE', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '1.0', ' 21', '1.0', '  0', 'ENDSEC', '  0', 'EOF', ''].join('\r\n');

describe('DXF parsing', () => {
  it('reads header, layers, blocks and entities with their line spans', () => {
    const d = parse(R2000);
    expect(d.version).toBe('AC1015');
    expect(d.units).toBe(4);
    expect(d.handseed?.value).toBe('1F0');
    expect(d.modelSpaceHandle).toBe('1F');
    expect([...d.layers.keys()]).toEqual(['0', 'Walls', 'Off']);
    expect(d.layers.get('Off')!.color).toBe(-3);
    expect(d.blocks.get('Door')!.entities).toHaveLength(1);
    expect(d.entities.map((e) => e.type)).toEqual(['LINE', 'CIRCLE', 'LWPOLYLINE', 'INSERT', 'TEXT', 'LINE', 'ACME_THING']);
    const c = d.entities[1];
    expect(d.lines[c.start + 1]).toBe('CIRCLE');
    expect(d.lines[c.end + 1]).toBe('LWPOLYLINE');
    expect(num(c, 40)).toBe(2);
    expect(d.lines[d.entitiesEnd + 1]).toBe('ENDSEC');
  });
  it('reads R12 with padded codes and CRLF; POLYLINE vertices become children', () => {
    expect(parse(R12).eol).toBe('\r\n');
    const d = parse(dxf(0, 'SECTION', 2, 'ENTITIES', 0, 'POLYLINE', 8, '0', 66, 1, 70, 1, 0, 'VERTEX', 10, 0, 20, 0, 0, 'VERTEX', 10, 2, 20, 0, 0, 'VERTEX', 10, 2, 20, 2, 0, 'SEQEND', 0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 1, 0, 'ENDSEC', 0, 'EOF'));
    expect(d.entities.map((e) => e.type)).toEqual(['POLYLINE', 'LINE']);
    expect(d.entities[0].children).toHaveLength(3);
    expect(measure(d.entities[0])).toEqual({ length: 2 + 2 + Math.SQRT2 * 2, area: 2 });
  });
  it('rejects binary DXF and non-DXF text', () => {
    expect(() => parse('AutoCAD Binary DXF\r\n\x1a\0')).toThrow(/Binary/);
    expect(() => parse('hello\nworld\n')).toThrow(/Not a DXF/);
  });
  it('maps ACI colours and cleans MTEXT', () => {
    expect(aci(1)).toBe(0xff0000);
    expect(aci(5)).toBe(0x0000ff);
    expect(aci(250)).toBe(0x333333);
    expect(aci(10)).toBe(0xff0000);
    expect(mtextPlain('{\\fArial|b1;Hello}\\PWorld \\H2.5;x')).toBe('Hello\nWorld x');
  });
});

describe('geometry', () => {
  it('turns bulges into arcs through the right side', () => {
    // Bulge 1 from (0,0) to (2,0): counter-clockwise half circle below the chord.
    const p = bulgePolyline(
      [
        { x: 0, y: 0, b: 1 },
        { x: 2, y: 0, b: 0 },
      ],
      false,
    );
    const ys = p.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(-1, 3);
    expect(Math.max(...ys)).toBeCloseTo(0, 9);
    expect(p.slice(-2)).toEqual([2, 0]);
  });
  it('sweeps arcs counter-clockwise', () => {
    expect(ccwSweep(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(ccwSweep(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });
  it('evaluates a clamped B-spline through its end points', () => {
    const d = parse(dxf(0, 'SECTION', 2, 'ENTITIES', 0, 'SPLINE', 8, '0', 70, 8, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 10, 0, 20, 0, 10, 1, 20, 2, 10, 2, 20, 0, 0, 'ENDSEC', 0, 'EOF'));
    const p = splinePoints(d.entities[0]);
    expect(p.slice(0, 2)).toEqual([0, 0]);
    expect(p[p.length - 2]).toBeCloseTo(2);
    const mid = p.length / 2 - 1; // middle sample (even count of samples + 1)
    expect(p[mid + 1]).toBeCloseTo(1); // quadratic Bézier peak = 1
  });
  it('builds a scene: block expansion, BYBLOCK colour, hidden layers, snaps', () => {
    const d = parse(R2000);
    const s = build(d);
    // Entity 3 is the INSERT: its block line lands at x 20..21 in the INSERT's colour (BYBLOCK).
    const [ox, oy] = s.origin;
    const p = s.entPoly[3];
    expect(s.polys[p * 5 + 1]).toBe(0x0000ff);
    const start = s.polys[p * 5 + 2];
    expect(s.coords[start * 2] + ox).toBe(20);
    expect(s.coords[start * 2 + 2] + ox).toBe(21);
    expect(s.coords[start * 2 + 1] + oy).toBe(0);
    // Layer "Off" is off: the line on it draws nothing.
    expect(s.entPoly[6] - s.entPoly[5]).toBe(0);
    expect(Number.isNaN(s.boxes[5 * 4])).toBe(true);
    // Hidden by the viewer.
    const h = build(d, new Set(['Walls']));
    expect(h.entPoly[1] - h.entPoly[0]).toBe(0);
    // Snaps: line ends + mid, circle centre + quadrants.
    const kinds = (e: number) => {
      const out: number[] = [];
      for (let i = 0; i < s.snaps.length; i += 4) if (s.snaps[i + 3] === e) out.push(s.snaps[i + 2]);
      return out;
    };
    expect(kinds(0)).toEqual([SNAP.end, SNAP.end, SNAP.mid]);
    expect(kinds(1)).toEqual([SNAP.center, SNAP.quadrant, SNAP.quadrant, SNAP.quadrant, SNAP.quadrant]);
    expect(s.texts[0].text).toBe('⌀50');
    expect(s.layers).toContain('Walls');
  });
});

describe('editing by patches', () => {
  it('formats reals like DXF writers do', () => {
    expect(fmt(10)).toBe('10.0');
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(-1e-15)).toBe('0.0');
    expect(fmt(123456.789)).toBe('123456.789');
    expect(fmt(-2.5)).toBe('-2.5');
  });
  it('applies patches against original positions', () => {
    expect(applyPatches(['a', 'b', 'c', 'd'], [{ at: 3, del: 1, ins: ['D'] }, { at: 1, del: 0, ins: ['x', 'y'] }, { at: 0, del: 1, ins: [] }])).toEqual(['x', 'y', 'b', 'c', 'D']);
  });
  it('moves, rotates and scales only the values that change', () => {
    const doc = new CadDoc(R2000);
    doc.transform([0], translate(1, 2));
    const e = doc.d.entities[0];
    expect([num(e, 10), num(e, 20), num(e, 11), num(e, 21)]).toEqual([1, 2, 11, 2]);
    // Everything outside that line is identical.
    const before = R2000.split('\n');
    const diff = doc.lines.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0);
    expect(diff.map((i) => doc.lines[i])).toEqual(['1.0', '2.0', '11.0', '2.0']);
    expect(doc.dirty).toBe(true);
    // Rotate the circle 90° about the origin and scale it ×2.
    doc.transform([1], rotateAbout(Math.PI / 2, 0, 0));
    doc.transform([1], scaleAbout(2, 0, 0));
    const c = doc.d.entities[1];
    expect(num(c, 10)).toBeCloseTo(-10);
    expect(num(c, 20)).toBeCloseTo(10);
    expect(num(c, 40)).toBe(4);
    // INSERT gains rotation and scale groups it didn't have.
    doc.transform([3], rotateAbout(Math.PI / 2, 20, 0));
    doc.transform([3], scaleAbout(3, 20, 0));
    const ins = doc.d.entities[3];
    expect([num(ins, 41), num(ins, 42), num(ins, 50)]).toEqual([3, 3, 90]);
    const s = build(doc.d);
    const p = s.entPoly[3];
    const st = s.polys[p * 5 + 2];
    expect(s.coords[st * 2 + 2] + s.origin[0]).toBeCloseTo(20);
    expect(s.coords[st * 2 + 3] + s.origin[1]).toBeCloseTo(3);
    // Unknown entities can't be transformed and are left alone.
    expect(doc.transform([6], translate(1, 1)).skipped).toBe(1);
    // Undo all the way back gives the original bytes.
    while (doc.undo());
    expect(doc.text()).toBe(R2000);
    expect(doc.dirty).toBe(false);
    expect(doc.redo()).toBe(true);
    expect(num(doc.d.entities[0], 10)).toBe(1);
  });
  it('adds entities with fresh handles and subclass markers, bumping $HANDSEED', () => {
    const doc = new CadDoc(R2000);
    const ids = doc.add([
      { type: 'LINE', pts: [[0, 0], [5, 5]], layer: 'Walls' },
      { type: 'LWPOLYLINE', pts: [[0, 0], [1, 0], [1, 1]], closed: true, layer: '0', color: 2 },
      { type: 'ARC', pts: [[0, 0]], r: 3, a0: 0, a1: 90, layer: '0' },
      { type: 'TEXT', pts: [[1, 1]], text: 'Hi', h: 2, layer: '0' },
    ]);
    expect(ids).toEqual([7, 8, 9, 10]);
    const [l, pl, arc, t] = ids.map((i) => doc.d.entities[i]);
    expect(l.handle).toBe('1F0');
    expect(pl.handle).toBe('1F1');
    expect(doc.d.handseed?.value).toBe('1F4');
    expect(l.groups.filter((g) => g.code === 100).map((g) => g.value)).toEqual(['AcDbEntity', 'AcDbLine']);
    expect(l.groups.find((g) => g.code === 330)?.value).toBe('1F');
    expect(pl.color).toBe(2);
    expect(arc.groups.filter((g) => g.code === 100).map((g) => g.value)).toEqual(['AcDbEntity', 'AcDbCircle', 'AcDbArc']);
    expect(measure(arc).length).toBeCloseTo((3 * Math.PI) / 2);
    expect(t.groups.find((g) => g.code === 1)?.value).toBe('Hi');
    // The OBJECTS section is still there after the new entities.
    expect(doc.text()).toContain('ACAD_GROUP');
    expect(doc.d.lines[doc.d.entitiesEnd + 1]).toBe('ENDSEC');
  });
  it('writes R12 polylines as POLYLINE/VERTEX/SEQEND in the file’s code style', () => {
    const doc = new CadDoc(R12);
    doc.add([{ type: 'LWPOLYLINE', pts: [[0, 0], [1, 0], [1, 1]], layer: 'A' }]);
    const e = doc.d.entities[1];
    expect(e.type).toBe('POLYLINE');
    expect(e.children).toHaveLength(3);
    expect(e.handle).toBeNull();
    expect(doc.text()).toContain(' 10\r\n1.0');
    expect(doc.text().endsWith('  0\r\nEOF\r\n')).toBe(true);
  });
  it('copies with new handles, deletes, and changes layer, colour and text', () => {
    const doc = new CadDoc(R2000);
    const { added } = doc.copy([0, 1], translate(0, 10));
    expect(added).toEqual([7, 8]);
    const c = doc.d.entities[8];
    expect(c.handle).toBe('1F1');
    expect(num(c, 20)).toBe(15);
    expect(num(doc.d.entities[1], 20)).toBe(5);
    doc.remove([0]);
    expect(doc.d.entities[0].type).toBe('CIRCLE');
    doc.setLayer([0], 'Walls');
    doc.setColor([0], 256);
    expect(doc.d.entities[0].layer).toBe('Walls');
    expect(doc.d.entities[0].groups.some((g) => g.code === 62)).toBe(true);
    expect(doc.d.entities[0].color).toBe(256);
    doc.setColor([1], 4); // LWPOLYLINE had no colour
    expect(doc.d.entities[1].color).toBe(4);
    doc.setProp(3, 1, 0, 'Room 1');
    expect(doc.d.entities[3].groups.find((g) => g.code === 1)?.value).toBe('Room 1');
    doc.setProp(3, 50, 0, '45');
    expect(num(doc.d.entities[3], 50)).toBe(45);
    doc.setProp(1, 70, 0, '0');
    expect(num(doc.d.entities[1], 70)).toBe(0);
    expect(doc.props(1)?.props.find((p) => p.label === 'Closed')?.value).toBe('0');
    expect(doc.props(0)?.area).toBeCloseTo(Math.PI * 4);
  });
});

describe('picking and input', async () => {
  const { pick, boxSelect, nearestSnap, gridStep, parsePoint, arc3 } = await import('./pick');
  const d = parse(R2000);
  const s = build(d);
  const [ox, oy] = s.origin;
  const at = (x: number, y: number): [number, number] => [x - ox, y - oy];
  it('picks the entity under the cursor', () => {
    expect(pick(s, ...at(5, 0.05), 0.2)).toBe(0); // on the line
    expect(pick(s, ...at(7, 5), 0.2)).toBe(1); // on the circle
    expect(pick(s, ...at(5, 5), 0.2)).toBe(-1); // inside the (unfilled) circle
    expect(pick(s, ...at(2, 1.5), 0.2)).toBe(4); // inside the text box
    expect(pick(s, ...at(5, 0.05), 0.2, (e) => e === 0)).toBe(-1);
  });
  it('selects by window and crossing', () => {
    expect(boxSelect(s, ...at(-1, -1), ...at(11, 1), false)).toEqual([0]);
    expect(boxSelect(s, ...at(6, 4), ...at(8, 6), false)).toEqual([]);
    expect(boxSelect(s, ...at(6, 4), ...at(8, 6), true)).toEqual([1]);
  });
  it('snaps to the nearest point', () => {
    const p = nearestSnap(s, ...at(9.9, 0.1), 0.5)!;
    expect([p[0] + ox, p[1] + oy, p[2]]).toEqual([10, 0, SNAP.end]);
    expect(nearestSnap(s, ...at(50, 50), 0.5)).toBeNull();
  });
  it('picks a nice grid step', () => {
    expect(gridStep(1)).toBe(20);
    expect(gridStep(10)).toBe(2);
    expect(gridStep(100)).toBeCloseTo(0.2);
  });
  it('parses typed points', () => {
    expect(parsePoint('10,5', null, [0, 0])).toEqual([10, 5]);
    expect(parsePoint('@3,-4', [1, 1], [0, 0])).toEqual([4, -3]);
    const p = parsePoint('10<90', [0, 0], [0, 0])!;
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(10);
    expect(parsePoint('5', [0, 0], [0, 3])).toEqual([0, 5]);
    expect(parsePoint('abc', [0, 0], [1, 1])).toBeNull();
    expect(parsePoint('5', null, [1, 1])).toBeNull();
  });
  it('fits an arc through three points in the right direction', () => {
    const a = arc3([1, 0], [0, 1], [-1, 0])!;
    expect([a.cx, a.cy, a.r]).toEqual([0, 0, 1]);
    expect([a.a0, a.a1]).toEqual([0, 180]);
    const b = arc3([1, 0], [0, -1], [-1, 0])!;
    expect([b.a0, b.a1]).toEqual([180, 0]);
  });
});
