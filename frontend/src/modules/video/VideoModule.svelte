<script lang="ts">
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
  import { formatTime } from '../audio/waveform';
  import * as E from './edits';
  import { videoViews, type VideoOp } from './views';

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
  let edit = $state.raw<E.VideoEdit>({ keep: [], rotate: 0, mute: false });
  let undoStack: E.VideoEdit[] = [];
  let redoStack: E.VideoEdit[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let natural = $state({ w: 0, h: 0 });

  const dur = $derived(info?.duration || el?.duration || 0);
  const editable = $derived(!!info?.editable);
  const kept = $derived(E.snap(edit.keep, info?.keyframes ?? [], dur));
  const snapped = $derived(kept.length !== E.normalize(edit.keep, dur).length || kept.some((r, i) => Math.abs(r[0] - edit.keep[i]?.[0]) > 0.001 || Math.abs(r[1] - edit.keep[i]?.[1]) > 0.001));
  const gop = $derived(info && info.keyframes.length > 1 ? (info.keyframes[info.keyframes.length - 1] - info.keyframes[0]) / (info.keyframes.length - 1) : 0);
  const changed = $derived(!!info && !E.isUnchanged(edit, dur));
  const techLine = $derived.by(() => {
    if (!info) return '';
    const p: string[] = [];
    if (info.hasVideo) {
      p.push(info.videoCodec || 'video');
      if (info.width) p.push(`${info.width}×${info.height}`);
      if (info.fps) p.push(`${+info.fps.toFixed(2)} fps`);
    }
    if (info.hasAudio) p.push(`${info.audioCodec || 'audio'}${info.channels ? (info.channels === 1 ? ' mono' : info.channels === 2 ? ' stereo' : ` ${info.channels} ch`) : ''}`);
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
      if (!tab.filePath) throw new Error('Videos inside archives can’t be played yet — extract it first.');
      const o = await api.VideoOpen(tab.filePath);
      if (!o?.info) throw new Error('Couldn’t read this video.');
      opened = o;
      edit = { keep: o.info.duration ? [[0, o.info.duration]] : [], rotate: 0, mute: false };
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
    playError = `This system can’t play ${codec} video.${editable ? ' You can still cut, rotate and save it.' : ''}`;
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
    const h = 44;
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
        v.onerror = () => rej(new Error('no thumbnails'));
        setTimeout(() => rej(new Error('timeout')), 8000);
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
          if (r.range) el.currentTime = r.range[0];
          else {
            el.pause();
            el.currentTime = kept[0][0];
          }
        }
      }
    }
    updateStatus();
    if (playing) raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (!el || playError) return;
    if (el.paused) {
      if (kept.length && (time >= kept[kept.length - 1][1] - 0.05 || !E.rangeAt(kept, time).range)) el.currentTime = kept[0][0];
      if (loopOn && sel) el.currentTime = sel[0];
      void el.play().catch((e) => ui.toast(`Can’t play: ${(e as Error).message}`, 'warning'));
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
    tab.dirty = changed;
    updateStatus();
  }

  function needEditable(): boolean {
    if (editable) return true;
    ui.toast(`${info?.reason || 'This video can be played but not edited'}.`, 'info');
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
        if (!sel) return ui.toast('Select a part of the timeline first: drag across it, or press I and O at the start and end.', 'info');
        const keep = op === 'cut' ? E.cut(edit.keep, sel[0], sel[1], dur) : E.keepOnly(edit.keep, sel[0], sel[1], dur);
        if (!keep.length) return ui.toast('That would remove everything.', 'warning');
        commit({ ...edit, keep });
        sel = null;
        return;
      }
      case 'rotate':
        if (info?.container !== 'mp4') return ui.toast('Rotation can be saved in MP4 and MOV files only (WebM/MKV have no standard rotation flag).', 'info');
        return commit({ ...edit, rotate: (edit.rotate + 90) % 360 });
      case 'removeAudio':
        if (!info?.hasAudio) return ui.toast('This video has no audio track.', 'info');
        return commit({ ...edit, mute: !edit.mute });
    }
  }

  // ---------- saving ----------

  function plan(audioOnly = false) {
    return { keep: edit.keep.map((r) => [r[0], r[1]]), rotate: audioOnly ? 0 : edit.rotate, mute: audioOnly ? false : edit.mute, audioOnly };
  }

  async function exportTo(dest: string, audioOnly = false): Promise<boolean> {
    el?.pause();
    const done = await jobs.run<number[][]>(`Saving ${basename(dest)}`, () => api.VideoExport(tab.filePath!, plan(audioOnly) as never, dest));
    if (done.cancelled) return false;
    if (done.error) {
      toastError(done.error, 'Save failed');
      return false;
    }
    return true;
  }

  async function save(): Promise<boolean> {
    if (!editable || !tab.filePath) return false;
    if (!changed) return true;
    if (!(await exportTo(tab.filePath))) return false;
    await load();
    ui.toast(`Saved ${basename(tab.filePath)}`, 'success');
    return true;
  }

  async function saveAs(): Promise<boolean> {
    if (!needEditable()) return false;
    const ext = extname(tab.name) || (info?.container === 'mp4' ? 'mp4' : 'webm');
    const filters =
      info?.container === 'mp4'
        ? [{ name: 'MP4 / MOV video', patterns: '*.mp4;*.mov;*.m4v' }]
        : [{ name: 'WebM / Matroska video', patterns: '*.webm;*.mkv' }];
    let dest = await api.SaveFileDialog('Save video as', join(dirname(tab.filePath ?? ''), `${stem(tab.title)} (edited).${ext}`), filters);
    if (!dest) return false;
    if (!extname(dest)) dest += `.${ext}`;
    if (!(await exportTo(dest))) return false;
    tab.retarget(dest);
    await load();
    ui.toast(`Saved ${basename(dest)}`, 'success');
    return true;
  }

  async function extractAudio(): Promise<boolean> {
    if (!needEditable()) return false;
    if (!info?.hasAudio) {
      ui.toast('This video has no audio track.', 'info');
      return false;
    }
    const ext = info.container === 'mp4' ? 'm4a' : extname(tab.name) === 'webm' ? 'weba' : 'mka';
    let dest = await api.SaveFileDialog('Save the audio as', join(dirname(tab.filePath ?? ''), `${stem(tab.title)}.${ext}`), [{ name: 'Audio', patterns: `*.${ext}` }]);
    if (!dest) return false;
    if (!extname(dest)) dest += `.${ext}`;
    if (!(await exportTo(dest, true))) return false;
    ui.toast(`Saved the audio to ${basename(dest)} (copied, no re-encoding)`, 'success');
    return true;
  }

  async function snapshot() {
    if (!el || !natural.w) return ui.toast('No picture to save yet.', 'info');
    const c = document.createElement('canvas');
    const rot = edit.rotate % 180 !== 0;
    c.width = rot ? natural.h : natural.w;
    c.height = rot ? natural.w : natural.h;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2);
    g.rotate((edit.rotate * Math.PI) / 180);
    g.drawImage(el, -natural.w / 2, -natural.h / 2);
    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    } catch {
      /* tainted canvas */
    }
    if (!blob) return ui.toast('This video’s frames can’t be read here.', 'warning');
    const at = formatTime(time, 2).replace(/:/g, '-');
    let dest = await api.SaveFileDialog('Save frame as PNG', join(dirname(tab.filePath ?? ''), `${stem(tab.title)} ${at}.png`), [{ name: 'PNG', patterns: '*.png' }]);
    if (!dest) return;
    if (extname(dest) !== 'png') dest += '.png';
    try {
      await saveFile(dest, blob);
      ui.toast(`Saved ${basename(dest)}`, 'success');
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
      { label: 'Save', shortcut: formatShortcut('Mod+S'), run: () => void save() },
      { label: 'Save as…', shortcut: formatShortcut('Mod+Shift+S'), run: () => void saveAs() },
      { separator: true },
      { label: 'Extract audio…', run: () => void extractAudio() },
      { label: 'Save current frame as PNG…', shortcut: 'P', run: () => void snapshot() },
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
        type: `${info?.container === 'mp4' ? 'MP4' : info?.container === 'matroska' ? (extname(tab.name) === 'webm' ? 'WebM' : 'MKV') : extname(tab.name).toUpperCase()} video`,
        position: `${formatTime(time, 2)} / ${formatTime(dur, 2)}`,
        info: changed && Math.abs(k - dur) > 0.01 ? `Edited length ${formatTime(k, 2)}` : undefined,
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
  });

  onMount(() => {
    tab.handlers = { ...tab.handlers, save, saveAs, reload: () => load(), onShow: () => updateStatus(), getState: () => undefined };
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
  };
</script>

<header class="head">
  <div class="meta">
    <div class="title" title={tab.title}>{info?.title || tab.title}</div>
    <div class="tech">{techLine}</div>
  </div>
</header>

<div class="stage" bind:this={stage} bind:clientWidth={stageW} bind:clientHeight={stageH} onclick={toggle} ondblclick={fullscreen} role="presentation">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={el}
    preload="auto"
    style:transform={edit.rotate ? `rotate(${edit.rotate}deg) scale(${rotScale})` : ''}
    onloadedmetadata={onMeta}
    onerror={onError}
    onplay={() => ((playing = true), !raf && (raf = requestAnimationFrame(tick)))}
    onpause={() => ((playing = false), tick())}
    onseeked={() => tick()}
    ontimeupdate={() => !playing && (time = el!.currentTime)}
  ></video>
  {#if loading}<div class="overlay"><span class="spinner"></span></div>{/if}
  {#if error}<div class="overlay err">{error}</div>{/if}
  {#if playError && !error}<div class="overlay note">{playError}</div>{/if}
</div>

<div class="timeline" bind:clientWidth={lineW} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={time} tabindex="-1">
  <canvas class="strip" bind:this={strip}></canvas>
  {#if info?.keyframes.length && info.keyframes.length < lineW / 3}
    {#each info.keyframes as k, i (i)}<div class="kf" style:left="{xOf(k)}px"></div>{/each}
  {/if}
  {#each kept as r, i (i)}
    {#if i === 0 && r[0] > 0}<div class="gone" style:left="0px" style:width="{xOf(r[0])}px"></div>{/if}
    <div class="gone" style:left="{xOf(r[1])}px" style:width="{xOf(kept[i + 1]?.[0] ?? dur) - xOf(r[1])}px"></div>
  {/each}
  {#if sel}<div class="sel" style:left="{xOf(sel[0])}px" style:width="{xOf(sel[1]) - xOf(sel[0])}px"></div>{/if}
  <div class="playhead" style:left="{xOf(time)}px"></div>
</div>

<div class="toolbar controls">
  <button class="icon-btn play" title="{playing ? 'Pause' : 'Play'} (Space)" onclick={toggle} disabled={!!playError}><Icon icon={playing ? Pause : Play} size={16} /></button>
  <button class="icon-btn" title="Previous frame (,)" onclick={() => frame(-1)}><Icon icon={StepBack} size={15} /></button>
  <button class="icon-btn" title="Next frame (.)" onclick={() => frame(1)}><Icon icon={StepForward} size={15} /></button>
  <span class="time">{formatTime(time, 2)} <span class="muted">/ {formatTime(dur, 2)}</span></span>
  {#if sel}<span class="label">Selection {formatTime(sel[0], 2)} – {formatTime(sel[1], 2)}</span>{/if}
  {#if changed}<span class="label edited">→ {formatTime(E.keptLength(kept), 2)}{edit.rotate ? ` · ↻${edit.rotate}°` : ''}{edit.mute ? ' · no audio' : ''}</span>{/if}
  <span class="spacer"></span>
  <button class="icon-btn" class:on={loopOn} title="Loop selection (L)" onclick={() => (loopOn = !loopOn)}><Icon icon={Repeat} size={14} /></button>
  <button class="icon-btn" title={muted ? 'Unmute (M)' : 'Mute (M)'} onclick={() => el && (el.muted = muted = !muted)}><Icon icon={muted ? VolumeX : Volume2} size={15} /></button>
  <input class="vol" type="range" min="0" max="1" step="0.01" bind:value={volume} oninput={() => el && (el.volume = volume)} aria-label="Volume" />
  <select bind:value={speed} onchange={() => el && (el.playbackRate = speed)} title="Playback speed" aria-label="Playback speed">
    {#each [0.25, 0.5, 1, 1.5, 2] as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  <button class="icon-btn" title="Save frame as PNG (P)" onclick={() => void snapshot()}><Icon icon={Camera} size={15} /></button>
  <button class="icon-btn" title="Full screen (F)" onclick={fullscreen}><Icon icon={Maximize} size={15} /></button>
  {#if editable}
    <span class="sep"></span>
    <button class="icon-btn" title="Cut out selection (Del)" onclick={() => doEdit('cut')}><Icon icon={Scissors} size={15} /></button>
    <button class="icon-btn" title="Keep only selection (T)" onclick={() => doEdit('keep')}><Icon icon={Crop} size={15} /></button>
    <button class="icon-btn" class:on={edit.rotate !== 0} title="Rotate 90° (R)" onclick={() => doEdit('rotate')}><Icon icon={RotateCw} size={15} /></button>
    <button class="btn ghost" class:on={edit.mute} title="Save without the audio track" onclick={() => doEdit('removeAudio')}>{edit.mute ? 'Audio removed' : 'Remove audio'}</button>
    <button class="icon-btn" title="Undo ({formatShortcut('Mod+Z')})" disabled={!canUndo} onclick={() => doEdit('undo')}><Icon icon={Undo2} size={15} /></button>
    <button class="icon-btn" title="Redo ({formatShortcut('Mod+Shift+Z')})" disabled={!canRedo} onclick={() => doEdit('redo')}><Icon icon={Redo2} size={15} /></button>
    <button class="btn ghost" onclick={saveMenu}>Save ▾</button>
  {/if}
</div>
{#if snapped && changed}
  <div class="hint">Cuts snap to keyframes{gop ? ` (about every ${gop.toFixed(1)} s in this file)` : ''} so the video is saved without re-encoding; the shaded parts are what will be removed.</div>
{/if}

<style>
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
    height: 44px;
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
  .sel {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent-soft);
    border-left: 2px solid var(--accent);
    border-right: 2px solid var(--accent);
    opacity: 0.6;
    pointer-events: none;
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
