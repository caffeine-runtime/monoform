// Generates scripts/fixture-data/knot-draco.glb (a Draco-compressed glTF used by
// the 3D self-test). One-off: needs `npm i draco3dgltf@1.5.7 three@0.186.1` in
// a scratch folder; run there with `node knot-draco.mjs > knot.b64`.
import draco from 'draco3dgltf';
import * as THREE from 'three';
const M = await draco.createEncoderModule({});
const geo = new THREE.TorusKnotGeometry(0.5, 0.18, 96, 12);
const pos = geo.getAttribute('position').array, nor = geo.getAttribute('normal').array, idx = geo.index.array;
const builder = new M.MeshBuilder(), mesh = new M.Mesh(), enc = new M.Encoder();
const nf = idx.length / 3;
builder.AddFacesToMesh(mesh, nf, new Uint32Array(idx));
const pid = builder.AddFloatAttributeToMesh(mesh, M.POSITION, pos.length / 3, 3, pos);
const nid = builder.AddFloatAttributeToMesh(mesh, M.NORMAL, nor.length / 3, 3, nor);
enc.SetSpeedOptions(5, 5);
enc.SetAttributeQuantization(M.POSITION, 14);
enc.SetAttributeQuantization(M.NORMAL, 10);
enc.SetEncodingMethod(M.MESH_EDGEBREAKER_ENCODING);
const out = new M.DracoInt8Array();
const len = enc.EncodeMeshToDracoBuffer(mesh, out);
const data = new Uint8Array(len);
for (let i = 0; i < len; i++) data[i] = out.GetValue(i);
geo.computeBoundingBox();
const bb = geo.boundingBox;
const n = pos.length / 3;
const gltf = {
  asset: { version: '2.0', generator: 'hold-it-all fixtures' },
  extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'],
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Knot', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0,
    extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: pid, NORMAL: nid } } } }] }],
  materials: [{ name: 'Teal', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.6, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.5 } }],
  accessors: [
    { componentType: 5126, count: n, type: 'VEC3', min: bb.min.toArray(), max: bb.max.toArray() },
    { componentType: 5126, count: n, type: 'VEC3' },
    { componentType: 5123, count: idx.length, type: 'SCALAR' },
  ],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: len }],
  buffers: [{ byteLength: len }],
};
const pad = (b, c) => { const p = (4 - (b.length % 4)) % 4; return Buffer.concat([b, Buffer.alloc(p, c)]); };
const js = pad(Buffer.from(JSON.stringify(gltf)), 0x20), bin = pad(Buffer.from(data), 0);
const h = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const glb = Buffer.concat([h, jh, js, bh, bin]);
console.error(`draco ${len} bytes for ${n} vertices / ${nf} triangles; glb ${glb.length}`);
process.stdout.write(glb.toString('base64'));
