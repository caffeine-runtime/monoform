// Minimal WebM (Matroska) muxer for rendered video: one VP8/VP9 track and an
// optional Opus/Vorbis track, SimpleBlocks in clusters that start at video
// keyframes, Cues for seeking and a SeekHead. Everything is known up front
// (we mux after encoding), so all sizes are exact. Output is Blob parts, so
// large files aren't copied into one buffer.

export interface MuxTrack {
  kind: 'video' | 'audio';
  codec: 'V_VP8' | 'V_VP9' | 'A_OPUS' | 'A_VORBIS';
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  private?: Uint8Array;
}

export interface MuxChunk {
  track: number; // 1-based index into tracks
  time: number; // seconds
  key: boolean;
  data: Uint8Array;
}

type Part = Uint8Array;

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
};

const enc = new TextEncoder();

function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return new Uint8Array(out);
}

/** EBML size: minimal length, or exactly `len` bytes. */
export function sizeBytes(n: number, len = 0): Uint8Array {
  let l = len || 1;
  if (!len) while (n >= 2 ** (7 * l) - 1) l++;
  const out = new Uint8Array(l);
  let v = n;
  for (let i = l - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (l - 1);
  return out;
}

const len = (parts: Part[]) => parts.reduce((n, p) => n + p.length, 0);

function el(id: number, body: Part[] | Part): Part[] {
  const parts = Array.isArray(body) ? body : [body];
  return [idBytes(id), sizeBytes(len(parts)), ...parts];
}

function uint(id: number, v: number, bytes = 0): Part[] {
  let l = bytes || 1;
  if (!bytes) while (v >= 2 ** (8 * l)) l++;
  const b = new Uint8Array(l);
  let x = v;
  for (let i = l - 1; i >= 0; i--) {
    b[i] = x % 256;
    x = Math.floor(x / 256);
  }
  return el(id, b);
}

function float(id: number, v: number): Part[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
}

const str = (id: number, s: string) => el(id, enc.encode(s));

/** OpusHead for CodecPrivate (RFC 7845), mapping family 0. */
export function opusHead(channels: number, sampleRate: number, preSkip = 312): Uint8Array {
  const b = new Uint8Array(19);
  b.set(enc.encode('OpusHead'));
  const v = new DataView(b.buffer);
  v.setUint8(8, 1);
  v.setUint8(9, channels);
  v.setUint16(10, preSkip, true);
  v.setUint32(12, sampleRate, true);
  v.setInt16(16, 0, true);
  v.setUint8(18, 0);
  return b;
}

export function muxWebM(tracks: MuxTrack[], chunks: MuxChunk[], duration: number): Part[] {
  const header = el(ID.EBML, [
    ...uint(ID.EBMLVersion, 1),
    ...uint(ID.EBMLReadVersion, 1),
    ...uint(ID.EBMLMaxIDLength, 4),
    ...uint(ID.EBMLMaxSizeLength, 8),
    ...str(ID.DocType, 'webm'),
    ...uint(ID.DocTypeVersion, 4),
    ...uint(ID.DocTypeReadVersion, 2),
  ]);
  const info = el(ID.Info, [...uint(ID.TimestampScale, 1e6), ...float(ID.Duration, duration * 1000), ...str(ID.MuxingApp, 'Hold It All'), ...str(ID.WritingApp, 'Hold It All')]);
  const trackEls = el(
    ID.Tracks,
    tracks.flatMap((t, i) => {
      const kids: Part[] = [...uint(ID.TrackNumber, i + 1), ...uint(ID.TrackUID, i + 1), ...uint(ID.TrackType, t.kind === 'video' ? 1 : 2), ...uint(ID.FlagLacing, 0), ...str(ID.CodecID, t.codec)];
      if (t.private) kids.push(...el(ID.CodecPrivate, t.private));
      if (t.codec === 'A_OPUS') kids.push(...uint(ID.CodecDelay, 6500000), ...uint(ID.SeekPreRoll, 80000000));
      if (t.kind === 'video') kids.push(...el(ID.Video, [...uint(ID.PixelWidth, t.width!), ...uint(ID.PixelHeight, t.height!)]));
      else kids.push(...el(ID.Audio, [...float(ID.SamplingFrequency, t.sampleRate!), ...uint(ID.Channels, t.channels!)]));
      return el(ID.TrackEntry, kids);
    }),
  );

  // Clusters: a new one at each video keyframe, or when timestamps would overflow int16 / after 5 s.
  const sorted = [...chunks].sort((a, b) => a.time - b.time || a.track - b.track);
  const videoTrack = tracks.findIndex((t) => t.kind === 'video') + 1;
  const clusters: { time: number; parts: Part[] }[] = [];
  let cur: { time: number; blocks: Part[] } | null = null;
  const flush = () => {
    if (cur) clusters.push({ time: cur.time, parts: el(ID.Cluster, [...uint(ID.Timestamp, cur.time), ...cur.blocks]) });
  };
  for (const c of sorted) {
    const ms = Math.round(c.time * 1000);
    if (!cur || (c.track === videoTrack && c.key) || ms - cur.time > 5000 || ms - cur.time > 32000) {
      flush();
      cur = { time: ms, blocks: [] };
    }
    const head = new Uint8Array(4);
    head[0] = 0x80 | c.track;
    new DataView(head.buffer).setInt16(1, ms - cur.time);
    head[3] = c.key ? 0x80 : 0;
    cur.blocks.push(...el(ID.SimpleBlock, [head, c.data]));
  }
  flush();

  // Positions are relative to the segment's data. SeekHead has a fixed size (8-byte positions).
  const seekEntry = (id: number, pos: number) => el(ID.Seek, [...el(ID.SeekID, idBytes(id)), ...uint(ID.SeekPosition, pos, 8)]);
  const seekSize = len(el(ID.SeekHead, [...seekEntry(ID.Info, 0), ...seekEntry(ID.Tracks, 0), ...seekEntry(ID.Cues, 0)]));
  const infoPos = seekSize;
  const tracksPos = infoPos + len(info);
  let pos = tracksPos + len(trackEls);
  const cuePoints: Part[] = [];
  for (const cl of clusters) {
    cuePoints.push(...el(ID.CuePoint, [...uint(ID.CueTime, cl.time), ...el(ID.CueTrackPositions, [...uint(ID.CueTrack, videoTrack || 1), ...uint(ID.CueClusterPosition, pos)])]));
    pos += len(cl.parts);
  }
  const cuesPos = pos;
  const cues = el(ID.Cues, cuePoints);
  const seek = el(ID.SeekHead, [...seekEntry(ID.Info, infoPos), ...seekEntry(ID.Tracks, tracksPos), ...seekEntry(ID.Cues, cuesPos)]);
  const body: Part[] = [...seek, ...info, ...trackEls, ...clusters.flatMap((c) => c.parts), ...cues];
  return [...header, idBytes(ID.Segment), sizeBytes(len(body), 8), ...body];
}
