// Export with effects: decode the source (WebCodecs), composite every output
// frame (compositor.ts), encode VP9/VP8 + Opus/Vorbis with the webview's
// WebCodecs encoders and mux WebM ourselves. Cuts are exact here (no keyframe
// snapping: everything is re-encoded). Lazily loaded with the first render.

import { Compositor } from './compositor';
import { frameAt, outputLength, pieces, type Project, type Range } from './project';
import { decodeAudio, demux, Frames, SampleReader, wholeFileAudio } from './source';
import { fileUrl } from '../../core/backend';
import { muxWebM, opusHead, type MuxChunk, type MuxTrack } from './webm';

export interface RenderJob {
  path: string;
  url: string; // media server URL (for <video> decoding when WebCodecs can't)
  keep: Range[];
  rotate: number;
  mute: boolean;
  project: Project;
  images: Map<string, ImageBitmap>;
  fps: number;
  onProgress: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  decoder: 'webcodecs' | 'element';
  blob: Blob;
  duration: number;
  frames: number;
  videoCodec: string;
  audioCodec: string;
}

async function pickVideoCodec(w: number, h: number, fps: number, bitrate: number): Promise<{ codec: string; mux: 'V_VP9' | 'V_VP8' }> {
  for (const [codec, mux] of [
    ['vp09.00.10.08', 'V_VP9'],
    ['vp8', 'V_VP8'],
  ] as const) {
    try {
      if ((await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps })).supported) return { codec, mux };
    } catch {
      /* try the next */
    }
  }
  throw new Error('This system can’t encode WebM video (VP9/VP8), so effects can’t be rendered here.');
}

async function pickAudioCodec(rate: number, ch: number): Promise<'opus' | 'vorbis' | null> {
  for (const codec of ['opus', 'vorbis'] as const) {
    try {
      if ((await AudioEncoder.isConfigSupported({ codec, sampleRate: rate, numberOfChannels: ch, bitrate: 128000 })).supported) return codec;
    } catch {
      /* next */
    }
  }
  return null;
}

export async function renderVideo(job: RenderJob): Promise<RenderResult> {
  let stage = 'reading the video';
  try {
    return await render(job, (s) => {
      stage = s;
      (globalThis as { __renderStage?: string }).__renderStage = s;
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new Error(`${stage}: ${(e as Error)?.message ?? e}`);
  }
}

async function render(job: RenderJob, at: (stage: string) => void): Promise<RenderResult> {
  const streams = await demux(job.path);
  const v = streams.video;
  if (!v) throw new Error('This file has no video track.');
  const bytes = fileUrl(job.path);
  const reader = new SampleReader(bytes);
  at('choosing codecs');
  const ps = pieces(job.keep, job.project);
  const total = outputLength(ps);
  const fps = Math.min(60, Math.max(10, Math.round(job.fps || 30)));
  const rot = ((job.rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  // Even sizes keep every encoder happy.
  const W = (swap ? v.height : v.width) & ~1;
  const H = (swap ? v.width : v.height) & ~1;
  const bitrate = Math.min(20e6, Math.max(1e6, W * H * fps * 0.12));
  const vc = await pickVideoCodec(W, H, fps, bitrate);
  const frames = Math.max(1, Math.round(total * fps));
  const chunks: MuxChunk[] = [];
  let encError: Error | null = null;

  // ---- video ----
  at('preparing the compositor');
  const comp = new Compositor();
  comp.resize(W, H);
  at('opening the decoders');
  for (const [id, img] of job.images) comp.setImage(id, img);
  const cursors = [await Frames.open(v, job.url, bytes), await Frames.open(v, job.url, bytes)];
  const venc = new VideoEncoder({
    output: (c) => {
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      chunks.push({ track: 1, time: c.timestamp / 1e6, key: c.type === 'key', data });
    },
    error: (e) => (encError = new Error(`video encoding failed: ${e.message}`)),
  });
  at('configuring the encoder');
  venc.configure({ codec: vc.codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' });
  at('drawing the video');
  const audioShare = streams.audio && !job.mute ? 0.15 : 0;
  try {
    for (let i = 0; i < frames; i++) {
      if (job.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      if (encError) throw encError;
      const ref = frameAt(ps, job.project, i / fps)!;
      const fa = await cursors[ref.a.piece % 2].frameAt(ref.a.t);
      const fb = ref.b ? await cursors[ref.b.piece % 2].frameAt(ref.b.t) : null;
      if (!fa) break;
      const side = (f: { image: TexImageSource; w: number; h: number }, t: number) => ({ frame: f.image, frameW: f.w, frameH: f.h, t });
      comp.render({ a: side(fa, ref.a.t), b: fb && ref.b ? { ...side(fb, ref.b.t), kind: ref.b.kind, progress: ref.b.progress } : null, light: ref.light, rotate: rot, layers: job.project.layers });
      fa.close();
      fb?.close();
      const frame = new VideoFrame(comp.canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 1));
      job.onProgress(i + 1, Math.ceil(frames / (1 - audioShare)));
    }
    await venc.flush();
  } finally {
    venc.close();
    for (const c of cursors) c.close();
    comp.destroy();
  }
  if (encError) throw encError;
  const tracks: MuxTrack[] = [{ kind: 'video', codec: vc.mux, width: W, height: H }];

  // ---- audio ----
  at('mixing the audio');
  let audioCodec = '';
  if (streams.audio && !job.mute) {
    const a = streams.audio;
    const outRate = 48000;
    const codec = await pickAudioCodec(outRate, 2);
    if (codec) {
      // WebCodecs first; WebAudio on the whole file when this system's decoder can't.
      const fallback = wholeFileAudio(bytes);
      let useFallback = false;
      const decode = async (x: number, y: number) => {
        if (!useFallback) {
          try {
            return await decodeAudio(a, reader, x, y);
          } catch {
            useFallback = true;
          }
        }
        return fallback(x, y);
      };
      // Decode each part here (decoders live on this thread), stretch and mix in a worker.
      const parts: { pcm: Float32Array[]; rate: number }[] = [];
      for (const pc of ps) {
        if (job.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
        parts.push(await decode(pc.src[0], pc.src[1]));
      }
      const { default: MixWorker } = await import('./mixWorker?worker');
      const w: Worker = new MixWorker();
      const pcm = await new Promise<Float32Array[]>((resolve, reject) => {
        w.onmessage = (e) => resolve(e.data);
        w.onerror = (e) => reject(new Error(e.message || 'mixing failed'));
        w.postMessage({ pieces: ps, project: job.project, parts, total, outRate }, parts.flatMap((p) => p.pcm.map((c) => c.buffer)));
      }).finally(() => w.terminate());
      let desc: Uint8Array | undefined;
      const aenc = new AudioEncoder({
        output: (c, meta) => {
          const data = new Uint8Array(c.byteLength);
          c.copyTo(data);
          chunks.push({ track: 2, time: c.timestamp / 1e6, key: true, data });
          if (meta?.decoderConfig?.description && !desc) desc = new Uint8Array(meta.decoderConfig.description as ArrayBuffer);
        },
        error: (e) => (encError = new Error(`audio encoding failed: ${e.message}`)),
      });
      aenc.configure({ codec, sampleRate: outRate, numberOfChannels: 2, bitrate: 128000 });
      const block = 960 * 10;
      const n = pcm[0].length;
      for (let s = 0; s < n; s += block) {
        const len = Math.min(block, n - s);
        const data = new Float32Array(len * 2);
        data.set(pcm[0].subarray(s, s + len), 0);
        data.set(pcm[1].subarray(s, s + len), len);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: outRate, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((s / outRate) * 1e6), data });
        aenc.encode(ad);
        ad.close();
        if (aenc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
      await aenc.flush();
      aenc.close();
      if (encError) throw encError;
      tracks.push({ kind: 'audio', codec: codec === 'opus' ? 'A_OPUS' : 'A_VORBIS', sampleRate: outRate, channels: 2, private: codec === 'opus' ? opusHead(2, outRate) : desc });
      audioCodec = codec;
    }
  }
  job.onProgress(1, 1);
  at('writing the file');
  const parts = muxWebM(tracks, chunks, total);
  return { decoder: cursors[0].mode, blob: new Blob(parts as BlobPart[], { type: 'video/webm' }), duration: total, frames, videoCodec: vc.codec, audioCodec };
}
