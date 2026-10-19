// Reports webview capabilities that shape feature designs.
import { log } from './harness';

export default async function caps() {
  const c = document.createElement('canvas');
  const gl2 = !!c.getContext('webgl2');
  const gl1 = !!document.createElement('canvas').getContext('webgl');
  const g = globalThis as any;
  const ctx = document.createElement('canvas').getContext('2d') as any;
  const v = document.createElement('video');
  const a = document.createElement('audio');
  const types: Record<string, string> = {
    mp4h264: v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
    webmvp9: v.canPlayType('video/webm; codecs="vp9, opus"'),
    mkv: v.canPlayType('video/x-matroska'),
    mp3: a.canPlayType('audio/mpeg'),
    flac: a.canPlayType('audio/flac'),
    ogg: a.canPlayType('audio/ogg; codecs="vorbis"'),
    opus: a.canPlayType('audio/ogg; codecs="opus"'),
    aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    wav: a.canPlayType('audio/wav'),
  };
  let enc = 'n/a';
  if (g.VideoEncoder) {
    const r: string[] = [];
    for (const codec of ['avc1.42001f', 'vp8', 'vp09.00.10.08', 'av01.0.04M.08']) {
      try {
        const s = await g.VideoEncoder.isConfigSupported({ codec, width: 640, height: 360, bitrate: 1e6, framerate: 30 });
        r.push(`${codec}:${s.supported}`);
      } catch (e) {
        r.push(`${codec}:err`);
      }
    }
    enc = r.join(' ');
  }
  let dec = 'n/a';
  if (g.VideoDecoder) {
    try {
      dec = String((await g.VideoDecoder.isConfigSupported({ codec: 'avc1.42001f' })).supported);
    } catch {
      dec = 'err';
    }
  }
  log(`caps: webgl2=${gl2} webgl=${gl1} offscreen=${typeof g.OffscreenCanvas} offscreenWebgl=${g.OffscreenCanvas ? !!new g.OffscreenCanvas(4, 4).getContext('webgl2') : false} ctxFilter=${ctx && 'filter' in ctx} clipboardWrite=${!!navigator.clipboard?.write} ClipboardItem=${typeof g.ClipboardItem} AudioContext=${typeof g.AudioContext} AudioEncoder=${typeof g.AudioEncoder} VideoEncoder=${typeof g.VideoEncoder} VideoDecoder=${typeof g.VideoDecoder} MediaRecorder=${typeof g.MediaRecorder} queryLocalFonts=${typeof g.queryLocalFonts}`);
  log(`caps: media ${JSON.stringify(types)}`);
  log(`caps: webcodecs enc ${enc}; dec avc ${dec}`);
  if (gl2) {
    const gl = c.getContext('webgl2')!;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    log(`caps: gl renderer ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)} maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
  }
  if (ctx) {
    ctx.filter = 'saturate(0)';
    log(`caps: ctx.filter after set = ${ctx.filter}`);
  }
  try {
    const blob = await new Promise<Blob>((r) => document.createElement('canvas').toBlob((b) => r(b!), 'image/png'));
    await navigator.clipboard.write([new g.ClipboardItem({ 'image/png': blob })]);
    log('caps: clipboard image write ok');
  } catch (e) {
    log(`caps: clipboard image write failed: ${e}`);
  }
}
