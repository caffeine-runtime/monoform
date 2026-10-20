// M13: video — WebM/MP4/MKV open with info, keyframes and thumbnails;
// muted playback skips a cut part; undo/redo; save as (WebM) verified by
// reopening; rotation refused for WebM; MP4 rotate + remove audio + trim saved
// in place; H.264 can be edited even where it can't be played; audio
// extraction; frames are readable for snapshots.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { Range, VideoEdit } from '../modules/video/edits';
import type { VideoOp } from '../modules/video/views';
import { ui } from '../core/ui.svelte';
import { tick } from 'svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  opened: () => Awaited<ReturnType<typeof api.VideoOpen>> | null;
  loading: () => boolean;
  error: () => string;
  playError: () => string;
  el: () => HTMLVideoElement | undefined;
  time: () => number;
  playing: () => boolean;
  edit: () => VideoEdit;
  kept: () => Range[];
  sel: () => Range | null;
  setSel: (a: number, b: number) => void;
  seek: (t: number) => void;
  toggle: () => void;
  doEdit: (op: VideoOp) => void;
  exportTo: (dest: string, audioOnly?: boolean) => Promise<boolean>;
  save: () => Promise<boolean>;
  natural: () => { w: number; h: number };
}
const hooks = (t: Tab) => (t as unknown as { videoTest?: Hooks }).videoTest;

async function open(p: string): Promise<{ tab: Tab; h: Hooks; ms: number; jank: number }> {
  const t0 = performance.now();
  let tab!: Tab;
  const jank = await measureJank(async () => {
    tab = (await workspace.openPath(p))!;
    await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), `${p} opened`, 15000);
  });
  const h = hooks(tab)!;
  assertEq(h.error(), '', `no error for ${p}`);
  assertEq(tab.moduleId, 'video', 'video module');
  return { tab, h, ms: Math.round(performance.now() - t0), jank: Math.round(jank.maxGap) };
}

async function reopen(p: string) {
  const o = await api.VideoOpen(p);
  void api.MediaRelease(o.url);
  return o.info!;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export default async function m13(dir: string) {
  const V = join(dir, 'video');

  // --- WebM ---
  const w = await open(join(V, 'clip.webm'));
  const wi = w.h.opened()!.info!;
  log(`webm opened in ${w.ms} ms, longest UI frame ${w.jank} ms`);
  assert(wi.editable && wi.container === 'matroska' && wi.videoCodec === 'VP9' && wi.width === 320 && near(wi.duration, 6, 0.1), `webm info ${JSON.stringify({ ...wi, keyframes: wi.keyframes.length })}`);
  assertEq(wi.keyframes.map((k) => Math.round(k)).join(','), '0,1,2,3,4,5', 'keyframes');
  await waitFor(() => (w.h.natural().w === 320 ? true : null), 'video metadata', 8000);
  const el = w.h.el()!;
  // Frames are readable (CORS from the media server): snapshot and thumbnails work.
  await waitFor(() => (el.readyState >= 2 ? true : null), 'first frame', 5000);
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const g = c.getContext('2d')!;
  g.drawImage(el, 0, 0, 32, 18);
  const px = g.getImageData(0, 0, 32, 18).data;
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) lit += px[i] + px[i + 1] + px[i + 2] > 60 ? 1 : 0;
  assert(lit > 50, `video frame readable (${lit} lit pixels)`);
  await waitFor(() => {
    const s = document.querySelector<HTMLCanvasElement>('.timeline .strip');
    if (!s || !s.width) return null;
    const d = s.getContext('2d')!.getImageData(0, 0, s.width, s.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) n += d[i + 3] > 0 ? 1 : 0;
    return n > 100 ? true : null;
  }, 'thumbnail strip drawn', 15000);

  // Cut 1–3 s, then play across it (muted: autoplay rules).
  w.h.setSel(1.0, 3.0);
  await tick();
  const view = () => document.querySelector('.tabview.active') as HTMLElement;
  assertEq(view().querySelectorAll('.timeline .sel .handle').length, 2, 'selection has two drag handles');
  assert(view().querySelector('.selbar')?.textContent?.includes('Selected 0:02'), 'selection bar says how much is selected');
  w.h.doEdit('cut');
  const keptAfterCut = '[[0,1],[3,6.001]]'.replace('6.001', String(wi.duration));
  assertEq(JSON.stringify(w.h.kept()), keptAfterCut, 'kept after the cut');
  await tick();
  assert(view().querySelector('.timeline .flash'), 'the cut part flashes on the timeline');
  assert(view().querySelector('.timeline .gone .gone-label')?.textContent === 'removed', 'removed part is labelled');
  const toast = ui.toasts.find((t) => t.message.startsWith('Cut out 0:02'));
  assert(toast?.action?.label === 'Undo', `cut toast with Undo (${ui.toasts.map((t) => t.message).join(' | ')})`);
  (view().querySelector('.timeline .gone .restore') as HTMLButtonElement).click();
  assertEq(w.h.kept().length, 1, 'restore button puts the part back');
  w.h.doEdit('undo');
  assertEq(JSON.stringify(w.h.kept()), keptAfterCut, 'undo restore');
  assert(w.tab.dirty, 'dirty');
  el.muted = true;
  w.h.seek(0.7);
  w.h.toggle();
  let sawInside = false;
  await waitFor(() => {
    const t = w.h.time();
    if (t > 1.15 && t < 2.9) sawInside = true;
    return t > 3.2 ? true : null;
  }, 'playback crosses the cut', 8000);
  w.h.toggle();
  assert(!sawInside, 'playback skipped the cut part');
  w.h.doEdit('undo');
  assertEq(w.h.kept().length, 1, 'undo');
  assert(!w.tab.dirty, 'clean after undo');
  w.h.doEdit('redo');
  // WebM can't carry rotation.
  w.h.doEdit('rotate');
  assertEq(w.h.edit().rotate, 0, 'rotation refused for WebM');
  const outWebm = join(V, 'edited.webm');
  assert(await w.h.exportTo(outWebm), 'saved webm');
  const ow = await reopen(outWebm);
  assert(near(ow.duration, 4, 0.1) && ow.hasAudio && ow.hasVideo && ow.keyframes.length === 4, `saved webm ${ow.duration.toFixed(2)} s, ${ow.keyframes.length} keyframes`);
  // Audio only.
  const outAudio = join(V, 'clip.weba');
  assert(await w.h.exportTo(outAudio, true), 'extracted audio');
  const oa = await reopen(outAudio);
  assert(oa.hasAudio && !oa.hasVideo && near(oa.duration, 4, 0.15), `audio only ${JSON.stringify({ a: oa.hasAudio, v: oa.hasVideo, d: oa.duration })}`);
  await workspace.close(w.tab, { force: true });

  // --- MP4 (VP9 inside): rotate, remove audio, trim; save in place ---
  const m = await open(join(V, 'clip.mp4'));
  m.h.doEdit('rotate');
  m.h.doEdit('removeAudio');
  m.h.setSel(2, 4);
  m.h.doEdit('keep');
  assert(m.h.edit().rotate === 90 && m.h.edit().mute, 'rotate + remove audio queued');
  await waitFor(() => (m.h.natural().w ? true : null), 'mp4 metadata', 8000);
  assert(document.querySelector<HTMLVideoElement>('.stage video')!.style.transform.includes('rotate(90deg)'), 'rotation previewed');
  assert(await m.h.save(), 'mp4 saved in place');
  await waitFor(() => (!m.h.loading() && m.h.opened() ? true : null), 'mp4 reopened', 10000);
  const mi = m.h.opened()!.info!;
  assert(near(mi.duration, 2, 0.1) && mi.rotation === 90 && !mi.hasAudio && mi.hasVideo && !m.tab.dirty, `saved mp4 ${JSON.stringify({ d: mi.duration, r: mi.rotation, a: mi.hasAudio })}`);
  await workspace.close(m.tab, { force: true });

  // --- H.264: editable even if this system can't play it ---
  const h = await open(join(V, 'h264.mp4'));
  await sleep(1500);
  log(`h264: ${h.h.playError() || 'plays on this system'}`);
  h.h.setSel(3, 6);
  h.h.doEdit('keep');
  const outH = join(V, 'h264 part.mp4');
  assert(await h.h.exportTo(outH), 'saved h264 part');
  const oh = await reopen(outH);
  assert(near(oh.duration, 3, 0.1) && oh.videoCodec === 'H.264' && oh.audioCodec === 'AAC', `h264 part ${oh.duration.toFixed(2)} s`);
  await workspace.close(h.tab, { force: true });

  // --- MKV opens with info ---
  const k = await open(join(V, 'clip.mkv'));
  const ki = k.h.opened()!.info!;
  assert(ki.editable && ki.videoCodec === 'VP8' && ki.audioCodec === 'Vorbis' && near(ki.duration, 4, 0.1), 'mkv info');
  await workspace.close(k.tab, { force: true });
}
