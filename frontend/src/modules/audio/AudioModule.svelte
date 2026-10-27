<script lang="ts" module>
  import type { Segment as EditSegment } from './edits';
  /** Audio clipboard (segments refer to the file they were copied from). */
  let clip: { id: string; segs: EditSegment[] } | null = null;
</script>

<script lang="ts">
  import Save from '@lucide/svelte/icons/save';
  import Pencil from '@lucide/svelte/icons/pencil';
  import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
  import { fitBar } from '../../core/fit';
  import { saveAndConvert } from '../../core/convert.svelte';
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Square from '@lucide/svelte/icons/square';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Music from '@lucide/svelte/icons/music';
  import type { Tab } from '../../core/tabs.svelte';
  import { api, endpoint } from '../../core/backend';
  import { basename, dirname, extname, join, stem } from '../../core/paths';
  import { ui, toastError, menu } from '../../core/ui.svelte';
  import { jobs } from '../../core/jobs.svelte';
  import { formatShortcut } from '../../core/keys';
  import { t } from '../../core/i18n';
  import * as E from './edits';
  import { Peaks, drawWave, formatTime, tickStep, PEAK_FRAMES, type View } from './waveform';
  import { Player } from './player';
  import { audioViews, type AudioView } from './views';
  import { peek } from '../../core/peek.svelte';

  type Opened = Awaited<ReturnType<typeof api.AudioOpen>>;

  let { tab }: { tab: Tab } = $props();

  let opened = $state.raw<Opened | null>(null);
  const info = $derived(opened?.info);
  let peaks = $state.raw<Peaks | null>(null);
  let timeline = $state.raw<E.Timeline>([]);
  let undoStack: E.Timeline[] = [];
  let redoStack: E.Timeline[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let frames = $state(0);
  let rate = $state(44100);
  let sel = $state<[number, number] | null>(null);
  let pos = $state(0);
  let playing = $state(false);
  let loopOn = $state(false);
  let volume = $state(1);
  let speed = $state(1);
  let view = $state<View>({ start: 0, fpp: 1000 });
  let width = $state(0);
  let height = $state(0);
  let loading = $state(true);
  let error = $state('');
  let peakProgress = $state(0);
  let player: Player | null = null;
  let canvas = $state<HTMLCanvasElement>();
  let area = $state<HTMLDivElement>();
  const RULER = 20;

  const total = $derived(E.length(timeline));
  const editable = $derived(!!info?.editable);
  const hasSel = $derived(!!sel && sel[1] > sel[0]);
  const coverUrl = $derived(opened && info?.hasCover ? endpoint('audio/cover', { id: opened.id }) : '');
  const title = $derived(info?.tags?.title || tab.title);
  const subtitle = $derived([info?.tags?.artist, info?.tags?.album].filter(Boolean).join(' — '));
  const techLine = $derived.by(() => {
    if (!info) return '';
    const parts = [info.codec ? info.codec.toUpperCase() : extname(tab.name).toUpperCase()];
    if (info.sampleRate) parts.push(`${+(info.sampleRate / 1000).toFixed(1)} kHz`);
    if (info.channels) parts.push(info.channels === 1 ? t('mono') : info.channels === 2 ? t('stereo') : t('{n} channels', { n: info.channels }));
    if (info.lossless && info.bitDepth) parts.push(info.float ? t('32-bit float') : `${info.bitDepth}-bit`);
    else if (info.bitrate) parts.push(`${info.bitrate} kbit/s`);
    if (frames && rate) parts.push(formatTime(frames / rate, 0));
    return parts.join(' · ');
  });

  // ---------- loading ----------

  async function close() {
    player?.destroy();
    player = null;
    if (opened) void api.AudioClose(opened.id);
    opened = null;
  }

  async function load() {
    await close();
    loading = true;
    error = '';
    sel = null;
    pos = 0;
    try {
      if (!tab.filePath) throw new Error(t('Audio inside archives can’t be played yet — extract it first.'));
      const o = await api.AudioOpen(tab.filePath);
      if (!o?.info) throw new Error(t('Couldn’t read this audio file.'));
      opened = o;
      rate = o.info!.sampleRate || 48000;
      frames = o.info!.frames;
      const p = new Player(o.url);
      player = p;
      p.rate = rate;
      p.setVolume(volume);
      p.setSpeed(speed);
      p.onTick = (x, pl) => {
        pos = x;
        playing = pl;
        if (pl) follow(x);
        updateStatus();
      };
      p.el.addEventListener('loadedmetadata', () => {
        if (!o.info!.editable && isFinite(p.el.duration)) {
          frames = Math.round(p.el.duration * rate);
          resetTimeline();
        } else if (o.info!.codec === 'mp3' && isFinite(p.el.duration)) {
          // Our decoder keeps the MP3 info frame / encoder delay that players skip.
          const d = frames / rate - p.el.duration;
          p.offset = d > 0 && d < 0.12 ? d : 0;
        }
      });
      p.el.addEventListener('error', () => {
        if (!o.info!.editable && p.el.error) error = t('This system can’t play {format} files.', { format: extname(tab.name).toUpperCase() });
      });
      peaks = o.info!.editable ? new Peaks(o.lanes) : null;
      resetTimeline();
      if (o.info!.editable) void pollPeaks(o.id);
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function resetTimeline() {
    timeline = E.whole(frames);
    undoStack = [];
    redoStack = [];
    canUndo = canRedo = false;
    tab.dirty = false;
    player?.setTimeline(timeline);
    fit();
    updateStatus();
  }

  async function pollPeaks(id: string) {
    const p = peaks!;
    while (opened?.id === id && !p.done) {
      try {
        const res = await fetch(endpoint('audio/peaks', { id, from: p.buckets }));
        if (!res.ok) break;
        const buf = await res.arrayBuffer();
        if (buf.byteLength) {
          p.append(new Int16Array(buf));
          redraw();
        }
        p.done = res.headers.get('X-Done') === '1';
        p.error = res.headers.get('X-Error') ?? '';
        peakProgress = frames ? Math.min(1, (p.buckets * PEAK_FRAMES) / frames) : 0;
        if (p.error) toastError(p.error, t('Couldn’t read all of the audio'));
      } catch {
        break;
      }
      if (!p.done) await new Promise((r) => setTimeout(r, 120));
    }
    peakProgress = 1;
    redraw();
  }

  // ---------- view ----------

  function fit() {
    const w = Math.max(width, 100);
    view = { start: 0, fpp: Math.max(1, (total || frames) / w) };
    redraw();
  }

  const maxFpp = () => Math.max(1, (total || 1) / Math.max(width, 100));

  function zoomAround(frame: number, factor: number) {
    const fpp = Math.min(maxFpp(), Math.max(4, view.fpp * factor));
    const px = (frame - view.start) / view.fpp;
    view = clampView({ start: frame - px * fpp, fpp });
    redraw();
  }

  function clampView(v: View): View {
    const span = v.fpp * Math.max(width, 1);
    return { fpp: v.fpp, start: Math.max(0, Math.min(v.start, Math.max(0, total - span))) };
  }

  function zoom(dir: 1 | -1 | 0) {
    if (dir === 0) return fit();
    const centre = pos >= view.start && pos <= view.start + view.fpp * width ? pos : view.start + (view.fpp * width) / 2;
    zoomAround(centre, dir > 0 ? 1 / 1.6 : 1.6);
  }

  /** Keep the playhead visible while playing. */
  function follow(x: number) {
    const span = view.fpp * width;
    if (x < view.start || x > view.start + span * 0.95) {
      view = clampView({ ...view, start: x - span * 0.05 });
      redraw();
    }
  }

  let drawPending = false;
  function redraw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      draw();
    });
  }

  function cssVar(name: string) {
    return getComputedStyle(area ?? document.body).getPropertyValue(name).trim();
  }

  function draw() {
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    // Ruler.
    const sec = view.fpp / rate;
    const step = tickStep(sec);
    g.fillStyle = cssVar('--text-faint');
    g.font = `11px ${cssVar('--font-ui') || 'sans-serif'}`;
    const t0 = Math.ceil(view.start / rate / step) * step;
    for (let t = t0; (t * rate - view.start) / view.fpp < width; t += step) {
      const x = Math.round((t * rate - view.start) / view.fpp);
      g.fillRect(x, RULER - 6, 1, 6);
      g.fillText(formatTime(t, step < 1 ? (step < 0.01 ? 3 : step < 0.1 ? 2 : 1) : 0), x + 3, 12);
    }
    g.fillStyle = cssVar('--border-soft');
    g.fillRect(0, RULER - 1, width, 1);
    if (peaks) {
      drawWave(g, width, RULER + 4, height - RULER - 8, peaks, timeline, view, {
        wave: cssVar('--text-muted'),
        edited: cssVar('--accent'),
        centre: cssVar('--border-soft'),
        silence: cssVar('--accent-soft'),
      });
    }
  }

  const xOf = (frame: number) => (frame - view.start) / view.fpp;

  // ---------- pointer ----------

  let anchor = 0;
  let dragging = false;
  let moved = false;
  let downX = 0;

  function frameAt(clientX: number) {
    const r = canvas!.getBoundingClientRect();
    return Math.max(0, Math.min(total, Math.round(view.start + (clientX - r.left) * view.fpp)));
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || !total) return;
    canvas!.setPointerCapture(e.pointerId);
    const f = frameAt(e.clientX);
    dragging = true;
    moved = false;
    downX = e.clientX;
    if (e.shiftKey) {
      // Extend from the far end of the selection (or the cursor).
      anchor = sel ? (Math.abs(f - sel[0]) > Math.abs(f - sel[1]) ? sel[0] : sel[1]) : pos;
      setSel(anchor, f);
      moved = true;
    } else anchor = f;
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    if (!moved && Math.abs(e.clientX - downX) < 4) return;
    moved = true;
    setSel(anchor, frameAt(e.clientX));
  }

  function onUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (!moved) {
      sel = null;
      seek(frameAt(e.clientX));
    } else if (sel && !playing) seek(sel[0]);
    if (loopOn) applyLoop();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAround(frameAt(e.clientX), e.deltaY < 0 ? 1 / 1.25 : 1.25);
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      view = clampView({ ...view, start: view.start + d * view.fpp });
      redraw();
    }
  }

  function setSel(a: number, b: number) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(total, Math.max(a, b));
    sel = hi > lo ? [lo, hi] : null;
    updateStatus();
  }

  function seek(x: number) {
    pos = Math.max(0, Math.min(total, x));
    player?.seek(pos);
    updateStatus();
  }

  // ---------- transport ----------

  function toggle() {
    if (!player || !total) return;
    if (!playing && pos >= total) pos = 0;
    if (!playing && sel && loopOn) pos = sel[0];
    player.pos = pos;
    player.toggle();
  }

  function stop() {
    player?.pause();
    seek(sel ? sel[0] : 0);
  }

  function applyLoop() {
    if (player) player.loop = loopOn && sel ? [sel[0], sel[1]] : null;
  }

  function toggleLoop() {
    loopOn = !loopOn;
    applyLoop();
  }

  function nudge(seconds: number, extend: boolean) {
    const to = Math.max(0, Math.min(total, pos + seconds * rate));
    if (extend) setSel(sel ? (Math.abs(pos - sel[0]) < Math.abs(pos - sel[1]) ? sel[1] : sel[0]) : pos, to);
    seek(to);
    follow(to);
  }

  // ---------- edits ----------

  function commit(next: E.Timeline) {
    undoStack.push(timeline);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    timeline = next;
    afterEdit();
  }

  function afterEdit() {
    canUndo = undoStack.length > 0;
    canRedo = redoStack.length > 0;
    tab.dirty = !E.isIdentity(timeline, frames);
    player?.setTimeline(timeline);
    if (pos > total) seek(total);
    if (sel) setSel(sel[0], sel[1]);
    view = clampView({ ...view, fpp: Math.min(view.fpp, maxFpp()) });
    redraw();
    updateStatus();
  }

  function needEditable(): boolean {
    // The quick view only plays; Edit opens the editor.
    if (peek.on) return false;
    if (editable) return true;
    ui.toast(t('{reason}. Editing works with WAV, MP3, FLAC and OGG Vorbis files.', { reason: info?.reason || t('This format can be played but not edited') }), 'info');
    return false;
  }

  /** The selection, or null after asking for one (`hint` says what to select it for). */
  function needSel(hint: string): [number, number] | null {
    if (sel && sel[1] > sel[0]) return sel;
    ui.toast(hint, 'info'); // i18n-ignore: callers pass translated text
    return null;
  }

  async function edit(op: Parameters<AudioView['edit']>[0]) {
    if (op === 'selectAll') return setSel(0, total);
    if (!needEditable()) return;
    const id = opened!.id;
    switch (op) {
      case 'undo':
        if (!undoStack.length) return;
        redoStack.push(timeline);
        timeline = undoStack.pop()!;
        return afterEdit();
      case 'redo':
        if (!redoStack.length) return;
        undoStack.push(timeline);
        timeline = redoStack.pop()!;
        return afterEdit();
      case 'copy': {
        const s = needSel(t('Select a part of the waveform to copy (drag across it).'));
        if (s) clip = { id, segs: E.slice(timeline, s[0], s[1]) };
        return;
      }
      case 'cut': {
        const s = needSel(t('Select a part of the waveform to cut (drag across it).'));
        if (!s) return;
        clip = { id, segs: E.slice(timeline, s[0], s[1]) };
        commit(E.remove(timeline, s[0], s[1]));
        sel = null;
        return seek(s[0]);
      }
      case 'paste': {
        if (!clip) return ui.toast(t('Nothing copied yet.'), 'info');
        if (clip.id !== id) return ui.toast(t('Audio can be pasted within the file it was copied from.'), 'info');
        const at = hasSel ? sel![0] : pos;
        const base = hasSel ? E.remove(timeline, sel![0], sel![1]) : timeline;
        commit(E.insert(base, at, clip.segs));
        const n = E.length(clip.segs);
        setSel(at, at + n);
        return;
      }
      case 'delete': {
        const s = needSel(t('Select a part of the waveform to delete (drag across it).'));
        if (!s) return;
        commit(E.remove(timeline, s[0], s[1]));
        sel = null;
        return seek(s[0]);
      }
      case 'trim': {
        const s = needSel(t('Select a part of the waveform to keep (drag across it).'));
        if (!s) return;
        commit(E.keep(timeline, s[0], s[1]));
        sel = null;
        fit();
        return seek(0);
      }
      case 'silence': {
        const s = needSel(t('Select a part of the waveform to silence (drag across it).'));
        if (s) commit(E.silence(timeline, s[0], s[1]));
        return;
      }
      case 'fadeIn':
      case 'fadeOut': {
        // Without a selection: fade in from the start to the cursor, out from the cursor to the end.
        const r: [number, number] = hasSel ? sel! : op === 'fadeIn' ? [0, pos] : [pos, total];
        const fadeIn = op === 'fadeIn';
        if (r[1] - r[0] < rate / 100) return ui.toast(fadeIn ? t('Select the part to fade in, or place the cursor where the fade should end.') : t('Select the part to fade out, or place the cursor where the fade should start.'), 'info');
        return commit(E.fade(timeline, r[0], r[1], op === 'fadeIn' ? 'in' : 'out'));
      }
      case 'gain': {
        const r: [number, number] = hasSel ? sel! : [0, total];
        const v = await ui.prompt(hasSel ? t('Change volume of the selection (dB, e.g. 3 or -6)') : t('Change volume of everything (dB, e.g. 3 or -6)'), '3', t('Apply'));
        if (v === null) return;
        const db = parseFloat(v.replace(',', '.'));
        if (!isFinite(db) || Math.abs(db) > 60) return ui.toast(t('Enter a number of decibels between -60 and 60.'), 'warning');
        return commit(E.gain(timeline, r[0], r[1], E.dbToGain(db)));
      }
      case 'normalize': {
        const r: [number, number] = hasSel ? sel! : [0, total];
        const v = await ui.prompt(hasSel ? t('Normalize the selection: loudest peak at (dBFS)') : t('Normalize everything: loudest peak at (dBFS)'), '-1', t('Normalize'));
        if (v === null) return;
        const target = parseFloat(v.replace(',', '.'));
        if (!isFinite(target) || target > 0 || target < -40) return ui.toast(t('Enter a level between -40 and 0 dBFS.'), 'warning');
        const segs = E.slice(timeline, r[0], r[1]);
        const done = await jobs.run<number>(t('Measuring level'), () => api.AudioAnalyze(id, segs as never));
        if (done.error) return toastError(done.error, t('Normalize failed'));
        if (done.cancelled) return;
        if (!(done.result > 1e-6)) return ui.toast(t('The selection is silent.'), 'info');
        normalizeInfo = { peak: done.result, factor: E.dbToGain(target) / done.result };
        return commit(E.gain(timeline, r[0], r[1], normalizeInfo.factor));
      }
    }
  }
  let normalizeInfo = { peak: 0, factor: 1 };

  // ---------- saving ----------

  function sameFormat(): 'wav' | 'flac' | 'mp3' | null {
    switch (info?.codec) {
      case 'wav':
        return 'wav';
      case 'flac':
        return 'flac';
      case 'mp3':
        return E.cutsOnly(timeline) ? 'mp3' : null;
      default:
        return null;
    }
  }

  async function save(): Promise<boolean> {
    if (!editable || !tab.filePath) return false;
    if (!tab.dirty) return true;
    const fmt = sameFormat();
    if (!fmt) {
      ui.toast(
        info?.codec === 'mp3'
          ? t('MP3 files are saved without re-encoding only after cuts. Choose FLAC or WAV to keep fades and volume changes.')
          : t('OGG files can’t be written here. Choose FLAC or WAV.'),
        'info',
      );
      return saveAs();
    }
    return exportTo(tab.filePath, fmt, false);
  }

  async function saveAs(): Promise<boolean> {
    if (!needEditable()) return false;
    const mp3ok = info?.codec === 'mp3' && E.cutsOnly(timeline);
    const ext = info?.codec === 'wav' ? 'wav' : mp3ok ? 'mp3' : 'flac';
    const base = join(dirname(tab.filePath ?? ''), `${stem(tab.title)} (edited).${ext}`);
    const filters = [
      { name: t('FLAC (lossless, smaller)'), patterns: '*.flac' },
      { name: 'WAV', patterns: '*.wav' },
    ];
    if (mp3ok) filters.unshift({ name: t('MP3 (cuts only, no re-encoding)'), patterns: '*.mp3' });
    let dest = await api.SaveFileDialog(t('Save audio as'), base, filters);
    if (!dest) return false;
    let fmt = extname(dest) as 'wav' | 'flac' | 'mp3';
    if (!['wav', 'flac', 'mp3'].includes(fmt) || (fmt === 'mp3' && !mp3ok)) {
      if (fmt === 'mp3') ui.toast(t('MP3 can only be saved after cuts; saving as FLAC.'), 'info');
      fmt = 'flac';
      dest = `${dest.replace(/\.[^./\\]*$/, '')}.flac`;
    }
    return exportTo(dest, fmt, true);
  }

  async function exportTo(dest: string, fmt: 'wav' | 'flac' | 'mp3', retarget: boolean): Promise<boolean> {
    player?.pause();
    const segs = timeline.map((s) => ({ ...s }));
    const done = await jobs.run<string>(t('Saving {name}', { name: basename(dest) }), () => api.AudioExport(opened!.id, segs as never, dest, { format: fmt, bitDepth: 0 } as never));
    if (done.cancelled) return false;
    if (done.error) {
      toastError(done.error, t('Save failed'));
      return false;
    }
    if (retarget) tab.retarget(dest);
    tab.dirty = false;
    await load(); // the saved file is the new source; edits are baked in
    ui.toast(t('Saved {name}', { name: basename(dest) }), 'success');
    return true;
  }

  function editMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Cut'), shortcut: formatShortcut('Mod+X'), run: () => edit('cut') },
      { label: t('Copy'), shortcut: formatShortcut('Mod+C'), run: () => edit('copy') },
      { label: t('Paste'), shortcut: formatShortcut('Mod+V'), run: () => edit('paste') },
      { label: t('Delete selection'), shortcut: 'Del', run: () => edit('delete') },
      { label: t('Trim to selection'), shortcut: 'T', run: () => edit('trim') },
      { separator: true },
      { label: t('Fade in'), shortcut: 'I', run: () => edit('fadeIn') },
      { label: t('Fade out'), shortcut: 'O', run: () => edit('fadeOut') },
      { label: t('Change volume…'), shortcut: 'G', run: () => edit('gain') },
      { label: t('Normalize…'), shortcut: 'N', run: () => edit('normalize') },
      { label: t('Silence'), run: () => edit('silence') },
      { separator: true },
      { label: t('Select all'), shortcut: formatShortcut('Mod+A'), run: () => edit('selectAll') },
    ]);
  }

  function saveMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Save'), shortcut: formatShortcut('Mod+S'), run: () => void save() },
      { label: t('Save as…'), shortcut: formatShortcut('Mod+Shift+S'), run: () => void saveAs() },
      { label: t('Save and convert…'), shortcut: formatShortcut('Mod+Alt+Shift+S'), run: () => void saveAndConvert(tab) },
    ]);
  }

  // ---------- status ----------

  let statusTimer = 0;
  function updateStatus() {
    if (statusTimer) return;
    statusTimer = window.setTimeout(() => {
      statusTimer = 0;
      tab.status = {
        ...tab.status,
        type: t('{format} audio', { format: (info?.codec || extname(tab.name)).toUpperCase() }),
        position: `${formatTime(pos / rate, 1)} / ${formatTime(total / rate, 1)}`,
        info: hasSel ? t('Selection {length}', { length: formatTime((sel![1] - sel![0]) / rate) }) : undefined,
      };
    }, 100);
  }

  $effect(() => {
    void width;
    void height;
    redraw();
  });

  audioViews.set(tab.id, {
    toggle,
    stop,
    edit: (op) => void edit(op),
    zoom,
    nudge,
    home: (extend) => (extend ? setSel(0, pos) : seek(0), follow(0)),
    end: (extend) => (extend ? setSel(pos, total) : seek(total), follow(total)),
    toggleLoop,
  });

  onMount(() => {
    tab.handlers = { ...tab.handlers, save, saveAs, reload: () => load(), onShow: () => (redraw(), updateStatus()), getState: () => undefined };
    void load();
    return () => {
      audioViews.delete(tab.id);
      clearTimeout(statusTimer);
      void close();
    };
  });

  (tab as unknown as { audioTest: unknown }).audioTest = {
    opened: () => opened,
    loading: () => loading,
    error: () => error,
    peaks: () => peaks,
    timeline: () => timeline,
    total: () => total,
    rate: () => rate,
    sel: () => sel,
    setSel,
    pos: () => pos,
    playing: () => playing,
    player: () => player,
    seek,
    toggle,
    edit,
    exportTo,
    view: () => view,
    zoom,
    normalizeInfo: () => normalizeInfo,
  };
</script>

<header class="head">
  <div class="cover">
    {#if coverUrl}<img src={coverUrl} alt="" />{:else}<Icon icon={Music} size={22} />{/if}
  </div>
  <div class="meta">
    <div class="title" title={title}>{title}</div>
    {#if subtitle}<div class="sub">{subtitle}</div>{/if}
    <div class="tech">{techLine}</div>
  </div>
</header>

<div class="toolbar" use:fitBar>
  <button class="icon-btn play" title="{playing ? t('Pause') : t('Play')} (Space)" onclick={toggle} disabled={!total}><Icon icon={playing ? Pause : Play} size={16} /></button>
  <button class="icon-btn" title={t('Stop')} onclick={stop} disabled={!total}><Icon icon={Square} size={14} /></button>
  <button class="icon-btn" class:on={loopOn} title="{t('Loop selection')} (L)" onclick={toggleLoop}><Icon icon={Repeat} size={14} /></button>
  <span class="time">{formatTime(pos / rate)} <span class="muted">/ {formatTime(total / rate)}</span></span>
  {#if hasSel}<span class="label selinfo">{t('Selection {from} – {to} ({length})', { from: formatTime(sel![0] / rate, 2), to: formatTime(sel![1] / rate, 2), length: formatTime((sel![1] - sel![0]) / rate, 2) })}</span>{/if}
  <span class="spacer"></span>
  <span class="vol" title={t('Volume', {}, 'sound')}><Icon icon={Volume2} size={14} /><input type="range" min="0" max="1" step="0.01" bind:value={volume} oninput={() => player?.setVolume(volume)} aria-label={t('Volume', {}, 'sound')} /></span>
  <select bind:value={speed} onchange={() => player?.setSpeed(speed)} title={t('Playback speed')} aria-label={t('Playback speed')}>
    {#each [0.5, 0.75, 1, 1.25, 1.5, 2] as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  <span class="sep"></span>
  <button class="icon-btn" title="{t('Zoom out')} (-)" onclick={() => zoom(-1)}><Icon icon={ZoomOut} size={15} /></button>
  <button class="icon-btn" title="{t('Zoom in')} (+)" onclick={() => zoom(1)}><Icon icon={ZoomIn} size={15} /></button>
  <button class="btn ghost" title="{t('Zoom to fit')} (0)" onclick={() => zoom(0)}><Icon icon={MoveHorizontal} size={14} /> {t('Fit')}</button>
  {#if editable && !peek.on}
    <span class="sep"></span>
    <button class="icon-btn" title="{t('Undo')} ({formatShortcut('Mod+Z')})" disabled={!canUndo} onclick={() => edit('undo')}><Icon icon={Undo2} size={15} /></button>
    <button class="icon-btn" title="{t('Redo')} ({formatShortcut('Mod+Shift+Z')})" disabled={!canRedo} onclick={() => edit('redo')}><Icon icon={Redo2} size={15} /></button>
    <button class="btn ghost" onclick={editMenu}><Icon icon={Pencil} size={14} /> {t('Edit')} ▾</button>
    <button class="btn ghost" onclick={saveMenu}><Icon icon={Save} size={14} /> {t('Save')} ▾</button>
  {/if}
</div>

<div class="stage" bind:this={area} bind:clientWidth={width} bind:clientHeight={height}>
  {#if editable}
    <canvas
      bind:this={canvas}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onwheel={onWheel}
      ondblclick={() => setSel(0, total)}
      aria-label={t('Waveform: drag to select, click to place the cursor')}
    ></canvas>
    {#if hasSel && xOf(sel![1]) >= 0 && xOf(sel![0]) <= width}
      <div class="sel" style:left="{Math.max(0, xOf(sel![0]))}px" style:width="{Math.min(width, xOf(sel![1])) - Math.max(0, xOf(sel![0]))}px"></div>
    {/if}
    {#if xOf(pos) >= 0 && xOf(pos) <= width}<div class="playhead" style:left="{xOf(pos)}px"></div>{/if}
    {#if peaks && peakProgress < 1}<div class="reading">{t('Reading waveform…')} {Math.round(peakProgress * 100)}%</div>{/if}
  {:else if !loading && !error}
    <div class="empty-state">
      <div class="big"><Icon icon={Music} size={40} /></div>
      <p class="muted">{info?.reason ? `${info.reason}.` : ''} {t('Editing works with WAV, MP3, FLAC and OGG Vorbis files.')}</p>
      <input class="scrub" type="range" min="0" max={total} step="1" value={pos} oninput={(e) => seek(+(e.target as HTMLInputElement).value)} aria-label={t('Position')} />
    </div>
  {/if}
  {#if loading}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
  {#if error}<div class="empty-state overlay err">{error}</div>{/if}
</div>

<style>
  .head {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 16px 8px;
  }
  .cover {
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--text-faint);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    min-width: 0;
  }
  .title {
    font-family: var(--font-serif);
    font-size: 1.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .tech {
    color: var(--text-faint);
    font-size: var(--fs-small);
    margin-top: 2px;
  }
  .time {
    font-variant-numeric: tabular-nums;
    margin-left: 6px;
  }
  .selinfo {
    margin-left: 10px;
    font-variant-numeric: tabular-nums;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .vol {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
  }
  .vol input {
    width: 80px;
    accent-color: var(--accent);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    margin: 0 8px 8px;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: text;
    touch-action: none;
  }
  .sel {
    position: absolute;
    top: 20px;
    bottom: 0;
    background: var(--accent-soft);
    opacity: 0.55;
    pointer-events: none;
    mix-blend-mode: normal;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .reading {
    position: absolute;
    right: 8px;
    top: 24px;
    font-size: var(--fs-small);
    color: var(--text-faint);
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
  .err {
    color: var(--danger);
  }
  .big {
    color: var(--text-faint);
  }
  .scrub {
    width: min(480px, 80%);
    accent-color: var(--accent);
  }
</style>
