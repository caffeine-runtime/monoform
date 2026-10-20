// M15: video effects — image overlay animated by keyframes, area blur,
// speed change, crossfade at a cut, fades; live preview through the
// compositor; tracking pipeline; render to WebM (WebCodecs) verified by
// probing the output and decoding a frame of it.
import { api, fileUrl } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { Layer, Project } from '../modules/video/project';
import { tick } from 'svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, waitFor } from './harness';

interface Hooks {
  loading: () => boolean;
  opened: () => Awaited<ReturnType<typeof api.VideoOpen>> | null;
  natural: () => { w: number; h: number };
  el: () => HTMLVideoElement | undefined;
  seek: (t: number) => void;
  setSel: (a: number, b: number) => void;
  doEdit: (op: string) => void;
  fx: () => Project;
  setFx: (p: Project) => void;
  addImageBitmap: (b: ImageBitmap, name: string, at?: { x: number; y: number }) => Promise<void>;
  addBlur: () => void;
  trackLayer: (l: Layer) => Promise<boolean>;
  renderTo: (dest: string) => Promise<boolean>;
  drawNow: () => Promise<void>;
  fxCanvas: () => HTMLCanvasElement | undefined;
  outLen: () => number;
}
const hooks = (t: Tab) => (t as unknown as { videoTest?: Hooks }).videoTest;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function pixel(c: CanvasImageSource, x: number, y: number, w: number, h: number): number[] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.drawImage(c as CanvasImageSource, 0, 0, w, h);
  return [...g.getImageData(x, y, 1, 1).data];
}

export default async function m15(dir: string) {
  const V = join(dir, 'video');
  const tab = (await workspace.openPath(join(V, 'clip.webm')))!;
  await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), 'webm opened', 15000);
  const h = hooks(tab)!;
  await waitFor(() => (h.natural().w === 320 && (h.el()?.readyState ?? 0) >= 2 ? true : null), 'first frame', 8000);

  // ---- overlay image, animated from left to right over 0–2 s ----
  const red = document.createElement('canvas');
  red.width = red.height = 40;
  const rg = red.getContext('2d')!;
  rg.fillStyle = '#ff0000';
  rg.fillRect(0, 0, 40, 40);
  h.setSel(0, 6);
  await h.addImageBitmap(await createImageBitmap(red), 'Red', { x: 60, y: 90 });
  let fx = h.fx();
  assertEq(fx.layers.length, 1, 'image overlay added');
  const img = fx.layers[0];
  assertEq(`${img.w}x${img.h}`, '40x40', 'small image keeps its size');
  h.setFx({ ...fx, layers: [{ ...img, keys: [{ ...img.keys[0], t: 0, x: 60 }, { ...img.keys[0], t: 2, x: 260, ease: 'linear' }] }] });

  // Live preview: the compositor draws the overlay where the keys say.
  h.seek(1);
  await waitFor(() => (h.el()!.seeking ? null : true), 'seeked', 3000);
  await h.drawNow();
  const cv = h.fxCanvas()!;
  assert(cv.offsetParent !== null, 'effects canvas shown');
  const mid = pixel(cv, 160, 90, 320, 180);
  assert(mid[0] > 200 && mid[1] < 60 && mid[2] < 60, `overlay at x≈160 at 1 s (${mid})`);
  const left = pixel(cv, 60, 90, 320, 180);
  assert(!(left[0] > 200 && left[1] < 60 && left[2] < 60), 'overlay has moved away from its start');

  // ---- area blur ----
  h.addBlur();
  fx = h.fx();
  assertEq(fx.layers.length, 2, 'blur added');
  const blur: Layer = { ...fx.layers[1], start: 0, end: 6, blur: { ...fx.layers[1].blur!, shape: 'rect', amount: 30, feather: 0 }, keys: [{ ...fx.layers[1].keys[0], x: 160, y: 50 }], w: 80, h: 40 };
  h.setFx({ ...fx, layers: [fx.layers[0], blur] });
  await h.drawNow();
  // The yellow/blue bar edge at x=160 is softened inside the blur area, sharp outside it.
  const inBlur = pixel(cv, 158, 50, 320, 180);
  const outside = pixel(cv, 158, 150, 320, 180);
  assert(!(inBlur[0] > 200 && inBlur[1] > 200 && inBlur[2] < 60), `edge softened inside the blur (${inBlur})`);
  log(`blur: inside ${inBlur}, outside ${outside}`);

  // ---- speed, cut + crossfade, fades ----
  fx = h.fx();
  h.setFx({ ...fx, speeds: [{ a: 0, b: 2, rate: 2 }] });
  h.setSel(3, 4);
  h.doEdit('cut');
  fx = h.fx();
  h.setFx({ ...fx, transitions: [{ at: 3, kind: 'crossfade', dur: 0.5 }], fadeIn: 0.5, fadeOut: 0.5 });
  // 0–2 s at 2× (1 s) + 2–3 (1 s) + 4–6 (2 s) − 0.5 s overlap = 3.5 s
  assert(near(h.outLen(), 3.5, 0.01), `output length ${h.outLen()}`);
  await tick();
  assert(document.querySelector('.tabview.active .timeline .join.has'), 'transition marker on the timeline');
  assert(document.querySelector('.tabview.active .timeline .speedband'), 'speed band on the timeline');
  assertEq(document.querySelectorAll('.tabview.active .tracks .row').length, 2, 'two overlay tracks');

  // ---- render ----
  const out = join(V, 'effects.webm');
  const r0 = performance.now();
  const rj = await measureJank(async () => assert(await h.renderTo(out), `rendered (${ui.toasts.map((t) => t.message).join(' | ')})`));
  log(`render ${Math.round(performance.now() - r0)} ms, longest UI frame ${Math.round(rj.maxGap)} ms`);
  const o = await api.VideoOpen(out);
  const info = o.info!;
  log(`rendered: ${info.videoCodec} ${info.width}×${info.height} ${info.fps} fps ${info.duration.toFixed(2)} s, audio ${info.audioCodec || 'none'}`);
  assert(info.editable && info.container === 'matroska' && (info.videoCodec === 'VP9' || info.videoCodec === 'VP8') && info.width === 320 && info.height === 180, 'output is WebM VP9/VP8 at the source size');
  assert(near(info.duration, 3.5, 0.15), `output duration ${info.duration}`);
  assert(info.hasAudio && info.audioCodec === 'Opus', `output audio ${info.audioCodec}`);
  // Decode a frame of the output: the red overlay is there (at output 0.5 s = source 1 s at 2×: x≈160).
  const { demux, Frames } = await import('../modules/video/source');
  const st = await demux(out);
  assert(st.video && Math.abs(st.video.samples.length - 3.5 * 25) <= 2, `frames in output: ${st.video?.samples.length}`);
  const cur = await Frames.open(st.video!, o.url, fileUrl(out));
  const f = (await cur.frameAt(0.5))!;
  const p = pixel(f.image as HTMLCanvasElement, 160, 90, 320, 180);
  log(`output decoded via ${cur.mode}`);
  f.close();
  cur.close();
  void api.MediaRelease(o.url);
  assert(p[0] > 180 && p[1] < 80 && p[2] < 80, `overlay rendered into the output (${p})`);
  assert(!tab.dirty, 'rendered edits count as saved');

  await workspace.close(tab, { force: true });

  // ---- pin to a moving object: track.webm has a 28 px bars patch at
  // x = 16 + 60·t, y = 40 + 10·sin(3t) (top-left) on grey ----
  const tt = (await workspace.openPath(join(V, 'track.webm')))!;
  await waitFor(() => (hooks(tt) && !hooks(tt)!.loading() ? true : null), 'track.webm opened', 15000);
  const th = hooks(tt)!;
  await waitFor(() => (th.natural().w === 192 && (th.el()?.readyState ?? 0) >= 2 ? true : null), 'track.webm frame', 8000);
  th.seek(0);
  th.addBlur();
  const bl = th.fx().layers[0];
  const centre = (t: number) => [16 + 60 * t + 14, 40 + 10 * Math.sin(3 * t) + 14];
  th.setFx({ ...th.fx(), layers: [{ ...bl, start: 0, end: 2, w: 28, h: 28, keys: [{ ...bl.keys[0], t: 0, x: centre(0)[0], y: centre(0)[1] }] }] });
  const t0 = performance.now();
  const tj = await measureJank(async () => assert(await th.trackLayer(th.fx().layers[0]), 'tracking ran'));
  const tracked = th.fx().layers[0];
  const err = Math.max(...tracked.keys.map((k) => Math.hypot(k.x - centre(k.t)[0], k.y - centre(k.t)[1])));
  log(`tracking: ${tracked.keys.length} positions in ${Math.round(performance.now() - t0)} ms (longest UI frame ${Math.round(tj.maxGap)} ms), max error ${err.toFixed(1)} px`);
  assert(tracked.tracked && tracked.keys.length >= 45, `tracked the whole 2 s (${tracked.keys.length} keys)`);
  assert(err < 3, `follows the moving object (max error ${err.toFixed(1)} px)`);
  await workspace.close(tt, { force: true });
}
