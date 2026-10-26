import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseStep, partOf } from './p21';
import { stepToScene } from './step';
import { cylinderSurface, frame, planeSurface, sphereSurface } from './geom';
import { tessellateFace, type MeshOut } from './tess';
import assembly from './testdata/assembly.step?raw';

const area = (m: THREE.Mesh) => {
  const g = m.geometry;
  const p = g.getAttribute('position');
  const idx = g.index!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let s = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
};
const outArea = (o: MeshOut) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.positions, 3));
  g.setIndex(o.indices);
  return area(new THREE.Mesh(g));
};

describe('STEP reader', () => {
  it('parses simple and complex instances, strings and escapes', () => {
    const f = parseStep(`ISO-10303-21;
HEADER;
FILE_NAME('part.step','',(''),(''),'','','');
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('it''s',(1.,-2.5E1,3));
#2=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));
#3=PRODUCT('p','\\X2\\017C\\X0\\ó\\X\\B3w','',(#4));
/* a comment */ #4=MEASURE(LENGTH_MEASURE(2.));
#5=BROKEN(;
#6=DIRECTION('',(0.,0.,1.));
ENDSEC;
END-ISO-10303-21;`);
    expect(f.name).toBe('part.step');
    expect(f.schema).toBe('AP242');
    expect(f.entities.get(1)).toEqual({ type: 'CARTESIAN_POINT', args: ["it's", [1, -25, 3]] });
    expect(partOf(f.entities.get(2), 'SI_UNIT')).toEqual([null, { enum: 'RADIAN' }]);
    expect(f.entities.get(3)!.args[1]).toBe('żó³w');
    expect(f.entities.get(4)!.args[0]).toEqual({ typed: 'LENGTH_MEASURE', args: [2] });
    expect(f.entities.get(6)!.type).toBe('DIRECTION');
  });
});

describe('STEP faces', () => {
  it('closes a full cylinder band between two circles', () => {
    const s = cylinderSurface(frame([0, 0, 0]), 2);
    const circle = (z: number, n = 48, rev = false) => {
      const pts = Array.from({ length: n }, (_, i) => [2 * Math.cos((i / n) * Math.PI * 2), 2 * Math.sin((i / n) * Math.PI * 2), z] as [number, number, number]);
      return rev ? pts.reverse() : pts;
    };
    const out: MeshOut = { positions: [], normals: [], indices: [] };
    expect(tessellateFace({ surface: s, sameSense: true, loops: [{ pts: circle(0) }, { pts: circle(5, 48, true) }] }, 0.01, out)).toBe(true);
    // 2π r h, short of the polygon's chords.
    expect(outArea(out)).toBeCloseTo(2 * Math.PI * 2 * 5 * Math.sin(Math.PI / 48) / (Math.PI / 48), 1);
  });

  it('closes a hemisphere at its pole', () => {
    const s = sphereSurface(frame([0, 0, 0]), 3);
    const n = 64;
    const pts = Array.from({ length: n }, (_, i) => [3 * Math.cos((i / n) * Math.PI * 2), 3 * Math.sin((i / n) * Math.PI * 2), 0] as [number, number, number]);
    const up: MeshOut = { positions: [], normals: [], indices: [] };
    tessellateFace({ surface: s, sameSense: true, loops: [{ pts }] }, 0.005, up);
    expect(Math.abs(outArea(up) - 2 * Math.PI * 9) / (2 * Math.PI * 9)).toBeLessThan(0.02);
    // All of it above the equator (the loop runs anticlockwise: the upper half).
    for (let i = 2; i < up.positions.length; i += 3) expect(up.positions[i]).toBeGreaterThan(-1e-6);
    // Walked the other way round: the lower half.
    const down: MeshOut = { positions: [], normals: [], indices: [] };
    tessellateFace({ surface: s, sameSense: true, loops: [{ pts: [...pts].reverse() }] }, 0.005, down);
    for (let i = 2; i < down.positions.length; i += 3) expect(down.positions[i]).toBeLessThan(1e-6);
  });

  it('draws nothing for a plane face that encloses nothing, but all of a sphere without bounds', () => {
    // Two straight edges between the same two points (left in by SolidWorks):
    // not the whole plane, which reaches a kilometre out.
    const sliver: MeshOut = { positions: [], normals: [], indices: [] };
    const loop = { pts: [[115, -97.5, 40], [115, -97.5, 15]] as [number, number, number][] };
    expect(tessellateFace({ surface: planeSurface(frame([115, -97.5, 40], [0, -1, 0], [0, 0, -1])), sameSense: true, loops: [loop] }, 0.01, sliver)).toBe(false);
    expect(sliver.indices).toHaveLength(0);
    // A sphere's bounds can be a lone vertex: then it is the whole sphere.
    const ball: MeshOut = { positions: [], normals: [], indices: [] };
    tessellateFace({ surface: sphereSurface(frame([0, 0, 0]), 2), sameSense: true, loops: [{ pts: [[0, 0, 2]] }] }, 0.005, ball);
    expect(Math.abs(outArea(ball) - 16 * Math.PI) / (16 * Math.PI)).toBeLessThan(0.02);
  });
});

describe('STEP models', () => {
  const scene = stepToScene(assembly);
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const byName = (n: string) => {
    const out: THREE.Object3D[] = [];
    scene.traverse((o) => o.name === n && out.push(o));
    return out;
  };
  const colour = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHex();

  it('keeps the product structure: two brackets and a pin', () => {
    expect(byName('Bracket')).toHaveLength(2);
    expect(byName('Pin')).toHaveLength(1);
    expect(byName('Assembly')).toHaveLength(1);
  });

  it('builds closed surfaces of the right size', () => {
    const bracket = byName('Bracket')[0];
    const parts = bracket.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[];
    const total = parts.reduce((n, m) => n + area(m), 0);
    // Box less two holes, plus the hole's wall.
    const want = 2 * 400 + 4 * 200 - 2 * Math.PI * 25 + 2 * Math.PI * 5 * 10;
    expect(Math.abs(total - want) / want).toBeLessThan(0.01);
    const pin = byName('Pin')[0];
    const pinArea = (pin.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[]).reduce((n, m) => n + area(m), 0);
    const pinWant = Math.PI * 16 + 2 * Math.PI * 4 * 20 + 2 * Math.PI * 16;
    expect(Math.abs(pinArea - pinWant) / pinWant).toBeLessThan(0.01);
  });

  it('colours solids and single faces', () => {
    const bracket = byName('Bracket')[0];
    const colours = bracket.children.filter((o) => (o as THREE.Mesh).isMesh).map((m) => colour(m as THREE.Mesh));
    expect(colours.sort()).toEqual([0x4d80cc, 0xe61a1a].sort());
    expect(colour(byName('Pin')[0].children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh)).toBe(0xff8c00);
  });

  it('places the instances', () => {
    const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    const [a, b] = byName('Bracket').map(box);
    const near = (v: THREE.Vector3, x: number, y: number, z: number) => expect(v.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-3);
    const first = a.min.x < b.min.x ? a : b;
    const second = a.min.x < b.min.x ? b : a;
    near(first.min, 0, 0, 0);
    near(first.max, 20, 20, 10);
    near(second.min, 20, 0, 0); // turned 90° about Z at x = 40
    near(second.max, 40, 20, 10);
    const pin = box(byName('Pin')[0]);
    near(pin.min, 6, 6, -5);
    near(pin.max, 14, 14, 19);
  });

  it('draws the edges once per solid', () => {
    const lines: THREE.LineSegments[] = [];
    byName('Bracket')[0].traverse((o) => (o as THREE.LineSegments).isLineSegments && lines.push(o as THREE.LineSegments));
    expect(lines).toHaveLength(1);
    expect(lines[0].geometry.getAttribute('position').count).toBeGreaterThan(24 * 2);
  });

  it('shares the geometry between instances', () => {
    const [a, b] = byName('Bracket');
    const ga = (a.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).geometry;
    expect(b.children.some((o) => (o as THREE.Mesh).geometry === ga)).toBe(true);
  });
});
