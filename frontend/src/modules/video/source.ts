// Decoding a source video with WebCodecs for rendering and tracking. Go
// lists the streams and where each sample's bytes are (VideoDemux); bytes
// come from the media server in large Range reads; VideoDecoder and
// AudioDecoder turn them into frames and PCM.

import { api } from '../../core/backend';
import { t } from '../../core/i18n';

export type Sample = [number, number, number, number, number]; // pts, dur, offset, size, key

export interface StreamInfo {
  kind: 'video' | 'audio';
  codec: string;
  description?: Uint8Array;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
  samples: Sample[];
}

function b64(s: unknown): Uint8Array | undefined {
  if (!s) return undefined;
  if (Array.isArray(s)) return new Uint8Array(s as number[]);
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function demux(path: string): Promise<{ video?: StreamInfo; audio?: StreamInfo }> {
  const d = await api.VideoDemux(path);
  const out: { video?: StreamInfo; audio?: StreamInfo } = {};
  for (const s of d.streams) {
    const info: StreamInfo = {
      kind: s.kind as 'video' | 'audio',
      codec: s.codec,
      description: b64(s.description),
      width: s.width ?? 0,
      height: s.height ?? 0,
      sampleRate: s.sampleRate ?? 0,
      channels: s.channels ?? 0,
      samples: s.samples as unknown as Sample[],
    };
    if (info.kind === 'video') out.video ??= info;
    else out.audio ??= info;
  }
  return out;
}

/**
 * Reads sample bytes in ~4 MB Range requests through the app's file route
 * (the page's CSP connect-src leaves out the loopback media server, which is
 * for media elements), keeping the last block.
 */
export class SampleReader {
  private block: { start: number; data: Uint8Array } | null = null;
  constructor(private url: string) {}

  async read(off: number, size: number): Promise<Uint8Array> {
    const b = this.block;
    if (b && off >= b.start && off + size <= b.start + b.data.length) return b.data.subarray(off - b.start, off - b.start + size);
    const len = Math.max(size, 4 << 20);
    const r = await fetch(this.url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
    if (!r.ok) throw new Error(t('reading video data failed ({status})', { status: String(r.status) }));
    const data = new Uint8Array(await r.arrayBuffer());
    // A server that ignores Range sends everything from 0.
    const start = r.status === 206 ? off : 0;
    this.block = { start, data };
    if (off - start + size > data.length) throw new Error(t('video data ended early'));
    return data.subarray(off - start, off - start + size);
  }
}

/** Decodes video forward and hands out the frame shown at a time; seeks via keyframes. */
export class FrameCursor {
  private dec: VideoDecoder | null = null;
  private next = 0; // next sample (decode order) to feed
  private buf: VideoFrame[] = []; // decoded, not yet reached
  private last: VideoFrame | null = null;
  private ended = false;
  private wake: (() => void) | null = null;
  private error: Error | null = null;
  private keys: number[]; // sample indices of keyframes
  constructor(
    private s: StreamInfo,
    private reader: SampleReader,
  ) {
    this.keys = s.samples.flatMap((x, i) => (x[4] ? [i] : []));
  }

  static async supported(s: StreamInfo): Promise<boolean> {
    if (!s.codec || typeof VideoDecoder === 'undefined') return false;
    try {
      return !!(await VideoDecoder.isConfigSupported(FrameCursor.config(s))).supported;
    } catch {
      return false;
    }
  }

  private static config(s: StreamInfo): VideoDecoderConfig {
    return { codec: s.codec, codedWidth: s.width || undefined, codedHeight: s.height || undefined, description: s.description, optimizeForLatency: false };
  }

  private open(from: number) {
    this.dec?.close();
    for (const f of this.buf) f.close();
    this.buf = [];
    this.last?.close();
    this.last = null;
    this.ended = false;
    this.next = from;
    this.dec = new VideoDecoder({
      output: (f) => {
        this.buf.push(f);
        this.buf.sort((a, b) => a.timestamp - b.timestamp);
        this.wake?.();
      },
      error: (e) => {
        this.error = new Error(t('video decoding failed: {error}', { error: e.message }));
        this.wake?.();
      },
    });
    this.dec.configure(FrameCursor.config(this.s));
    this.dec.addEventListener('dequeue', () => this.wake?.());
  }

  private keyBefore(t: number): number {
    let k = this.keys[0] ?? 0;
    for (const i of this.keys) if (this.s.samples[i][0] <= t + 1e-4) k = i;
    return k;
  }

  /** The frame on screen at source time t (a clone; close it), or null past the end. */
  async frameAt(t: number): Promise<VideoFrame | null> {
    const us = t * 1e6 + 500;
    const k = this.keyBefore(t);
    // Seek when going back, or when a later keyframe than what we're decoding is closer.
    if (!this.dec || (this.last && this.last.timestamp > us) || k > this.next) this.open(k);
    for (;;) {
      if (this.error) throw this.error;
      while (this.buf.length && this.buf[0].timestamp <= us) {
        this.last?.close();
        this.last = this.buf.shift()!;
      }
      if (this.buf.length || this.ended) break;
      const dec = this.dec!;
      if (this.next < this.s.samples.length && dec.decodeQueueSize < 6) {
        const [pts, dur, off, size, key] = this.s.samples[this.next++];
        const data = await this.reader.read(off, size);
        dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(pts * 1e6), duration: Math.round(dur * 1e6), data }));
        continue;
      }
      if (this.next >= this.s.samples.length) {
        await dec.flush();
        this.ended = true;
        continue;
      }
      await new Promise<void>((r) => {
        this.wake = r;
        setTimeout(r, 30);
      });
      this.wake = null;
    }
    return this.last ? this.last.clone() : null;
  }

  close() {
    this.dec?.close();
    this.dec = null;
    for (const f of this.buf) f.close();
    this.buf = [];
    this.last?.close();
    this.last = null;
  }
}

/** Decode the audio between a and b (source seconds) to planar PCM at the stream's rate. */
export async function decodeAudio(s: StreamInfo, reader: SampleReader, a: number, b: number): Promise<{ pcm: Float32Array[]; rate: number }> {
  const rate = s.sampleRate || 48000;
  const ch = Math.max(1, Math.min(2, s.channels || 2));
  const n = Math.max(1, Math.round((b - a) * rate));
  const pcm = Array.from({ length: ch }, () => new Float32Array(n));
  let failure: Error | null = null;
  const dec = new AudioDecoder({
    output: (d) => {
      const at = Math.round((d.timestamp / 1e6 - a) * rate);
      const frames = d.numberOfFrames;
      for (let c = 0; c < ch; c++) {
        const tmp = new Float32Array(frames);
        d.copyTo(tmp, { planeIndex: Math.min(c, d.numberOfChannels - 1), format: 'f32-planar' });
        for (let i = 0; i < frames; i++) {
          const j = at + i;
          if (j >= 0 && j < n) pcm[c][j] = tmp[i];
        }
      }
      d.close();
    },
    error: (e) => (failure = new Error(t('audio decoding failed: {error}', { error: e.message }))),
  });
  dec.configure({ codec: s.codec, sampleRate: rate, numberOfChannels: s.channels || 2, description: s.description });
  // Start a little early: some codecs need pre-roll to settle.
  for (const [pts, dur, off, size] of s.samples) {
    if (pts + dur < a - 0.2 || pts > b + 0.1) continue;
    const data = await reader.read(off, size);
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(pts * 1e6), duration: Math.round(dur * 1e6), data }));
    if (dec.decodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
    if (failure) break;
  }
  await dec.flush().catch(() => {});
  dec.close();
  if (failure) throw failure;
  return { pcm, rate };
}

/** A decoded picture to draw; close() when done. */
export interface Frame {
  image: CanvasImageSource & TexImageSource;
  w: number;
  h: number;
  close(): void;
}

/**
 * Frames by seeking a hidden <video> element: slower than WebCodecs but works
 * wherever the file plays (WebKitGTK's WebCodecs decoders need GStreamer
 * parsers that aren't always installed).
 */
export class ElementCursor {
  private v: HTMLVideoElement;
  private c = document.createElement('canvas');
  private ready: Promise<void>;
  constructor(url: string) {
    const v = (this.v = document.createElement('video'));
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    this.ready = new Promise((resolve, reject) => {
      v.addEventListener('loadeddata', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error(t('this video can’t be decoded here'))), { once: true });
    });
    v.src = url;
  }

  async frameAt(t: number): Promise<Frame | null> {
    const v = this.v;
    await this.ready;
    if (t > v.duration) return null;
    // A hair past the frame's start lands on it rather than the one before.
    const target = Math.min(t + 0.001, v.duration);
    if (Math.abs(v.currentTime - target) > 1e-4 || v.readyState < 2) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        v.addEventListener('seeked', done, { once: true });
        setTimeout(done, 5000);
        v.currentTime = target;
      });
    }
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (this.c.width !== w || this.c.height !== h) {
      this.c.width = w;
      this.c.height = h;
    }
    this.c.getContext('2d')!.drawImage(v, 0, 0, w, h);
    return { image: this.c, w, h, close: () => {} };
  }

  close() {
    this.v.removeAttribute('src');
    this.v.load();
  }
}

/** Frames for rendering/tracking: WebCodecs when it works, else the <video> element. */
export class Frames {
  /** WebCodecs decoding failed once this session (e.g. a missing GStreamer parser): don't retry its slow setup. */
  static webcodecsBroken = false;
  private wc: FrameCursor | null;
  private el: ElementCursor | null = null;
  private first = true;
  /** mediaUrl: for the <video> fallback; bytesUrl: the file's bytes (fileUrl). */
  constructor(
    s: StreamInfo,
    private mediaUrl: string,
    bytesUrl: string,
    webcodecs: boolean,
  ) {
    this.wc = webcodecs ? new FrameCursor(s, new SampleReader(bytesUrl)) : null;
  }

  get mode(): 'webcodecs' | 'element' {
    return this.wc ? 'webcodecs' : 'element';
  }

  static async open(s: StreamInfo, mediaUrl: string, bytesUrl: string): Promise<Frames> {
    return new Frames(s, mediaUrl, bytesUrl, !Frames.webcodecsBroken && (await FrameCursor.supported(s)));
  }

  async frameAt(t: number): Promise<Frame | null> {
    if (this.wc) {
      try {
        const f = await this.wc.frameAt(t);
        if (f || !this.first) {
          this.first = false;
          return f && { image: f, w: f.displayWidth, h: f.displayHeight, close: () => f.close() };
        }
      } catch {
        /* fall back below */
      }
      this.wc.close();
      this.wc = null;
      Frames.webcodecsBroken = true;
    }
    this.first = false;
    this.el ??= new ElementCursor(this.mediaUrl);
    return this.el.frameAt(t);
  }

  close() {
    this.wc?.close();
    this.el?.close();
  }
}

/** Fallback audio: decode the whole file (url: its fileUrl) with WebAudio once, then slice. */
export function wholeFileAudio(url: string): (a: number, b: number) => Promise<{ pcm: Float32Array[]; rate: number }> {
  let decoded: Promise<AudioBuffer> | null = null;
  return async (a, b) => {
    decoded ??= fetch(url)
      .catch((e) => Promise.reject(new Error(t('reading the audio: {error}', { error: e.message }))))
      .then((r) => r.arrayBuffer())
      .then((buf) => new OfflineAudioContext(2, 1, 48000).decodeAudioData(buf).catch((e) => Promise.reject(new Error(t('decoding the audio: {error}', { error: String(e?.message ?? e) })))));
    const ab = await decoded;
    const rate = ab.sampleRate;
    const from = Math.max(0, Math.round(a * rate));
    const to = Math.min(ab.length, Math.round(b * rate));
    const pcm = [0, 1].map((c) => ab.getChannelData(Math.min(c, ab.numberOfChannels - 1)).slice(from, Math.max(from, to)));
    return { pcm, rate };
  };
}
