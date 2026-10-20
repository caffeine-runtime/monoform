import { describe, expect, it } from 'vitest';
import { muxWebM, opusHead, sizeBytes } from './webm';

/** Tiny EBML reader for the test. */
function vint(b: Uint8Array, p: number, keepMarker: boolean): [number, number] {
  let l = 1;
  while (l <= 8 && !(b[p] & (0x80 >> (l - 1)))) l++;
  let v = keepMarker ? b[p] : b[p] & ((0x80 >> (l - 1)) - 1);
  for (let i = 1; i < l; i++) v = v * 256 + b[p + i];
  return [v, l];
}
interface Node {
  id: number;
  start: number;
  data: number;
  size: number;
}
function kids(b: Uint8Array, from: number, to: number): Node[] {
  const out: Node[] = [];
  for (let p = from; p < to; ) {
    const [id, il] = vint(b, p, true);
    const [size, sl] = vint(b, p + il, false);
    out.push({ id, start: p, data: p + il + sl, size });
    p += il + sl + size;
  }
  return out;
}
const uintAt = (b: Uint8Array, n: Node) => [...b.subarray(n.data, n.data + n.size)].reduce((v, x) => v * 256 + x, 0);

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('webm muxer', () => {
  it('encodes EBML sizes', () => {
    expect([...sizeBytes(1)]).toEqual([0x81]);
    expect([...sizeBytes(200)]).toEqual([0x40, 200]);
    expect([...sizeBytes(5, 8)]).toEqual([1, 0, 0, 0, 0, 0, 0, 5]);
  });

  it('writes a seekable file: clusters at keyframes, cues and seek head pointing at the right places', () => {
    const chunks = [];
    for (let i = 0; i < 50; i++) chunks.push({ track: 1, time: i / 10, key: i % 20 === 0, data: new Uint8Array([i, 1, 2]) });
    for (let i = 0; i < 250; i++) chunks.push({ track: 2, time: i * 0.02, key: true, data: new Uint8Array([9, i & 255]) });
    const b = join(
      muxWebM(
        [
          { kind: 'video', codec: 'V_VP9', width: 320, height: 180 },
          { kind: 'audio', codec: 'A_OPUS', sampleRate: 48000, channels: 2, private: opusHead(2, 48000) },
        ],
        chunks,
        5,
      ),
    );
    const top = kids(b, 0, b.length);
    expect(top.map((n) => n.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const seg = top[1];
    expect(seg.data + seg.size).toBe(b.length);
    const segKids = kids(b, seg.data, seg.data + seg.size);
    const ids = segKids.map((n) => n.id);
    expect(ids[0]).toBe(0x114d9b74); // SeekHead
    expect(ids.filter((i) => i === 0x1f43b675).length).toBe(3); // clusters at frames 0, 20, 40
    // Seek entries point at Info, Tracks and Cues.
    for (const s of kids(b, segKids[0].data, segKids[0].data + segKids[0].size)) {
      const [sid, pos] = kids(b, s.data, s.data + s.size);
      const target = vint(b, s.data + (sid.data - s.data), true)[0];
      const at = seg.data + uintAt(b, pos);
      expect(vint(b, at, true)[0]).toBe(target);
    }
    // Cue cluster positions land on clusters.
    const cues = segKids.find((n) => n.id === 0x1c53bb6b)!;
    for (const cp of kids(b, cues.data, cues.data + cues.size)) {
      const tp = kids(b, cp.data, cp.data + cp.size).find((n) => n.id === 0xb7)!;
      const pos = kids(b, tp.data, tp.data + tp.size).find((n) => n.id === 0xf1)!;
      expect(vint(b, seg.data + uintAt(b, pos), true)[0]).toBe(0x1f43b675);
    }
    // Every chunk is present once, with a key flag for video keyframes.
    let blocks = 0;
    let keys = 0;
    for (const cl of segKids.filter((n) => n.id === 0x1f43b675)) {
      for (const k of kids(b, cl.data, cl.data + cl.size)) {
        if (k.id !== 0xa3) continue;
        blocks++;
        if (b[k.data] === 0x81 && b[k.data + 3] & 0x80) keys++;
      }
    }
    expect(blocks).toBe(300);
    expect(keys).toBe(3);
  });

  it('builds an OpusHead', () => {
    const h = opusHead(2, 48000);
    expect(new TextDecoder().decode(h.subarray(0, 8))).toBe('OpusHead');
    expect(h[9]).toBe(2);
  });
});
