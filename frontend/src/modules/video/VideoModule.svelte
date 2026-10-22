<script lang="ts">
  import Save from '@lucide/svelte/icons/save';
  import { fitBar } from '../../core/fit';
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import StepBack from '@lucide/svelte/icons/step-back';
  import StepForward from '@lucide/svelte/icons/step-forward';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Camera from '@lucide/svelte/icons/camera';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Crop from '@lucide/svelte/icons/crop';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import type { Tab } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { basename, dirname, extname, join, stem } from '../../core/paths';
  import { ui, toastError, menu } from '../../core/ui.svelte';
  import { jobs } from '../../core/jobs.svelte';
  import { formatShortcut } from '../../core/keys';
  import { t, tn, num } from '../../core/i18n';
  import { formatTime } from '../audio/waveform';
  import * as E from './edits';
  import * as P from './project';
  import { videoViews, type VideoOp } from './views';
  import FxStage from './FxStage.svelte';
  import GiveButton from '../../shell/GiveButton.svelte';
  import type { Transfer } from '../../core/transfer.svelte';
  import FxTracks from './FxTracks.svelte';
  import FxPanel from './FxPanel.svelte';
  import type { Compositor } from './compositor';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Droplet from '@lucide/svelte/icons/droplet';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import { fileUrl, readFile } from '../../core/backend';
  import { workspace } from '../../core/tabs.svelte';

  type Opened = Awaited<ReturnType<typeof api.VideoOpen>>;

  let { tab }: { tab: Tab } = $props();

  let opened = $state.raw<Opened | null>(null);
  const info = $derived(opened?.info);
  let el = $state<HTMLVideoElement>();
  let stage = $state<HTMLDivElement>();
  let strip = $state<HTMLCanvasElement>();
  let stageW = $state(0);
  let stageH = $state(0);
  let lineW = $state(0);
  let loading = $state(true);
  let error = $state('');
  let playError = $state('');
  let time = $state(0);
  let playing = $state(false);
  let muted = $state(false);
  let volume = $state(1);
  let speed = $state(1);
  let loopOn = $state(false);
  let sel = $state<E.Range | null>(null);
  let edit = $state.raw<E.VideoEdit>({ keep: [], rotate: 0, mute: false, fx: P.EMPTY });
  let undoStack: E.VideoEdit[] = [];
  let redoStack: E.VideoEdit[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let natural = $state({ w: 0, h: 0 });

  const dur = $derived(info?.duration || el?.duration || 0);
  const editable = $derived(!!info?.editable);
  // ---- effects ----
  const fx = $derived(edit.fx ?? P.EMPTY);
  /** With effects the video is re-encoded, so cuts are exact instead of snapping to keyframes. */
  const fxOn = $derived(P.hasEffects(fx));
  let selId = $state<string | null>(null);
  let autoKey = $state(false);
  let fxPanel = $state(false);
  let tracking = $state('');
  let rendering = $state<{ done: number; total: number; abort: AbortController } | null>(null);
  let fxCanvas = $state<HTMLCanvasElement>();
  let el2 = $state<HTMLVideoElement>();
  let comp: Compositor | null = null;
  /** Overlay images by asset id (immutable; layers refer to them). */
  const assets = new Map<string, ImageBitmap>();
  let assetsVersion = $state(0);
  const selLayer = $derived(fx.layers.find((l) => l.id === selId) ?? null);
  const outW = $derived(edit.rotate % 180 ? natural.h : natural.w);
  const outH = $derived(edit.rotate % 180 ? natural.w : natural.h);

  const kept = $derived(fxOn ? E.normalize(edit.keep, dur) : E.snap(edit.keep, info?.keyframes ?? [], dur));
  const ps = $derived(fxOn ? P.pieces(kept, fx) : []);
  const outLen = $derived(fxOn ? P.outputLength(ps) : E.keptLength(kept));
  const gaps = $derived(E.removed(kept, dur));
  /** Parts just cut out, flashed on the timeline so the change is noticed. */
  let flash = $state<E.Range[]>([]);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const snapped = $derived(kept.length !== E.normalize(edit.keep, dur).length || kept.some((r, i) => Math.abs(r[0] - edit.keep[i]?.[0]) > 0.001 || Math.abs(r[1] - edit.keep[i]?.[1]) > 0.001));
  const gop = $derived(info && info.keyframes.length > 1 ? (info.keyframes[info.keyframes.length - 1] - info.keyframes[0]) / (info.keyframes.length - 1) : 0);
  const changed = $derived(!!info && !E.isUnchanged(edit, dur));
  const techLine = $derived.by(() => {
    if (!info) return '';
    const p: string[] = [];
    if (info.hasVideo) {
      p.push(info.videoCodec || t('video'));
      if (info.width) p.push(`${info.width}×${info.height}`);
      if (info.fps) p.push(`${+info.fps.toFixed(2)} fps`);
    }
    if (info.hasAudio) p.push(`${info.audioCodec || t('audio')}${info.channels ? ` ${info.channels === 1 ? t('mono') : info.channels === 2 ? t('stereo') : t('{n} ch', { n: info.channels })}` : ''}`);
    if (info.bitrate) p.push(info.bitrate >= 1000 ? `${(info.bitrate / 1000).toFixed(1)} Mbit/s` : `${info.bitrate} kbit/s`);
    if (dur) p.push(formatTime(dur, 0));
    return p.join(' · ');
  });

  // ---------- loading ----------

  function release() {
    if (opened) void api.MediaRelease(opened.url);
    opened = null;
  }

  async function load() {
    release();
    loading = true;
    error = playError = '';
    sel = null;
    try {
      if (!tab.filePath) throw new Error(t('Videos inside archives can’t be played yet — extract it first.'));
      const o = await api.VideoOpen(tab.filePath);
      if (!o?.info) throw new Error(t('Couldn’t read this video.'));
      opened = o;
      edit = { keep: o.info.duration ? [[0, o.info.duration]] : [], rotate: 0, mute: false, fx: P.EMPTY };
      selId = null;
      undoStack = [];
      redoStack = [];
      canUndo = canRedo = false;
      tab.dirty = false;
      if (el) {
        el.crossOrigin = 'anonymous';
        el.src = o.url;
        el.load();
      }
      updateStatus();
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  let corsRetried = false;
  function onError() {
    if (!el || !opened) return;
    if (!corsRetried && el.crossOrigin) {
      // Retry without CORS (snapshots and thumbnails then can't read pixels).
      corsRetried = true;
      el.removeAttribute('crossorigin');
      el.src = opened.url;
      return;
    }
    const codec = info?.videoCodec || extname(tab.name).toUpperCase();
    playError = editable ? t('This system can’t play {codec} video. You can still cut, rotate and save it.', { codec }) : t('This system can’t play {codec} video.', { codec });
  }

  function onMeta() {
    if (!el) return;
    natural = { w: el.videoWidth, h: el.videoHeight };
    if (!info?.duration && isFinite(el.duration)) edit = { ...edit, keep: [[0, el.duration]] };
    void thumbnails();
  }

  // ---------- thumbnails ----------

  let thumbGen = 0;
  async function thumbnails() {
    if (!strip || !opened || !info?.hasVideo || !dur || !lineW) return;
    const gen = ++thumbGen;
    const h = 52;
    const dpr = window.devicePixelRatio || 1;
    strip.width = Math.round(lineW * dpr);
    strip.height = Math.round(h * dpr);
    const g = strip.getContext('2d')!;
    g.scale(dpr, dpr);
    const aspect = natural.w && natural.h ? natural.w / natural.h : 16 / 9;
    const tw = Math.max(40, Math.round(h * aspect));
    const n = Math.min(24, Math.ceil(lineW / tw));
    const v = document.createElement('video');
    v.muted = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.src = opened.url;
    try {
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('no thumbnails')); // i18n-ignore: internal, caught below
        setTimeout(() => rej(new Error('timeout')), 8000); // i18n-ignore: internal, caught below
      });
      for (let i = 0; i < n && gen === thumbGen; i++) {
        v.currentTime = Math.min(dur - 0.05, ((i + 0.5) * dur) / n);
        await new Promise<void>((res) => {
          v.onseeked = () => res();
          setTimeout(res, 2000);
        });
        g.drawImage(v, i * (lineW / n), 0, lineW / n, h);
        await new Promise((r) => setTimeout(r)); // one thumbnail per task
      }
    } catch {
      /* no thumbnails (codec unsupported here) */
    } finally {
      v.removeAttribute('src');
      v.load();
    }
  }

  // ---------- playback ----------

  let raf = 0;
  function tick() {
    raf = 0;
    if (!el) return;
    time = el.currentTime;
    if (playing && kept.length) {
      if (loopOn && sel && time >= sel[1]) el.currentTime = sel[0];
      else {
        const r = E.rangeAt(kept, time);
        if (!r.inside) {
          if (r.range) {
            // After an overlapping transition the next part has already been playing for a while.
            const i = kept.indexOf(r.range);
            const pc = ps[i];
            const jump = pc && pc.enter && P.TRANSITIONS.find((x) => x.id === pc.enter!.kind)?.overlap ? P.advance(fx.speeds, pc.src[0], ps[i - 1].out[1] - pc.out[0], pc.src[1]) : r.range[0];
            el.currentTime = jump;
          } else {
            el.pause();
            el.currentTime = kept[0][0];
          }
        }
      }
      const rate = speed * P.speedAt(fx.speeds, time);
      if (Math.abs(el.playbackRate - rate) > 0.001) el.playbackRate = rate;
    }
    if (fxOn) drawFx();
    updateStatus();
    if (playing) raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (!el || playError) return;
    if (el.paused) {
      if (kept.length && (time >= kept[kept.length - 1][1] - 0.05 || !E.rangeAt(kept, time).range)) el.currentTime = kept[0][0];
      if (loopOn && sel) el.currentTime = sel[0];
      void el.play().catch((e) => ui.toast(t('Can’t play: {error}', { error: (e as Error).message }), 'warning'));
    } else el.pause();
  }

  function seek(t: number) {
    if (!el) return;
    t = Math.max(0, Math.min(dur, t));
    el.currentTime = t;
    time = t;
    updateStatus();
  }

  function frame(dir: 1 | -1) {
    if (!el) return;
    el.pause();
    seek(time + dir / (info?.fps || 25));
  }

  // ---------- timeline ----------

  const xOf = (t: number) => (dur ? (t / dur) * lineW : 0);
  let dragging = false;
  let anchor = 0;
  let moved = false;
  let downX = 0;

  function tAt(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || !dur) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    moved = false;
    downX = e.clientX;
    const t = tAt(e);
    anchor = e.shiftKey && sel ? (Math.abs(t - sel[0]) > Math.abs(t - sel[1]) ? sel[0] : sel[1]) : e.shiftKey ? time : t;
    if (e.shiftKey) {
      setSel(anchor, t);
      moved = true;
    } else seek(t);
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    if (!moved && Math.abs(e.clientX - downX) < 4) return;
    moved = true;
    setSel(anchor, tAt(e));
    seek(tAt(e));
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (!moved) sel = null;
  }

  /** Drag one edge of the selection; the other stays put. */
  function edgeDown(e: PointerEvent, which: 0 | 1) {
    if (e.button !== 0 || !sel) return;
    e.stopPropagation();
    const line = (e.currentTarget as HTMLElement).closest('.timeline') as HTMLElement;
    line.setPointerCapture(e.pointerId);
    dragging = true;
    moved = true;
    anchor = sel[1 - which];
  }

  function setSel(a: number, b: number) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(dur, Math.max(a, b));
    sel = hi - lo > 0.01 ? [lo, hi] : null;
  }

  // ---------- edits ----------

  function commit(next: E.VideoEdit) {
    undoStack.push(edit);
    redoStack = [];
    edit = next;
    afterEdit();
  }

  function afterEdit() {
    canUndo = undoStack.length > 0;
    canRedo = redoStack.length > 0;
    tab.dirty = changed && edit !== renderedEdit;
    updateStatus();
  }

  function needEditable(): boolean {
    if (editable) return true;
    ui.toast(!info?.reason ? t('This video can be played but not edited.') : `${info.reason}.`, 'info');
    return false;
  }

  function doEdit(op: VideoOp) {
    switch (op) {
      case 'selectAll':
        return setSel(0, dur);
      case 'clearSel':
        sel = null;
        return;
      case 'setIn':
        return setSel(time, sel ? sel[1] : dur);
      case 'setOut':
        return setSel(sel ? sel[0] : 0, time);
    }
    if (!needEditable()) return;
    switch (op) {
      case 'undo':
        if (!undoStack.length) return;
        redoStack.push(edit);
        edit = undoStack.pop()!;
        return afterEdit();
      case 'redo':
        if (!redoStack.length) return;
        undoStack.push(edit);
        edit = redoStack.pop()!;
        return afterEdit();
      case 'cut':
      case 'keep': {
        if (!sel) return ui.toast(t('Select a part of the timeline first: drag across it, or press I and O at the start and end.'), 'info');
        const keep = op === 'cut' ? E.cut(edit.keep, sel[0], sel[1], dur) : E.keepOnly(edit.keep, sel[0], sel[1], dur);
        if (!keep.length) return ui.toast(t('That would remove everything.'), 'warning');
        const before = E.keptLength(kept);
        const beforeGaps = gaps;
        commit({ ...edit, keep });
        sel = null;
        // Flash what disappeared and say how much, with a one-click undo.
        const now = E.removed(E.snap(keep, info?.keyframes ?? [], dur), dur);
        flash = now.flatMap(([a, b]) => beforeGaps.reduce<E.Range[]>((parts, g) => parts.flatMap(([x, y]) => E.cut([[x, y]], g[0], g[1], dur)), [[a, b]]));
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => (flash = []), 1200);
        const after = E.keptLength(E.snap(keep, info?.keyframes ?? [], dur));
        const vars = { removed: formatTime(before - after, 1), length: formatTime(after, 1) };
        const isCut = op === 'cut';
        ui.toast(isCut ? t('Cut out {removed} — the video is now {length} long.', vars) : t('Trimmed away {removed} — the video is now {length} long.', vars), 'success', { label: t('Undo'), run: () => doEdit('undo') }, 6000);
        return;
      }
      case 'restoreAll':
        return commit({ ...edit, keep: [[0, dur]] });
      case 'rotate':
        if (info?.container !== 'mp4') return ui.toast(t('Rotation can be saved in MP4 and MOV files only (WebM/MKV have no standard rotation flag).'), 'info');
        return commit({ ...edit, rotate: (edit.rotate + 90) % 360 });
      case 'removeAudio':
        if (!info?.hasAudio) return ui.toast(t('This video has no audio track.'), 'info');
        return commit({ ...edit, mute: !edit.mute });
    }
  }

  /** Put one removed part back. */
  function restoreGap(g: E.Range) {
    if (!needEditable()) return;
    commit({ ...edit, keep: E.restore(edit.keep, g[0], g[1], dur) });
    ui.toast(t('Restored {length}.', { length: formatTime(g[1] - g[0], 1) }), 'success', { label: t('Undo'), run: () => doEdit('undo') });
  }

  // ---------- effects ----------

  let liveBase: E.VideoEdit | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  /** Change the effects: live while dragging (done=false), committed to undo on done; undefined = commit when idle. */
  function setFx(next: P.Project, done?: boolean) {
    if (!needEditable()) return;
    liveBase ??= edit;
    edit = { ...edit, fx: next };
    clearTimeout(commitTimer);
    if (done === false) return void queueMicrotask(drawFx);
    const finish = () => {
      const base = liveBase;
      liveBase = null;
      if (base && base !== edit) {
        undoStack.push(base);
        redoStack = [];
      }
      afterEdit();
      drawFx();
    };
    if (done) finish();
    else commitTimer = setTimeout(finish, 400);
    queueMicrotask(drawFx);
  }

  function updateLayer(l: P.Layer, done?: boolean) {
    setFx({ ...fx, layers: fx.layers.map((x) => (x.id === l.id ? l : x)) }, done);
  }

  function stageChange(l: P.Layer, st: Partial<P.State>, done: boolean) {
    updateLayer(P.place(l, time, st, autoKey), done);
  }

  /** Drawing a freeform outline on the picture (for the selected layer). */
  let drawing = $state(false);

  /** A drawn outline becomes the layer's box and freeform mask; every key moves with the box's centre. */
  function drawOutline(l: P.Layer, outline: P.Pt[]) {
    drawing = false;
    const r = P.outlineToBox(outline, P.stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, time));
    if (!r) return;
    const keys = l.keys.map((k) => ({ ...k, x: Math.round(k.x + r.shift[0]), y: Math.round(k.y + r.shift[1]) }));
    updateLayer(P.withMask({ ...l, w: r.w, h: r.h, keys }, { shape: 'path', points: r.points }), true);
  }

  function addLayer(l: P.Layer) {
    setFx({ ...fx, layers: [...fx.layers, l] }, true);
    selId = l.id;
    fxPanel = true;
  }

  /** A new overlay or blur covers the selection, or else the whole clip (it can be shortened in its track). */
  function span(): { start: number; end: number } {
    if (sel) return { start: sel[0], end: sel[1] };
    return { start: 0, end: dur };
  }

  async function addImageBitmap(bmp: ImageBitmap, name: string, at?: { x: number; y: number }) {
    if (!needEditable() || !outW) return;
    const id = `img-${Date.now().toString(36)}-${assets.size}`;
    assets.set(id, bmp);
    assetsVersion++;
    const f = Math.min(1, (outW * 0.4) / bmp.width, (outH * 0.4) / bmp.height);
    addLayer(P.newLayer('image', { ...span(), x: at?.x ?? outW / 2, y: at?.y ?? outH / 2, w: Math.round(bmp.width * f), h: Math.round(bmp.height * f) }, { asset: id, name }));
  }

  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
  async function addImages(paths?: string[], at?: { x: number; y: number }) {
    if (!needEditable()) return;
    if (!paths) paths = (await api.OpenFilesDialog(t('Add an image to the video'), [{ name: t('Images'), patterns: IMAGE_EXT.map((e) => `*.${e}`).join(';') }])) ?? [];
    for (const p of paths.filter((x) => IMAGE_EXT.includes(extname(x)))) {
      try {
        const bmp = await createImageBitmap(new Blob([await readFile(p)]));
        await addImageBitmap(bmp, stem(p), at);
      } catch (e) {
        toastError(e, t('Couldn’t add {name}', { name: basename(p) }));
      }
    }
  }

  function addBlur(shape: 'ellipse' | 'rect' | 'path' = 'ellipse') {
    if (!needEditable() || !outW) return;
    const l = P.newLayer('blur', { ...span(), x: outW / 2, y: outH / 2, w: Math.round(outW / 3), h: Math.round(outH / 3) }, { name: t('Blur {n}', { n: fx.layers.filter((l) => l.kind === 'blur').length + 1 }) });
    addLayer(P.withMask(l, { shape }));
    drawing = shape === 'path';
  }

  function blurMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Ellipse (faces)'), run: () => addBlur('ellipse') },
      { label: t('Rectangle (plates, screens, text)'), run: () => addBlur('rect') },
      { label: t('Draw any shape…'), run: () => addBlur('path') },
    ]);
  }

  function speedMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const [a, b] = sel ?? [0, dur];
    const cur = P.speedAt(fx.speeds, (a + b) / 2);
    menu.show(
      { clientX: r.left, clientY: r.bottom + 4 },
      [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((rate) => ({
        label: `${rate === cur ? '✓ ' : ''}${rate === 1 ? t('{rate}× (normal)', { rate }) : rate < 1 ? t('{rate}× slower', { rate }) : t('{rate}× faster', { rate })}`,
        run: () => {
          setFx({ ...fx, speeds: P.setSpeed(fx.speeds, a, b, rate) }, true);
          const vars = { rate, length: formatTime(P.outputLength(P.pieces(E.normalize(edit.keep, dur), fx)), 1) };
          ui.toast(sel ? t('Selection at {rate}×. The video is now {length} long.', vars) : t('Whole video at {rate}×. The video is now {length} long.', vars), 'success', { label: t('Undo'), run: () => doEdit('undo') });
        },
      })),
    );
  }

  function transitionMenu(e: MouseEvent, at: number) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cur = fx.transitions.find((t) => Math.abs(t.at - at) < 0.02);
    const set = (kind: P.TransitionKind | null, d = 1) =>
      setFx({ ...fx, transitions: [...fx.transitions.filter((t) => Math.abs(t.at - at) >= 0.02), ...(kind ? [{ at, kind, dur: d }] : [])] }, true);
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: `${cur ? '' : '✓ '}${t('Hard cut (no transition)')}`, run: () => set(null) },
      { separator: true },
      ...P.TRANSITIONS.flatMap((t) => [0.5, 1, 2].map((d) => ({ label: `${cur?.kind === t.id && cur.dur === d ? '✓ ' : ''}${t.label} · ${d} s`, run: () => set(t.id, d) }))),
    ]);
  }

  async function ensureComp(): Promise<Compositor | null> {
    if (comp) return comp;
    if (!fxCanvas) return null;
    try {
      const { Compositor } = await import('./compositor');
      comp ??= new Compositor(fxCanvas);
    } catch (e) {
      toastError(e, t('Effects preview isn’t available'));
      return null;
    }
    return comp;
  }

  let drawQueued = false;
  /** Draw the effects preview for the current time (coalesced to one per frame). */
  function drawFx() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      void drawNow();
    });
  }

  async function drawNow() {
    if (!fxOn || !el || !natural.w || el.readyState < 2) return;
    const c = await ensureComp();
    if (!c) return;
    c.resize(outW & ~1 || outW, outH & ~1 || outH);
    for (const [id, bmp] of assets) if (!c.hasImage(id)) c.setImage(id, bmp);
    const o = P.outputTimeOf(ps, fx, time);
    const ref = o === null ? null : P.frameAt(ps, fx, o);
    let b: Parameters<Compositor['render']>[0]['b'] = null;
    if (ref?.b && el2) {
      if (!el2.src && opened) el2.src = opened.url;
      if (Math.abs(el2.currentTime - ref.b.t) > 0.25) el2.currentTime = ref.b.t;
      if (playing && el2.paused) void el2.play().catch(() => {});
      if (el2.readyState >= 2) b = { frame: el2, frameW: el2.videoWidth, frameH: el2.videoHeight, t: ref.b.t, kind: ref.b.kind, progress: ref.b.progress };
    } else if (el2 && !el2.paused) el2.pause();
    c.render({ a: { frame: el, frameW: natural.w, frameH: natural.h, t: time }, b, light: ref?.light ?? 1, rotate: edit.rotate, layers: fx.layers });
  }

  $effect(() => {
    void fx;
    void assetsVersion;
    void time;
    if (fxOn) drawFx();
  });

  /** Follow what is under the overlay from the playhead to its end; keys become the tracked path. */
  async function trackLayer(l: P.Layer): Promise<boolean> {
    if (!tab.filePath || !opened || tracking) return false;
    const t0 = Math.max(l.start, Math.min(time, l.end));
    tracking = t('Preparing…');
    el?.pause();
    try {
      const [{ demux, Frames }, { toGray }, { default: TrackWorker }] = await Promise.all([import('./source'), import('./track'), import('./trackWorker?worker')]);
      const streams = await demux(tab.filePath);
      const v = streams.video;
      if (!v) throw new Error(t('This file has no video track.'));
      const cursor = await Frames.open(v, opened.url, fileUrl(tab.filePath));
      // Track on a small copy (≤ 320 px wide) for speed.
      const k = Math.min(1, 320 / v.width);
      const gw = Math.round(v.width * k);
      const gh = Math.round(v.height * k);
      const cv = document.createElement('canvas');
      cv.width = gw;
      cv.height = gh;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      const grab = async (at: number) => {
        const f = await cursor.frameAt(at);
        if (!f) return null;
        g.drawImage(f.image, 0, 0, gw, gh);
        f.close();
        return toGray(g.getImageData(0, 0, gw, gh).data, gw, gh);
      };
      const s0 = P.stateAt({ ...l, fadeIn: 0, fadeOut: 0 }, t0);
      const [sx, sy] = P.toSource(s0.x, s0.y, edit.rotate, v.width, v.height);
      const size = Math.min(Math.max(16, Math.min(l.w, l.h) * s0.scale * k), 96);
      const first = await grab(t0);
      if (!first) throw new Error(t('No picture at the playhead.'));
      const worker: Worker = new TrackWorker();
      const askWorker = (msg: unknown, frame: { data: Float32Array }) =>
        new Promise<{ x: number; y: number } | null>((resolve, reject) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.onerror = (e) => reject(new Error(e.message || t('tracking failed')));
          worker.postMessage(msg, [frame.data.buffer]);
        });
      await askWorker({ type: 'init', frame: first, box: { x: sx * k, y: sy * k, w: size, h: size } }, first);
      const times = v.samples.map((x) => x[0]).filter((s) => s > t0 + 1e-3 && s <= l.end).sort((a, b) => a - b);
      const keys: P.Key[] = [{ ...s0, t: t0, ease: 'linear' }];
      let lost = -1;
      for (let i = 0; i < times.length; i++) {
        if (!tracking) break; // cancelled
        const f = await grab(times[i]);
        if (!f) break;
        const p = await askWorker({ type: 'next', frame: f }, f);
        if (!p) {
          lost = times[i];
          break;
        }
        const [x, y] = P.toOutput(p.x / k, p.y / k, edit.rotate, v.width, v.height);
        keys.push({ ...s0, t: times[i], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ease: 'linear' });
        tracking = `${t('Tracking…')} ${Math.round(((i + 1) / times.length) * 100)}%`;
      }
      cursor.close();
      worker.terminate();
      const before = l.keys.filter((key) => key.t < t0 - 1e-3);
      updateLayer({ ...l, keys: [...before, ...keys], tracked: true, path: 'straight' }, true);
      ui.toast(lost >= 0 ? t('Tracked until {time}, where the object was lost.', { time: formatTime(lost, 2) }) : tn('Pinned to the object: {n} positions.', 'Pinned to the object: {n} positions.', keys.length), lost >= 0 ? 'warning' : 'success', { label: t('Undo'), run: () => doEdit('undo') });
      return true;
    } catch (e) {
      toastError(e, t('Tracking failed'));
      return false;
    } finally {
      tracking = '';
    }
  }

  function deleteLayer(l: P.Layer) {
    setFx({ ...fx, layers: fx.layers.filter((x) => x.id !== l.id) }, true);
    selId = null;
  }

  /** Render the edits and effects into a new WebM file. */
  async function renderTo(dest: string): Promise<boolean> {
    if (!tab.filePath || !opened || rendering) return false;
    el?.pause();
    const abort = new AbortController();
    rendering = { done: 0, total: 1, abort };
    try {
      const { renderVideo } = await import('./render');
      const r = await renderVideo({
        path: tab.filePath,
        url: opened.url,
        keep: E.normalize(edit.keep, dur),
        rotate: edit.rotate,
        mute: edit.mute,
        project: fx,
        images: assets,
        fps: info?.fps || 30,
        signal: abort.signal,
        onProgress: (done, total) => rendering && (rendering = { ...rendering, done, total }),
      });
      await saveFile(dest, r.blob);
      renderedEdit = edit;
      tab.dirty = false;
      const codecs = `${r.videoCodec.startsWith('vp09') ? 'VP9' : 'VP8'}${r.audioCodec ? ` + ${r.audioCodec === 'opus' ? 'Opus' : 'Vorbis'}` : ''}`;
      ui.toast(t('Rendered {name} ({length}, {codecs})', { name: basename(dest), length: formatTime(r.duration, 1), codecs }), 'success', { label: t('Open'), run: () => void workspace.openPath(dest) }, 8000);
      return true;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toastError(e, t('Rendering failed'));
      return false;
    } finally {
      rendering = null;
    }
  }
  let renderedEdit: E.VideoEdit | null = null;

  async function renderAs(): Promise<boolean> {
    if (!needEditable()) return false;
    let dest = await api.SaveFileDialog(t('Render video as WebM'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)} (edited).webm`), [{ name: t('WebM video'), patterns: '*.webm' }]);
    if (!dest) return false;
    if (extname(dest) !== 'webm') dest += '.webm';
    return renderTo(dest);
  }

  // ---------- saving ----------

  function plan(audioOnly = false) {
    return { keep: edit.keep.map((r) => [r[0], r[1]]), rotate: audioOnly ? 0 : edit.rotate, mute: audioOnly ? false : edit.mute, audioOnly };
  }

  async function exportTo(dest: string, audioOnly = false): Promise<boolean> {
    el?.pause();
    const done = await jobs.run<number[][]>(t('Saving {name}', { name: basename(dest) }), () => api.VideoExport(tab.filePath!, plan(audioOnly) as never, dest));
    if (done.cancelled) return false;
    if (done.error) {
      toastError(done.error, t('Save failed'));
      return false;
    }
    return true;
  }

  async function save(): Promise<boolean> {
    if (!editable || !tab.filePath) return false;
    if (!changed) return true;
    if (fxOn) return renderAs();
    if (!(await exportTo(tab.filePath))) return false;
    await load();
    ui.toast(t('Saved {name}', { name: basename(tab.filePath) }), 'success');
    return true;
  }

  async function saveAs(): Promise<boolean> {
    if (!needEditable()) return false;
    if (fxOn) return renderAs();
    const ext = extname(tab.name) || (info?.container === 'mp4' ? 'mp4' : 'webm');
    const filters =
      info?.container === 'mp4'
        ? [{ name: t('MP4 / MOV video'), patterns: '*.mp4;*.mov;*.m4v' }]
        : [{ name: t('WebM / Matroska video'), patterns: '*.webm;*.mkv' }];
    let dest = await api.SaveFileDialog(t('Save video as'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)} (edited).${ext}`), filters);
    if (!dest) return false;
    if (!extname(dest)) dest += `.${ext}`;
    if (!(await exportTo(dest))) return false;
    tab.retarget(dest);
    await load();
    ui.toast(t('Saved {name}', { name: basename(dest) }), 'success');
    return true;
  }

  async function extractAudio(): Promise<boolean> {
    if (!needEditable()) return false;
    if (!info?.hasAudio) {
      ui.toast(t('This video has no audio track.'), 'info');
      return false;
    }
    const ext = info.container === 'mp4' ? 'm4a' : extname(tab.name) === 'webm' ? 'weba' : 'mka';
    let dest = await api.SaveFileDialog(t('Save the audio as'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)}.${ext}`), [{ name: t('Audio'), patterns: `*.${ext}` }]);
    if (!dest) return false;
    if (!extname(dest)) dest += `.${ext}`;
    if (!(await exportTo(dest, true))) return false;
    ui.toast(t('Saved the audio to {name} (copied, no re-encoding)', { name: basename(dest) }), 'success');
    return true;
  }

  /** The picture at the playhead, upright (without effects). */
  function frameCanvas(): HTMLCanvasElement | null {
    if (!el || !natural.w || el.readyState < 2) return null;
    const c = document.createElement('canvas');
    const rot = edit.rotate % 180 !== 0;
    c.width = rot ? natural.h : natural.w;
    c.height = rot ? natural.w : natural.h;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2);
    g.rotate((edit.rotate * Math.PI) / 180);
    g.drawImage(el, -natural.w / 2, -natural.h / 2);
    return c;
  }

  /** The frame for another tab (Ctrl+C, a drag). */
  function giveFrame(): Transfer | null {
    const c = frameCanvas();
    if (!c) {
      ui.toast(t('No picture at the playhead yet.'), 'info');
      return null;
    }
    return { kind: 'image', image: c, name: `${stem(tab.title)} ${formatTime(time, 2).replace(/:/g, '-')}` };
  }

  /** Text as a picture for an overlay: white with a dark edge, wrapped to most of the frame. */
  async function textBitmap(text: string): Promise<ImageBitmap> {
    const size = Math.max(16, Math.round(outH / 12));
    const font = `600 ${size}px "Inter Variable", system-ui, sans-serif`;
    const g0 = document.createElement('canvas').getContext('2d')!;
    g0.font = font;
    const maxW = outW * 0.8;
    const lines: string[] = [];
    for (const para of text.trim().split(/\r?\n/).slice(0, 8)) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && g0.measureText(next).width > maxW) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    const pad = Math.ceil(size / 4);
    const c = document.createElement('canvas');
    c.width = Math.ceil(Math.min(maxW, Math.max(...lines.map((l) => g0.measureText(l).width)))) + pad * 2;
    c.height = Math.ceil(lines.length * size * 1.25) + pad * 2;
    const g = c.getContext('2d')!;
    g.font = font;
    g.textBaseline = 'top';
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, size / 8);
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.fillStyle = '#fff';
    lines.forEach((l, i) => {
      g.strokeText(l, c.width / 2, pad + i * size * 1.25);
      g.fillText(l, c.width / 2, pad + i * size * 1.25);
    });
    return createImageBitmap(c);
  }

  /** From another tab: a picture or text becomes an overlay (where it was dropped), image files too. */
  async function take(tr: Transfer, at?: { x: number; y: number }): Promise<boolean> {
    if (!needEditable() || !outW) return false;
    const p = at && stage && inside(stage.getBoundingClientRect(), at) ? dropPoint(at.x, at.y) : undefined;
    if (tr.kind === 'image') await addImageBitmap(await createImageBitmap(tr.image), tr.name || t('Image'), p);
    else if (tr.kind === 'text') await addImageBitmap(await textBitmap(tr.text), t('Text: {text}', { text: tr.text.trim().slice(0, 24) }), p);
    else {
      const imgs = tr.paths.filter((x) => IMAGE_EXT.includes(extname(x)));
      if (!imgs.length) {
        ui.toast(t('Only pictures can go on top of a video.'), 'info');
        return false;
      }
      await addImages(imgs, p);
    }
    return true;
  }
  const inside = (r: DOMRect, q: { x: number; y: number }) => q.x >= r.left && q.x <= r.right && q.y >= r.top && q.y <= r.bottom;

  async function snapshot() {
    if (!el || !natural.w) return ui.toast(t('No picture to save yet.'), 'info');
    const c = frameCanvas();
    if (!c) return ui.toast(t('No picture to save yet.'), 'info');
    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    } catch {
      /* tainted canvas */
    }
    if (!blob) return ui.toast(t('This video’s frames can’t be read here.'), 'warning');
    const at = formatTime(time, 2).replace(/:/g, '-');
    let dest = await api.SaveFileDialog(t('Save frame as PNG'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)} ${at}.png`), [{ name: 'PNG', patterns: '*.png' }]);
    if (!dest) return;
    if (extname(dest) !== 'png') dest += '.png';
    try {
      await saveFile(dest, blob);
      ui.toast(t('Saved {name}', { name: basename(dest) }), 'success');
    } catch (e) {
      toastError(e);
    }
  }

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage?.requestFullscreen?.().catch(() => {});
  }

  function saveMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      ...(fxOn
        ? [{ label: t('Render video with effects (.webm)…'), shortcut: formatShortcut('Mod+S'), run: () => void renderAs() }]
        : [
            { label: t('Save'), shortcut: formatShortcut('Mod+S'), run: () => void save() },
            { label: t('Save as…'), shortcut: formatShortcut('Mod+Shift+S'), run: () => void saveAs() },
          ]),
      { separator: true },
      { label: t('Extract audio…'), run: () => void extractAudio() },
      { label: t('Save current frame as PNG…'), shortcut: 'P', run: () => void snapshot() },
    ]);
  }

  let statusTimer = 0;
  function updateStatus() {
    if (statusTimer) return;
    statusTimer = window.setTimeout(() => {
      statusTimer = 0;
      const k = E.keptLength(kept);
      tab.status = {
        ...tab.status,
        type: t('{format} video', { format: info?.container === 'mp4' ? 'MP4' : info?.container === 'matroska' ? (extname(tab.name) === 'webm' ? 'WebM' : 'MKV') : extname(tab.name).toUpperCase() }),
        position: `${formatTime(time, 2)} / ${formatTime(dur, 2)}`,
        info: changed && Math.abs(k - dur) > 0.01 ? t('Edited length {length}', { length: formatTime(k, 2) }) : undefined,
      };
    }, 100);
  }

  // Rotation preview: scale so the turned picture still fits.
  const rotScale = $derived.by(() => {
    if (edit.rotate % 180 === 0 || !natural.w || !stageW || !stageH) return 1;
    const fit = Math.min(stageW / natural.w, stageH / natural.h);
    const fitRot = Math.min(stageW / natural.h, stageH / natural.w);
    return fitRot / fit;
  });

  $effect(() => {
    void lineW;
    if (opened && natural.w) void thumbnails();
  });

  videoViews.set(tab.id, {
    toggle,
    frame,
    skip: (s) => seek(time + s),
    home: () => seek(kept[0]?.[0] ?? 0),
    end: () => seek(kept[kept.length - 1]?.[1] ?? dur),
    edit: doEdit,
    fullscreen,
    snapshot: () => void snapshot(),
    mute: () => el && (el.muted = muted = !muted),
    toggleLoop: () => (loopOn = !loopOn),
    dropImages: (paths, x, y) => {
      if (!stage) return false;
      const r = stage.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom || !paths.some((p) => IMAGE_EXT.includes(extname(p)))) return false;
      void addImages(paths, dropPoint(x, y));
      return true;
    },
  });

  /** Window point → output pixel (for drops). */
  function dropPoint(x: number, y: number): { x: number; y: number } | undefined {
    if (!stage || !outW) return undefined;
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / outW, r.height / outH);
    return { x: (x - r.left - (r.width - outW * k) / 2) / k, y: (y - r.top - (r.height - outH * k) / 2) / k };
  }

  function onStageDrop(e: DragEvent) {
    const internal = e.dataTransfer?.getData('application/x-mf-path');
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!internal && !files.length) return;
    e.preventDefault();
    const at = dropPoint(e.clientX, e.clientY);
    if (internal) void addImages([internal], at);
    for (const f of files) void createImageBitmap(f).then((b) => addImageBitmap(b, f.name.replace(/\.[^.]+$/, ''), at));
  }

  onMount(() => {
    tab.handlers = { ...tab.handlers, save, saveAs, reload: () => load(), onShow: () => updateStatus(), getState: () => undefined, give: giveFrame, accept: { kinds: ['image', 'text', 'files'], take } };
    void load();
    return () => {
      videoViews.delete(tab.id);
      clearTimeout(statusTimer);
      cancelAnimationFrame(raf);
      thumbGen++;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      release();
      comp?.destroy();
      comp = null;
      el2?.removeAttribute('src');
      rendering?.abort.abort();
      tracking = '';
      for (const b of assets.values()) b.close();
    };
  });

  (tab as unknown as { videoTest: unknown }).videoTest = {
    opened: () => opened,
    loading: () => loading,
    error: () => error,
    playError: () => playError,
    el: () => el,
    time: () => time,
    playing: () => playing,
    edit: () => edit,
    kept: () => kept,
    sel: () => sel,
    setSel,
    seek,
    toggle,
    doEdit,
    exportTo,
    save,
    natural: () => natural,
    fx: () => fx,
    setFx: (p: P.Project) => setFx(p, true),
    addImageBitmap,
    addBlur,
    drawOutline,
    drawing: () => drawing,
    selectLayer: (id: string | null) => (selId = id),
    stageChange,
    trackLayer,
    renderTo,
    drawNow,
    fxCanvas: () => fxCanvas,
    outLen: () => outLen,
  };
</script>

<div class="vwrap">
<div class="vmain">
<header class="head">
  <div class="meta">
    <div class="title" title={tab.title}>{info?.title || tab.title}</div>
    <div class="tech">{techLine}</div>
  </div>
</header>

<div class="stage" bind:this={stage} bind:clientWidth={stageW} bind:clientHeight={stageH} onclick={toggle} ondblclick={fullscreen} ondragover={(e) => e.preventDefault()} ondrop={onStageDrop} role="presentation">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={el}
    preload="auto"
    class:fxhide={fxOn}
    style:transform={edit.rotate && !fxOn ? `rotate(${edit.rotate}deg) scale(${rotScale})` : ''}
    onloadedmetadata={onMeta}
    onerror={onError}
    onplay={() => ((playing = true), !raf && (raf = requestAnimationFrame(tick)))}
    onpause={() => ((playing = false), tick())}
    onseeked={() => tick()}
    ontimeupdate={() => !playing && (time = el!.currentTime)}
  ></video>
  <!-- The next part during a transition preview. -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={el2} class="el2" muted preload="auto" crossorigin="anonymous"></video>
  <canvas bind:this={fxCanvas} class="fxcanvas" class:hidden={!fxOn}></canvas>
  {#if fxOn && outW}
    <FxStage W={outW} H={outH} {stageW} {stageH} layers={fx.layers} selected={selId} {time} bind:drawing onselect={(id) => ((selId = id), id && (fxPanel = true))} onchange={stageChange} onlayer={updateLayer} ondraw={drawOutline} />
  {/if}
  {#if loading}<div class="overlay"><span class="spinner"></span></div>{/if}
  {#if error}<div class="overlay err">{error}</div>{/if}
  {#if playError && !error}<div class="overlay note">{playError}</div>{/if}
</div>

<div class="timeline" bind:clientWidth={lineW} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} role="slider" aria-label={t('Timeline')} aria-valuemin={0} aria-valuemax={dur} aria-valuenow={time} tabindex="-1">
  <canvas class="strip" bind:this={strip}></canvas>
  {#if info?.keyframes.length && info.keyframes.length < lineW / 3}
    {#each info.keyframes as k, i (i)}<div class="kf" style:left="{xOf(k)}px"></div>{/each}
  {/if}
  {#each gaps as g (g[0])}
    {@const w = xOf(g[1]) - xOf(g[0])}
    <div class="gone" style:left="{xOf(g[0])}px" style:width="{w}px" title={t('Removed {from} – {to} ({length})', { from: formatTime(g[0], 2), to: formatTime(g[1], 2), length: formatTime(g[1] - g[0], 1) })}>
      {#if w > 70}<span class="gone-label">{t('removed')}</span>{/if}
      {#if w > 22}<button class="restore" title={t('Restore this part')} aria-label={t('Restore removed part')} onpointerdown={(e) => e.stopPropagation()} onclick={() => restoreGap(g)}>↺</button>{/if}
    </div>
  {/each}
  {#each fx.speeds as sp (sp.a)}
    <div class="speedband" class:slow={sp.rate < 1} style:left="{xOf(sp.a)}px" style:width="{xOf(sp.b) - xOf(sp.a)}px" title={t('{rate}× from {from} to {to}', { rate: sp.rate, from: formatTime(sp.a, 1), to: formatTime(sp.b, 1) })}><span>{sp.rate}×</span></div>
  {/each}
  {#if editable}
    {#each kept.slice(0, -1) as r (r[1])}
      {@const tr = fx.transitions.find((x) => Math.abs(x.at - r[1]) < 0.02)}
      <button class="join" class:has={!!tr} style:left="{xOf(r[1])}px" title={tr ? t('{transition} ({s} s) — click to change', { transition: P.TRANSITIONS.find((x) => x.id === tr.kind)?.label ?? '', s: tr.dur }) : t('Add a transition here')} onpointerdown={(e) => e.stopPropagation()} onclick={(e) => transitionMenu(e, r[1])}>⧉</button>
    {/each}
  {/if}
  {#each flash as f (f[0])}<div class="flash" style:left="{xOf(f[0])}px" style:width="{Math.max(3, xOf(f[1]) - xOf(f[0]))}px"></div>{/each}
  {#if sel}
    <div class="dim" style:left="0px" style:width="{xOf(sel[0])}px"></div>
    <div class="dim" style:left="{xOf(sel[1])}px" style:right="0px"></div>
    <div class="sel" style:left="{xOf(sel[0])}px" style:width="{xOf(sel[1]) - xOf(sel[0])}px">
      <span class="handle l" role="presentation" title={t('Drag to move the start')} onpointerdown={(e) => edgeDown(e, 0)}></span>
      <span class="handle r" role="presentation" title={t('Drag to move the end')} onpointerdown={(e) => edgeDown(e, 1)}></span>
    </div>
  {/if}
  <div class="playhead" style:left="{xOf(time)}px"></div>
</div>
<FxTracks layers={fx.layers} {dur} {lineW} {time} selected={selId} onselect={(id) => ((selId = id), (fxPanel = true))} onchange={(l, done) => updateLayer(l, done)} onseek={seek} />
{#if rendering}
  <div class="renderbar">
    <span>{t('Rendering…')} {Math.round((rendering.done / Math.max(1, rendering.total)) * 100)}%</span>
    <progress max={rendering.total} value={rendering.done}></progress>
    <button class="btn ghost" onclick={() => rendering?.abort.abort()}>{t('Cancel')}</button>
  </div>
{/if}
{#if sel}
  <div class="selbar">
    <span class="selchip"><Icon icon={Scissors} size={13} /> {t('Selected {length}', { length: formatTime(sel[1] - sel[0], 2) })} <span class="muted">({formatTime(sel[0], 2)} – {formatTime(sel[1], 2)})</span></span>
    {#if editable}
      <button class="btn ghost danger" title="{t('Cut out the selected part')} (Del)" onclick={() => doEdit('cut')}><Icon icon={Scissors} size={14} /> {t('Cut out')}</button>
      <button class="btn ghost" title="{t('Keep only the selected part')} (T)" onclick={() => doEdit('keep')}><Icon icon={Crop} size={14} /> {t('Keep only this')}</button>
    {/if}
    <button class="btn ghost" title="{t('Clear the selection')} (Esc)" onclick={() => doEdit('clearSel')}>{t('Deselect')}</button>
  </div>
{/if}

<div class="toolbar controls" use:fitBar>
  <button class="icon-btn play" title="{playing ? t('Pause') : t('Play')} (Space)" onclick={toggle} disabled={!!playError}><Icon icon={playing ? Pause : Play} size={16} /></button>
  <button class="icon-btn" title="{t('Previous frame')} (,)" onclick={() => frame(-1)}><Icon icon={StepBack} size={15} /></button>
  <button class="icon-btn" title="{t('Next frame')} (.)" onclick={() => frame(1)}><Icon icon={StepForward} size={15} /></button>
  <span class="time">{formatTime(time, 2)} <span class="muted">/ {formatTime(dur, 2)}</span></span>
  {#if changed}<span class="label edited" title={t('Length after your edits')}>{t('Edited: {length}', { length: formatTime(outLen, 2) })}{gaps.length ? ` · ${tn('{n} part removed', '{n} parts removed', gaps.length)}` : ''}{edit.rotate ? ` · ↻${edit.rotate}°` : ''}{edit.mute ? ` · ${t('no audio')}` : ''}</span>{/if}
  <span class="spacer"></span>
  <button class="icon-btn" class:on={loopOn} title="{t('Loop selection')} (L)" onclick={() => (loopOn = !loopOn)}><Icon icon={Repeat} size={14} /></button>
  <button class="icon-btn" title="{muted ? t('Unmute') : t('Mute')} (M)" onclick={() => el && (el.muted = muted = !muted)}><Icon icon={muted ? VolumeX : Volume2} size={15} /></button>
  <input class="vol" type="range" min="0" max="1" step="0.01" bind:value={volume} oninput={() => el && (el.volume = volume)} aria-label={t('Volume', {}, 'sound')} />
  <select bind:value={speed} onchange={() => el && (el.playbackRate = speed)} title={t('Playback speed')} aria-label={t('Playback speed')}>
    {#each [0.25, 0.5, 1, 1.5, 2] as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  <button class="icon-btn" title="{t('Save frame as PNG')} (P)" onclick={() => void snapshot()}><Icon icon={Camera} size={15} /></button>
  <button class="icon-btn" title="{t('Full screen')} (F)" onclick={fullscreen}><Icon icon={Maximize} size={15} /></button>
  {#if editable}
    <span class="sep"></span>
    <button class="icon-btn" title="{t('Cut out selection')} (Del)" onclick={() => doEdit('cut')}><Icon icon={Scissors} size={15} /></button>
    <button class="icon-btn" title="{t('Keep only selection')} (T)" onclick={() => doEdit('keep')}><Icon icon={Crop} size={15} /></button>
    <button class="icon-btn" class:on={edit.rotate !== 0} title="{t('Rotate 90°')} (R)" onclick={() => doEdit('rotate')}><Icon icon={RotateCw} size={15} /></button>
    <button class="btn ghost" class:on={edit.mute} title={t('Save without the audio track')} onclick={() => doEdit('removeAudio')}><Icon icon={VolumeX} size={14} /> {edit.mute ? t('Audio removed') : t('Remove audio')}</button>
    <button class="icon-btn" title="{t('Undo')} ({formatShortcut('Mod+Z')})" disabled={!canUndo} onclick={() => doEdit('undo')}><Icon icon={Undo2} size={15} /></button>
    <button class="icon-btn" title="{t('Redo')} ({formatShortcut('Mod+Shift+Z')})" disabled={!canRedo} onclick={() => doEdit('redo')}><Icon icon={Redo2} size={15} /></button>
    <span class="sep"></span>
    <button class="icon-btn" title={t('Add an image on top of the video (or drop one on the picture)')} onclick={() => void addImages()}><Icon icon={ImagePlus} size={15} /></button>
    <GiveButton {tab} get={giveFrame} what={t('this frame')} />
    <button class="icon-btn" title={t('Blur an area (faces, plates…); it can follow a moving object')} onclick={blurMenu}><Icon icon={Droplet} size={15} /></button>
    <button class="icon-btn" class:on={fx.speeds.length > 0} title={t('Speed up or slow down the selection (or the whole video)')} onclick={speedMenu}><Icon icon={Gauge} size={15} /></button>
    <button class="icon-btn" class:on={fxPanel} title={t('Effects panel: overlays, keyframes, curves, fades, transitions')} onclick={() => (fxPanel = !fxPanel)}><Icon icon={Wand} size={15} /></button>
    <button class="btn ghost" onclick={saveMenu}><Icon icon={Save} size={14} /> {fxOn ? t('Render') : t('Save')} ▾</button>
  {/if}
</div>
{#if snapped && changed && !fxOn}
  <div class="hint">{gop ? t('Cuts snap to keyframes (about every {s} s in this file) so the video is saved without re-encoding; the shaded parts are what will be removed.', { s: num(gop, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : t('Cuts snap to keyframes so the video is saved without re-encoding; the shaded parts are what will be removed.')}</div>
{/if}

</div>
{#if fxPanel && editable}
  <FxPanel
    project={fx}
    selected={selLayer}
    {time}
    duration={dur}
    bind:autoKey
    bind:drawing
    {tracking}
    onselect={(id) => (selId = id)}
    onlayer={(l) => updateLayer(l)}
    onproject={(p) => setFx(p)}
    onstate={(l, st) => updateLayer(P.place(l, time, st, autoKey))}
    onseek={seek}
    ontrack={(l) => void trackLayer(l)}
    ondelete={deleteLayer}
  />
{/if}
</div>

<style>
  .vwrap {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .vmain {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .fxcanvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .fxcanvas.hidden {
    display: none;
  }
  video.fxhide {
    opacity: 0;
  }
  .el2 {
    position: absolute;
    width: 2px;
    height: 2px;
    opacity: 0;
    pointer-events: none;
  }
  .speedband {
    position: absolute;
    top: 0;
    height: 12px;
    background: rgba(91, 141, 239, 0.75);
    color: #fff;
    font-size: calc(9.5px * var(--ui-scale));
    line-height: 12px;
    overflow: hidden;
    pointer-events: none;
    border-radius: 0 0 3px 3px;
  }
  .speedband.slow {
    background: rgba(214, 160, 60, 0.85);
  }
  .speedband span {
    padding: 0 4px;
  }
  .join {
    position: absolute;
    bottom: 2px;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: calc(11px * var(--ui-scale));
    line-height: 16px;
    padding: 0;
    cursor: pointer;
    z-index: 2;
  }
  .join.has {
    background: var(--accent);
  }
  .renderbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 8px 0;
    font-size: var(--fs-small);
  }
  .renderbar progress {
    flex: 1;
    accent-color: var(--accent);
  }
  .head {
    padding: 10px 16px 6px;
  }
  .title {
    font-family: var(--font-serif);
    font-size: 1.1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tech {
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    background: #000;
    margin: 0 8px;
    border-radius: var(--radius);
    overflow: hidden;
    display: grid;
    place-items: center;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    transition: transform 0.15s ease;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #ddd;
    text-align: center;
    padding: 16px;
  }
  .err {
    color: var(--danger);
  }
  .note {
    background: rgba(0, 0, 0, 0.55);
  }
  .timeline {
    position: relative;
    height: 52px;
    margin: 6px 8px 0;
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
  }
  .strip {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.85;
  }
  .kf {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 6px;
    background: var(--text-faint);
    pointer-events: none;
  }
  .gone {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.62) 0 6px, rgba(0, 0, 0, 0.45) 6px 12px);
    pointer-events: none;
  }
  .gone-label {
    position: absolute;
    left: 6px;
    top: 4px;
    font-size: calc(10.5px * var(--ui-scale));
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.75);
    pointer-events: none;
  }
  .restore {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.85);
    color: #222;
    font-size: calc(12px * var(--ui-scale));
    line-height: 18px;
    padding: 0;
    cursor: pointer;
    pointer-events: auto;
  }
  .restore:hover {
    background: #fff;
  }
  .flash {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--danger);
    pointer-events: none;
    animation: flash 1.2s ease-out forwards;
  }
  @keyframes flash {
    0% {
      opacity: 0.95;
    }
    100% {
      opacity: 0;
    }
  }
  .dim {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .sel {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(217, 119, 87, 0.18);
    border: 2px solid var(--accent);
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 26px;
    margin-top: -13px;
    background: var(--accent);
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    cursor: ew-resize;
    pointer-events: auto;
  }
  .handle.l {
    left: -6px;
  }
  .handle.r {
    right: -6px;
  }
  .selbar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 8px 0;
    padding: 4px 8px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    font-size: var(--fs-small);
  }
  .selchip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    margin-right: auto;
  }
  .selchip .muted {
    font-weight: 400;
    color: var(--text-muted);
  }
  .danger {
    color: var(--danger);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    pointer-events: none;
  }
  .controls {
    margin-top: 2px;
  }
  .time {
    font-variant-numeric: tabular-nums;
    margin-left: 6px;
  }
  .label {
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }
  .edited {
    color: var(--accent-text);
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .vol {
    width: 70px;
    accent-color: var(--accent);
  }
  .hint {
    font-size: var(--fs-small);
    color: var(--text-faint);
    padding: 0 16px 8px;
  }
</style>
