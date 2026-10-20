// M12: audio — WAV/MP3/FLAC/OGG open with waveform, tags and cover; playback
// through the loopback media server (muted: autoplay rules) skips deleted
// parts; delete/undo/redo, fades, gain, normalize; save as WAV and FLAC
// (verified by reopening); lossless MP3 cut keeps tags and cover; Opus plays
// without editing; a 10-minute file opens without UI stalls.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { Peaks } from '../modules/audio/waveform';
import type { Player } from '../modules/audio/player';
import type { Timeline } from '../modules/audio/edits';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  opened: () => Awaited<ReturnType<typeof api.AudioOpen>> | null;
  loading: () => boolean;
  error: () => string;
  peaks: () => Peaks | null;
  timeline: () => Timeline;
  total: () => number;
  rate: () => number;
  sel: () => [number, number] | null;
  setSel: (a: number, b: number) => void;
  pos: () => number;
  playing: () => boolean;
  player: () => Player | null;
  seek: (x: number) => void;
  toggle: () => void;
  edit: (op: string) => Promise<void>;
  exportTo: (dest: string, fmt: 'wav' | 'flac' | 'mp3', retarget: boolean) => Promise<boolean>;
  normalizeInfo: () => { peak: number; factor: number };
}
const hooks = (t: Tab) => (t as unknown as { audioTest?: Hooks }).audioTest;

async function open(p: string, wantPeaks = true): Promise<{ tab: Tab; h: Hooks; ms: number; jank: number; peaksMs: number }> {
  const t0 = performance.now();
  let tab!: Tab;
  let peaksMs = 0;
  const jank = await measureJank(async () => {
    tab = (await workspace.openPath(p))!;
    await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), `${p} opened`, 20000);
    if (wantPeaks) {
      await waitFor(() => (hooks(tab)!.peaks()?.done ? true : null), `${p} waveform`, 60000);
      peaksMs = Math.round(performance.now() - t0);
    }
  });
  const h = hooks(tab)!;
  assertEq(h.error(), '', `no error for ${p}`);
  assertEq(tab.moduleId, 'audio', 'audio module');
  return { tab, h, ms: Math.round(performance.now() - t0), jank: Math.round(jank.maxGap), peaksMs };
}

/** Loudest sample of lane 0 around output second t (from the waveform peaks, through the edits). */
function levelAt(h: Hooks, t: number): number {
  const rate = h.rate();
  const x = Math.round(t * rate);
  let max = 0;
  let pos = 0;
  const mm: [number, number] = [0, 0];
  for (const s of h.timeline()) {
    const L = s.end - s.start;
    if (x >= pos && x < pos + L) {
      if (s.silence) return 0;
      const src = s.start + (x - pos);
      h.peaks()!.range(src - 400, src + 400, 0, mm);
      let g = 1;
      for (const r of s.gains ?? []) g *= r.g0 + (r.g1 - r.g0) * ((x - pos) / L);
      max = Math.max(Math.abs(mm[0]), Math.abs(mm[1])) * g;
    }
    pos += L;
  }
  return max;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

async function reopenInfo(p: string) {
  const o = await api.AudioOpen(p);
  void api.AudioClose(o.id);
  return o.info!;
}

export default async function m12(dir: string) {
  const A = join(dir, 'audio');

  // --- WAV: waveform, playback, edits ---
  const w = await open(join(A, 'tones.wav'));
  log(`wav opened in ${w.ms} ms, waveform after ${w.peaksMs} ms, longest UI frame ${w.jank} ms`);
  const o = w.h.opened()!;
  assertEq(`${o.info!.codec}/${o.info!.sampleRate}/${o.info!.channels}/${o.info!.frames}/${o.lanes}`, 'wav/48000/2/144000/2', 'wav info');
  assert(o.url.startsWith('http://127.0.0.1:'), `media served over loopback (${o.url})`);
  assert(near(levelAt(w.h, 0.5), 0.5, 0.02) && near(levelAt(w.h, 1.5), 0.25, 0.02), `waveform levels ${levelAt(w.h, 0.5).toFixed(3)} / ${levelAt(w.h, 1.5).toFixed(3)}`);

  // Playback (muted, so no user gesture is needed).
  const p = w.h.player()!;
  p.el.muted = true;
  w.h.seek(0);
  w.h.toggle();
  await waitFor(() => (w.h.pos() > 0.3 * 48000 ? true : null), 'playback advances', 5000);
  w.h.toggle();
  assert(!w.h.playing(), 'paused');

  // Delete 1–2 s (the 880 Hz part): 2 s left, levels follow.
  w.h.setSel(48000, 96000);
  await w.h.edit('delete');
  assertEq(w.h.total(), 96000, 'deleted one second');
  assert(w.tab.dirty, 'dirty after an edit');
  assert(near(levelAt(w.h, 1.5), 0.5, 0.02), 'the 220 Hz part follows the cut');
  // Playing across the cut jumps over it in the source.
  w.h.seek(0.8 * 48000);
  w.h.toggle();
  await waitFor(() => (w.h.pos() > 1.15 * 48000 ? true : null), 'plays across the cut', 5000);
  const t = p.el.currentTime;
  w.h.toggle();
  assert(t >= 2.0 && t < 2.6, `element skipped the deleted second (source time ${t.toFixed(2)} s)`);

  await w.h.edit('undo');
  assertEq(w.h.total(), 144000, 'undo restores');
  assert(!w.tab.dirty, 'clean after undoing everything');
  await w.h.edit('redo');
  assertEq(w.h.total(), 96000, 'redo');

  // Fade out the last half second, then −6 dB on the first second.
  w.h.setSel(72000, 96000);
  await w.h.edit('fadeOut');
  assert(levelAt(w.h, 1.99) < 0.05 && near(levelAt(w.h, 1.25), 0.5, 0.03), `fade out (${levelAt(w.h, 1.99).toFixed(3)})`);
  w.h.setSel(0, 48000);
  const prompt = (await import('../core/ui.svelte')).ui;
  const realPrompt = prompt.prompt;
  prompt.prompt = async () => '-6';
  await w.h.edit('gain');
  assert(near(levelAt(w.h, 0.5), 0.25, 0.02), `−6 dB (${levelAt(w.h, 0.5).toFixed(3)})`);
  // Normalize everything to −1 dBFS: the loudest part (0.5) → 0.891.
  w.h.setSel(0, 0);
  prompt.prompt = async () => '-1';
  await w.h.edit('normalize');
  prompt.prompt = realPrompt;
  const ni = w.h.normalizeInfo();
  assert(near(ni.peak, 0.5, 0.01) && near(levelAt(w.h, 1.25), 0.891, 0.02), `normalize: peak ${ni.peak.toFixed(3)}, now ${levelAt(w.h, 1.25).toFixed(3)}`);

  // Save as WAV, reopen: edits baked in.
  const outWav = join(A, 'edited.wav');
  assert(await w.h.exportTo(outWav, 'wav', true), 'saved WAV');
  await waitFor(() => (w.h.peaks()?.done && w.tab.filePath === outWav ? true : null), 'saved WAV reopened', 20000);
  assertEq(`${w.h.opened()!.info!.frames}/${w.h.total()}/${w.tab.dirty}`, '96000/96000/false', 'saved WAV length, clean tab');
  assert(near(levelAt(w.h, 0.5), 0.447, 0.02) && near(levelAt(w.h, 1.25), 0.891, 0.02), `saved levels ${levelAt(w.h, 0.5).toFixed(3)} / ${levelAt(w.h, 1.25).toFixed(3)}`);
  // FLAC export of the trimmed first half second.
  w.h.setSel(0, 24000);
  await w.h.edit('trim');
  const outFlac = join(A, 'edited.flac');
  assert(await w.h.exportTo(outFlac, 'flac', false), 'saved FLAC');
  const fi = await reopenInfo(outFlac);
  assertEq(`${fi.codec}/${fi.frames}/${fi.bitDepth}/${fi.channels}`, 'flac/24000/16/2', 'FLAC output');
  await workspace.close(w.tab, { force: true });

  // --- MP3: tags, cover, lossless cut ---
  const m = await open(join(A, 'tone.mp3'));
  const mi = m.h.opened()!.info!;
  assert(mi.codec === 'mp3' && mi.tags.title === 'Tone' && mi.tags.artist === 'Fixture' && mi.hasCover, `mp3 tags/cover ${JSON.stringify(mi.tags)}`);
  assert(!!document.querySelector('.cover img'), 'cover shown');
  m.h.setSel(10000, 30000);
  await m.h.edit('delete');
  const before = mi.frames;
  assert(await m.h.exportTo(m.tab.filePath!, 'mp3', false), 'mp3 saved in place');
  await waitFor(() => (m.h.peaks()?.done ? true : null), 'mp3 reopened', 20000);
  const after = m.h.opened()!.info!;
  assert(after.codec === 'mp3' && after.frames < before - 18000 && after.frames > before - 22000 && after.tags.title === 'Tone' && after.hasCover, `lossless cut ${before} → ${after.frames} frames, tags kept`);
  await workspace.close(m.tab, { force: true });

  // --- OGG Vorbis and FLAC open ---
  for (const f of ['tone.ogg', 'tone.flac']) {
    const x = await open(join(A, f));
    assert(x.h.opened()!.info!.editable && near(levelAt(x.h, 0.5), 0.125, 0.02), `${f} editable with waveform (${levelAt(x.h, 0.5).toFixed(3)})`);
    await workspace.close(x.tab, { force: true });
  }

  // --- Opus: plays, not editable ---
  const op = await open(join(A, 'tone.opus'), false);
  assert(!op.h.opened()!.info!.editable && !!op.h.opened()!.info!.reason, 'opus is play-only');
  await waitFor(() => (op.h.total() > 0 ? true : null), 'opus duration from the player', 5000);
  await workspace.close(op.tab, { force: true });

  // --- AAC (.m4a): play-only; whether it plays depends on the system's codecs ---
  const aac = (await workspace.openPath(join(A, 'tone.m4a')))!;
  await waitFor(() => (hooks(aac) && !hooks(aac)!.loading() ? true : null), 'm4a opened', 10000);
  await waitFor(() => (hooks(aac)!.total() > 0 || hooks(aac)!.error() ? true : null), 'm4a plays or explains', 8000);
  const ah = hooks(aac)!;
  assert(!ah.opened()?.info?.editable, 'm4a is play-only');
  log(`m4a: ${ah.error() || 'plays on this system'}; title tag "${ah.opened()?.info?.tags.title ?? ''}"`);
  await workspace.close(aac, { force: true });

  // --- 10-minute file: opens immediately, waveform streams in ---
  const l = await open(join(A, 'long.wav'));
  log(`10-min wav opened in ${l.ms} ms (playable right away), waveform complete after ${l.peaksMs} ms, longest UI frame ${l.jank} ms`);
  assertEq(l.h.total(), 22050 * 600, '10-minute length');
  await workspace.close(l.tab, { force: true });
}
