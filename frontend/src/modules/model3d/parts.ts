// The parts of a model, for the Parts panel and picking: a tree built from the
// scene graph (a STEP file's assemblies and parts, a glTF's or OBJ's named
// objects). Wrappers with nothing of their own and one child are folded into
// that child, and unnamed meshes (a part's colours) and its drawn edges belong
// to the part around them. A model that is one mesh with no names (STL) is
// split into its separate bodies first — in the load worker, see splitBodies.
import * as THREE from 'three';

/** Name given to a body split out of a single mesh; shown as "Body n". */
export const BODY = '\u0001body:';

export interface PartNode {
  /** Path of child indices from the model root: the same every time the file loads. */
  id: string;
  /** The object's name ('' when unnamed). */
  name: string;
  /** For a body split out of one mesh: its number. */
  body?: number;
  /** The object that stands for this part (for its bounds). */
  object: THREE.Object3D;
  /** What is drawn for this part itself (meshes, edges): hidden or shown together. */
  own: THREE.Object3D[];
  children: PartNode[];
  parent: PartNode | null;
}

export const drawn = (o: THREE.Object3D): boolean => {
  const m = o as THREE.Mesh;
  return !!m.geometry && (m.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) && !o.userData.mfOverlay;
};

/** The parts tree, or null when nothing is drawn. */
export function buildParts(root: THREE.Object3D): PartNode | null {
  const build = (o: THREE.Object3D, id: string): PartNode | null => {
    const own: THREE.Object3D[] = drawn(o) ? [o] : [];
    const children: PartNode[] = [];
    o.children.forEach((c, i) => {
      if (c.userData.mfOverlay) return;
      // A part's unnamed meshes (one per colour) and its edges are the part itself.
      if (drawn(c) && !c.children.length && (!c.name || c.name === 'edges' || c.name === o.name)) own.push(c);
      else {
        const n = build(c, id ? `${id}/${i}` : String(i));
        if (n) children.push(n);
      }
    });
    if (!own.length && !children.length) return null;
    // A wrapper around a single thing is that thing (under the better name).
    if (!own.length && children.length === 1) {
      const only = children[0];
      if (!only.name && o.name) only.name = o.name;
      return only;
    }
    const node: PartNode = { id, name: o.name.startsWith(BODY) ? '' : o.name, object: o, own, children, parent: null };
    if (o.name.startsWith(BODY)) node.body = Number(o.name.slice(BODY.length)) || undefined;
    for (const c of children) c.parent = node;
    return node;
  };
  return build(root, '');
}

/** Every node, depth first. */
export function allNodes(root: PartNode | null): PartNode[] {
  const out: PartNode[] = [];
  const walk = (n: PartNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  if (root) walk(root);
  return out;
}

/** The nodes under n (n included) that draw something themselves: what hiding works on. */
export function unitsUnder(n: PartNode): PartNode[] {
  return allNodes(n).filter((x) => x.own.length);
}

/** The part a drawn object belongs to. */
export function partOf(root: PartNode | null, o: THREE.Object3D): PartNode | null {
  for (const n of allNodes(root)) if (n.own.includes(o)) return n;
  return null;
}

/** Shown, hidden or partly hidden (some of its parts). */
export function shownState(n: PartNode, hidden: ReadonlySet<string>): 'shown' | 'hidden' | 'mixed' {
  const units = unitsUnder(n);
  const off = units.filter((u) => hidden.has(u.id)).length;
  return off === 0 ? 'shown' : off === units.length ? 'hidden' : 'mixed';
}

/** Is o drawn: it and every parent visible. */
export function showing(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/** Bounds of what is drawn of these objects (and what they contain), in world space; only what is showing unless `all`. */
export function boundsOf(objects: Iterable<THREE.Object3D>, all = false): THREE.Box3 {
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  for (const top of objects) {
    top.updateWorldMatrix(true, false);
    top.traverse((o) => {
      if (!drawn(o) || (!all && !showing(o))) return;
      const g = (o as THREE.Mesh).geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox || g.boundingBox.isEmpty()) return;
      o.updateWorldMatrix(false, false);
      box.union(b.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    });
  }
  return box;
}

/**
 * A model that is a single mesh (an STL, a PLY): split it into its separate
 * bodies (triangles joined through shared corners), each its own mesh named
 * BODY + n. Corners at the same place count as shared (STL repeats them per
 * triangle). Nothing changes for one body, or more than `max` (scattered
 * fragments, not parts). Returns the model (a new group when it was that mesh).
 */
export function splitBodies(root: THREE.Object3D, max = 256): THREE.Object3D {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (drawn(o)) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length !== 1 || !meshes[0].isMesh) return root;
  const mesh = meshes[0];
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(g.morphAttributes).length || g.groups.length > 1 || Array.isArray(mesh.material)) return root;
  const index = g.index;
  const corners = index ? index.count : pos.count;
  const tris = Math.floor(corners / 3);
  if (tris < 2) return root;

  // One id per distinct position (quantised to a millionth of the model's size).
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
  const q = 1e5 / span;
  const ids = new Map<number, number>();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round((pos.getX(i) - bb.min.x) * q) * 1e10 + Math.round((pos.getY(i) - bb.min.y) * q) * 1e5 + Math.round((pos.getZ(i) - bb.min.z) * q);
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    vid[i] = v;
  }
  const up = new Int32Array(ids.size);
  for (let i = 0; i < up.length; i++) up[i] = i;
  const find = (x: number) => {
    while (up[x] !== x) x = up[x] = up[up[x]];
    return x;
  };
  const corner = (c: number) => vid[index ? index.getX(c) : c];
  for (let t = 0; t < tris; t++) {
    const a = find(corner(t * 3));
    const b = find(corner(t * 3 + 1));
    const c = find(corner(t * 3 + 2));
    if (a !== b) up[b] = a;
    const r = find(a);
    if (r !== find(c)) up[find(c)] = r;
  }
  // Bodies in the order they first appear in the file.
  const bodyOf = new Map<number, number>();
  const triBody = new Int32Array(tris);
  for (let t = 0; t < tris; t++) {
    const r = find(corner(t * 3));
    let n = bodyOf.get(r);
    if (n === undefined) bodyOf.set(r, (n = bodyOf.size));
    triBody[t] = n;
  }
  const count = bodyOf.size;
  if (count < 2 || count > max) return root;

  const sizes = new Int32Array(count);
  for (let t = 0; t < tris; t++) sizes[triBody[t]]++;
  const names = Object.keys(g.attributes);
  const parts = Array.from({ length: count }, (_, n) => {
    const geo = new THREE.BufferGeometry();
    for (const name of names) {
      const src = g.getAttribute(name) as THREE.BufferAttribute;
      const Arr = src.array.constructor as new (n: number) => THREE.TypedArray;
      geo.setAttribute(name, new THREE.BufferAttribute(new Arr(sizes[n] * 3 * src.itemSize), src.itemSize, src.normalized));
    }
    return geo;
  });
  const filled = new Int32Array(count);
  for (let t = 0; t < tris; t++) {
    const n = triBody[t];
    const at = filled[n]++ * 3;
    for (const name of names) {
      const src = g.getAttribute(name) as THREE.BufferAttribute;
      const dst = parts[n].getAttribute(name) as THREE.BufferAttribute;
      for (let k = 0; k < 3; k++) {
        const from = index ? index.getX(t * 3 + k) : t * 3 + k;
        for (let s = 0; s < src.itemSize; s++) dst.array[(at + k) * src.itemSize + s] = src.array[from * src.itemSize + s];
      }
    }
  }
  const group = new THREE.Group();
  group.name = mesh.name;
  group.position.copy(mesh.position);
  group.quaternion.copy(mesh.quaternion);
  group.scale.copy(mesh.scale);
  parts.forEach((geo, n) => {
    const m = new THREE.Mesh(geo, mesh.material);
    m.name = `${BODY}${n + 1}`;
    group.add(m);
  });
  const parent = mesh.parent;
  g.dispose();
  if (!parent) return group;
  parent.children[parent.children.indexOf(mesh)] = group;
  group.parent = parent;
  mesh.parent = null;
  return root;
}

/** One line of the parts list: a part and how many of it, with its size. */
export interface ListRow {
  name: string;
  nodes: PartNode[];
  /** Length, width, height: the part's extent in its own frame, longest first (the same however a copy is turned). */
  size: [number, number, number];
}

/** A part's size in its own frame, longest side first. */
export function partSize(n: PartNode): [number, number, number] {
  n.object.updateWorldMatrix(true, true);
  const inv = n.object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const o of n.own) {
    const g = (o as THREE.Mesh).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) continue;
    box.union(b.copy(g.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  }
  if (box.isEmpty()) return [0, 0, 0];
  const s = box.getSize(new THREE.Vector3());
  return [s.x, s.y, s.z].sort((a, c) => c - a) as [number, number, number];
}

/**
 * The parts list (a bill of materials): every part that draws something,
 * copies of the same part (same name and size) counted together, in the order
 * they first appear.
 */
export function partsList(root: PartNode | null, label: (n: PartNode) => string): ListRow[] {
  const rows = new Map<string, ListRow>();
  for (const n of root ? unitsUnder(root) : []) {
    const size = partSize(n);
    const name = label(n);
    const key = `${name}|${size.map((v) => v.toPrecision(4)).join('|')}`;
    const row = rows.get(key);
    if (row) row.nodes.push(n);
    else rows.set(key, { name, nodes: [n], size });
  }
  return [...rows.values()];
}

/** The list as CSV (RFC 4180: quoted where needed, CRLF lines). */
export function listCsv(rows: ListRow[], head: [string, string, string, string, string], fmt: (v: number) => string = (v) => String(+v.toPrecision(6))): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [head, ...rows.map((r) => [r.name, String(r.nodes.length), ...r.size.map(fmt)])].map((l) => l.map(q).join(',')).join('\r\n') + '\r\n';
}
