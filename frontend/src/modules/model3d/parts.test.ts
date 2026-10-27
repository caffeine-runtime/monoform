import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BODY, allNodes, boundsOf, buildParts, listCsv, partOf, partSize, partsList, shownState, splitBodies, unitsUnder, type PartNode } from './parts';
import { stepToScene } from './step/step';
import assembly from './step/testdata/assembly.step?raw';

/** Two separate unit cubes (non-indexed, as STL has them), 3 apart along x. */
function twoCubes(): THREE.Mesh {
  const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(3, 0, 0);
  const pos = new Float32Array([...(a.getAttribute('position').array as Float32Array), ...(b.getAttribute('position').array as Float32Array)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
}

describe('model parts', () => {
  it('follow a STEP file’s product structure: the assembly, two brackets and a pin', () => {
    const upright = new THREE.Group();
    upright.name = 'assembly.step';
    upright.add(stepToScene(assembly));
    const root = buildParts(upright)!;
    expect(root.name).toBe('Assembly'); // the wrappers around it folded in
    expect(root.children.map((c) => c.name).sort()).toEqual(['Bracket', 'Bracket', 'Pin']);
    // A part's colours and edges are the part itself, not parts of their own.
    for (const c of root.children) {
      expect(c.children).toHaveLength(0);
      expect(c.own.some((o) => o.name === 'edges')).toBe(true);
    }
    expect(unitsUnder(root)).toHaveLength(3);
    // The same ids every time the file loads.
    const again = buildParts(Object.assign(new THREE.Group(), { name: 'x' }).add(stepToScene(assembly)))!;
    expect(allNodes(again).map((n) => n.id)).toEqual(allNodes(root).map((n) => n.id));
    // A drawn object leads back to its part.
    const pin = root.children.find((c) => c.name === 'Pin')!;
    expect(partOf(root, pin.own[0])).toBe(pin);
  });

  it('say whether a part is shown, hidden or partly hidden', () => {
    const root = buildParts(Object.assign(new THREE.Group(), { name: 'a' }).add(stepToScene(assembly)))!;
    const [first] = root.children;
    expect(shownState(root, new Set())).toBe('shown');
    expect(shownState(root, new Set([first.id]))).toBe('mixed');
    expect(shownState(first, new Set([first.id]))).toBe('hidden');
    expect(shownState(root, new Set(unitsUnder(root).map((u) => u.id)))).toBe('hidden');
  });

  it('measure only what is showing', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    b.position.x = 10;
    root.add(a, b);
    root.updateMatrixWorld(true);
    expect(boundsOf([root]).max.x).toBeCloseTo(10.5);
    b.visible = false;
    expect(boundsOf([root]).max.x).toBeCloseTo(0.5);
    expect(boundsOf([root], true).max.x).toBeCloseTo(10.5);
  });

  it('split a single mesh (an STL) into its separate bodies', () => {
    const upright = new THREE.Group();
    upright.name = 'two.stl';
    upright.add(twoCubes());
    const out = splitBodies(upright);
    expect(out).toBe(upright);
    const bodies: THREE.Mesh[] = [];
    out.traverse((o) => (o as THREE.Mesh).isMesh && bodies.push(o as THREE.Mesh));
    expect(bodies.map((m) => m.name)).toEqual([`${BODY}1`, `${BODY}2`]);
    expect(bodies.map((m) => m.geometry.getAttribute('position').count)).toEqual([36, 36]);
    expect(bodies[1].geometry.getAttribute('normal').count).toBe(36);
    const root = buildParts(out)!;
    expect(root.name).toBe('two.stl');
    expect(root.children.map((c) => c.body)).toEqual([1, 2]);
    expect(boundsOf([root.children[1].object]).min.x).toBeCloseTo(2.5);
  });

  it('leave a single body, or a mesh that is the whole model, as it is (or wrapped)', () => {
    const one = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()));
    expect(splitBodies(one).children[0]).toBeInstanceOf(THREE.Mesh);
    const bare = twoCubes();
    const out = splitBodies(bare);
    expect(out).not.toBe(bare);
    expect(out.children).toHaveLength(2);
  });

  it('don’t split into countless fragments', () => {
    const g = new THREE.Group();
    const pos: number[] = [];
    for (let i = 0; i < 20; i++) pos.push(i * 10, 0, 0, i * 10 + 1, 0, 0, i * 10, 1, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.add(new THREE.Mesh(geo));
    splitBodies(g, 10);
    expect(g.children[0]).toBeInstanceOf(THREE.Mesh);
  });
});

describe('the parts list', () => {
  it('counts copies of a part together, however they are turned', () => {
    const root = buildParts(Object.assign(new THREE.Group(), { name: 'a' }).add(stepToScene(assembly)))!;
    const rows = partsList(root, (n) => n.name);
    expect(rows.map((r) => `${r.name} ×${r.nodes.length}`).sort()).toEqual(['Bracket ×2', 'Pin ×1']);
    const bracket = rows.find((r) => r.name === 'Bracket')!;
    // 20 × 20 × 10 whichever copy is measured (the second is turned).
    expect(bracket.size.map((v) => Math.round(v * 100) / 100)).toEqual(partSize(bracket.nodes[1]).map((v) => Math.round(v * 100) / 100));
    expect(bracket.size[0]).toBeGreaterThanOrEqual(bracket.size[1]);
    expect(bracket.size[1]).toBeGreaterThanOrEqual(bracket.size[2]);
  });

  it('is written as CSV', () => {
    const n = { own: [], children: [] } as unknown as PartNode;
    const csv = listCsv([{ name: 'Bolt, M6 "long"', nodes: [n, n], size: [40, 6, 6] }], ['Part', 'Quantity', 'Length', 'Width', 'Height']);
    expect(csv).toBe('Part,Quantity,Length,Width,Height\r\n"Bolt, M6 ""long""",2,40,6,6\r\n');
  });
});
