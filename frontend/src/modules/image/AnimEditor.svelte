<script lang="ts">
  import { fitBar } from '../../core/fit';
  import ImageDown from '@lucide/svelte/icons/image-down';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Timer from '@lucide/svelte/icons/timer';
  import Repeat2 from '@lucide/svelte/icons/repeat-2';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  // Animated GIF / WebP: play, step through frames, and edit the animation —
  // select frames (click, Shift, Ctrl), delete, duplicate, reverse, move,
  // change their timing (or the speed of everything), loop count; save as
  // GIF or animated WebP. Frames are full PNGs written by Go.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import StepBack from '@lucide/svelte/icons/step-back';
  import StepForward from '@lucide/svelte/icons/step-forward';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import { api, fileUrl } from '../../core/backend';
  import { extname, join, dirname, stem } from '../../core/paths';
  import type { Tab } from '../../core/tabs.svelte';
  import { formatShortcut } from '../../core/keys';
  import { toastError, ui } from '../../core/ui.svelte';

  interface Frame {
    path: string;
    delay: number;
  }
  let { tab, info }: { tab: Tab; info: { width: number; height: number; loop: number; frames: Frame[] } } = $props();

  // svelte-ignore state_referenced_locally
  let frames = $state<Frame[]>(info.frames.map((f) => ({ ...f })));
  // svelte-ignore state_referenced_locally
  let loop = $state(info.loop);
  let cur = $state(0);
  let sel = $state<Set<number>>(new Set([0]));
  let anchor = 0;
  let playing = $state(true);
  let speed = $state(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let past = $state.raw<{ frames: Frame[]; loop: number }[]>([]);
  let future = $state.raw<{ frames: Frame[]; loop: number }[]>([]);
  let saved = JSON.stringify({ frames, loop });
  const total = $derived(frames.reduce((n, f) => n + f.delay, 0));

  $effect(() => {
    tab.dirty = JSON.stringify({ frames, loop }) !== saved;
  });

  function schedule() {
    clearTimeout(timer);
    if (!playing || frames.length < 2) return;
    timer = setTimeout(
      () => {
        cur = (cur + 1) % frames.length;
        schedule();
      },
      Math.max(10, frames[cur].delay / speed),
    );
  }
  $effect(() => {
    void playing;
    void speed;
    void frames.length;
    schedule();
    return () => clearTimeout(timer);
  });

  function commit(next: Frame[], nextLoop = loop) {
    past = [...past.slice(-199), { frames: frames.map((f) => ({ ...f })), loop }];
    future = [];
    frames = next;
    loop = nextLoop;
    cur = Math.min(cur, frames.length - 1);
    sel = new Set([...sel].filter((i) => i < frames.length));
    if (!sel.size) sel = new Set([cur]);
  }

  export function undo() {
    const s = past[past.length - 1];
    if (!s) return;
    past = past.slice(0, -1);
    future = [...future, { frames, loop }];
    frames = s.frames;
    loop = s.loop;
    cur = Math.min(cur, frames.length - 1);
  }
  export function redo() {
    const s = future[future.length - 1];
    if (!s) return;
    future = future.slice(0, -1);
    past = [...past, { frames, loop }];
    frames = s.frames;
    loop = s.loop;
  }

  const selected = () => [...sel].sort((a, b) => a - b);

  function click(i: number, e: MouseEvent) {
    playing = false;
    cur = i;
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      sel = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(sel);
      if (s.has(i) && s.size > 1) s.delete(i);
      else s.add(i);
      sel = s;
      anchor = i;
    } else {
      sel = new Set([i]);
      anchor = i;
    }
  }

  export function remove() {
    if (sel.size >= frames.length) return ui.toast('An animation needs at least one frame.', 'warning');
    commit(frames.filter((_, i) => !sel.has(i)));
    sel = new Set([Math.min(cur, frames.length - 1)]);
  }
  function duplicate() {
    const s = selected();
    const last = s[s.length - 1];
    const copies = s.map((i) => ({ ...frames[i] }));
    commit([...frames.slice(0, last + 1), ...copies, ...frames.slice(last + 1)]);
    sel = new Set(copies.map((_, k) => last + 1 + k));
  }
  function reverse() {
    const s = selected();
    if (s.length < 2) return commit([...frames].reverse());
    const next = [...frames];
    const rev = s.map((i) => frames[i]).reverse();
    s.forEach((i, k) => (next[i] = rev[k]));
    commit(next);
  }
  function move(dir: -1 | 1) {
    const s = selected();
    if (dir < 0 ? s[0] === 0 : s[s.length - 1] === frames.length - 1) return;
    const next = [...frames];
    for (const i of dir < 0 ? s : [...s].reverse()) [next[i], next[i + dir]] = [next[i + dir], next[i]];
    commit(next);
    sel = new Set(s.map((i) => i + dir));
    cur += dir;
  }
  async function setDelay() {
    const s = selected();
    const v = await ui.prompt(`Show ${s.length === 1 ? 'this frame' : `these ${s.length} frames`} for (milliseconds)`, String(frames[s[0]].delay), 'Set');
    const ms = Math.round(Number(v));
    if (!v || !(ms >= 10 && ms <= 60000)) return;
    commit(frames.map((f, i) => (sel.has(i) ? { ...f, delay: ms } : f)));
  }
  export function retime(k: number) {
    commit(frames.map((f) => ({ ...f, delay: Math.max(10, Math.round(f.delay / k)) })));
  }
  function dropEveryOther() {
    if (frames.length < 4) return;
    // Keep the total duration: each kept frame absorbs the dropped one's time.
    const next: Frame[] = [];
    for (let i = 0; i < frames.length; i += 2) next.push({ ...frames[i], delay: frames[i].delay + (frames[i + 1]?.delay ?? 0) });
    commit(next);
  }

  async function writeTo(path: string): Promise<boolean> {
    const fmt = extname(path) === 'webp' ? 'webp' : 'gif';
    try {
      await api.AnimSave($state.snapshot(frames), loop, path, fmt);
      const e = await api.Stat(path);
      tab.size = e.size;
      saved = JSON.stringify({ frames, loop });
      tab.dirty = false;
      return true;
    } catch (e) {
      toastError(e, 'Save failed');
      return false;
    }
  }

  export async function save(): Promise<boolean> {
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeTo(tab.filePath);
  }

  export async function saveAs(): Promise<boolean> {
    const base = tab.filePath ?? join(dirname(tab.path ?? ''), tab.title);
    const p = await api.SaveFileDialog('Save animation as', base, [
      { name: 'GIF', patterns: '*.gif' },
      { name: 'Animated WebP (lossless)', patterns: '*.webp' },
    ]);
    if (!p) return false;
    const target = ['gif', 'webp'].includes(extname(p)) ? p : `${p}.gif`;
    const ok = await writeTo(target);
    if (ok) tab.retarget(target);
    return ok;
  }

  async function exportFrame() {
    const def = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)} frame ${cur + 1}.png`);
    const p = await api.SaveFileDialog('Export frame as PNG', def, [{ name: 'PNG', patterns: '*.png' }]);
    if (p) await api.CopyFile(frames[cur].path, /\.png$/i.test(p) ? p : `${p}.png`).catch((e) => toastError(e));
  }

  function key(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      playing = !playing;
    }
  }

  /** Previous/next frame (← / →, routed here by the image commands). */
  export function step(dir: 1 | -1) {
    playing = false;
    cur = (cur + dir + frames.length) % frames.length;
    sel = new Set([cur]);
    anchor = cur;
  }

  let strip = $state<HTMLDivElement>();
  $effect(() => {
    strip?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  onMount(() => () => clearTimeout(timer));

  (tab as unknown as { animTest: unknown }).animTest = {
    frames: () => frames,
    loop: () => loop,
    setLoop: (n: number) => commit(frames, n),
    select: (ids: number[]) => ((sel = new Set(ids)), (cur = ids[0])),
    remove,
    duplicate,
    reverse,
    retime,
    dropEveryOther,
    setPlaying: (p: boolean) => (playing = p),
    cur: () => cur,
    undo,
    redo,
    writeTo,
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="anim" onkeydown={key} tabindex="-1">
  <div class="bar" use:fitBar>
    <button class="icon-btn" title="Previous frame (←)" onclick={() => ((playing = false), (cur = (cur + frames.length - 1) % frames.length))}><Icon icon={StepBack} /></button>
    <button class="icon-btn" title="{playing ? 'Pause' : 'Play'} (Space)" onclick={() => (playing = !playing)}><Icon icon={playing ? Pause : Play} /></button>
    <button class="icon-btn" title="Next frame (→)" onclick={() => ((playing = false), (cur = (cur + 1) % frames.length))}><Icon icon={StepForward} /></button>
    <span class="label">Frame {cur + 1} of {frames.length} · {(total / 1000).toFixed(2)} s</span>
    <select class="input sm" bind:value={speed} title="Preview speed (doesn't change the file)">
      {#each [0.25, 0.5, 1, 2, 4] as s (s)}<option value={s}>{s}×</option>{/each}
    </select>
    <span class="sep"></span>
    <button class="icon-btn" title="Undo ({formatShortcut('Mod+Z')})" disabled={!past.length} onclick={undo}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title="Redo ({formatShortcut('Mod+Shift+Z')})" disabled={!future.length} onclick={redo}><Icon icon={Redo2} /></button>
    <button class="icon-btn" title="Delete selected frames (Del)" onclick={remove}><Icon icon={Trash} /></button>
    <button class="icon-btn" title="Duplicate selected frames" onclick={duplicate}><Icon icon={Copy} /></button>
    <button class="btn ghost" title="Move selected frames earlier" onclick={() => move(-1)}><Icon icon={ArrowLeft} size={14} /> Move</button>
    <button class="btn ghost" title="Move selected frames later" onclick={() => move(1)}><Icon icon={ArrowRight} size={14} /> Move</button>
    <button class="btn ghost" title="Reverse the selected frames (or all)" onclick={reverse}><Icon icon={Repeat2} size={14} /> Reverse</button>
    <button class="btn ghost" title="How long the selected frames show" onclick={setDelay}><Icon icon={Timer} size={14} /> Timing…</button>
    <button class="btn ghost" title="Make the whole animation faster or slower" onclick={(e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      import('../../core/ui.svelte').then(({ menu }) => menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
        { label: 'Faster (2×)', run: () => retime(2) },
        { label: 'A bit faster (1.25×)', run: () => retime(1.25) },
        { label: 'A bit slower (0.8×)', run: () => retime(0.8) },
        { label: 'Slower (0.5×)', run: () => retime(0.5) },
        { separator: true },
        { label: 'Drop every other frame (smaller file)', run: dropEveryOther },
      ]));
    }}><Icon icon={Gauge} size={14} /> Speed…</button>
    <label class="opt" title="How many times the animation plays">Loop
      <select class="input sm" value={loop} onchange={(e) => commit(frames, +(e.currentTarget as HTMLSelectElement).value)}>
        <option value={0}>Forever</option>
        {#each [1, 2, 3, 5, 10] as n (n)}<option value={n}>{n === 1 ? 'Once' : `${n} times`}</option>{/each}
        {#if loop > 1 && ![2, 3, 5, 10].includes(loop)}<option value={loop}>{loop} times</option>{/if}
      </select>
    </label>
    <span class="spacer"></span>
    <button class="btn ghost" title="Save the shown frame as a PNG" onclick={exportFrame}><Icon icon={ImageDown} size={14} /> Export frame…</button>
  </div>
  <div class="stage">
    <img class="checker" src={fileUrl(frames[cur].path)} alt="Frame {cur + 1}" style:aspect-ratio="{info.width} / {info.height}" />
  </div>
  <div class="strip" bind:this={strip} role="listbox" aria-label="Frames" aria-multiselectable="true">
    {#each frames as f, i (i)}
      <button class="fr" class:cur={i === cur} class:sel={sel.has(i)} data-i={i} role="option" aria-selected={sel.has(i)} onclick={(e) => click(i, e)} ondblclick={setDelay}>
        <img src={fileUrl(f.path)} alt="" loading="lazy" />
        <span class="n">{i + 1}</span>
        <span class="d">{f.delay} ms</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .anim {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border-soft);
  }
  .label {
    color: var(--text-muted);
    font-size: var(--fs-small);
    margin: 0 6px;
    font-variant-numeric: tabular-nums;
  }
  .sm {
    height: 26px;
    width: auto;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 6px;
  }
  .spacer {
    flex: 1;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--pasteboard);
    padding: 16px;
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    image-rendering: auto;
    box-shadow: 0 0 0 1px var(--canvas-edge);
  }
  .checker {
    background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 16px 16px;
  }
  .strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 8px 10px;
    border-top: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
    flex: none;
  }
  .fr {
    position: relative;
    flex: none;
    width: 88px;
    height: 76px;
    border: 2px solid transparent;
    border-radius: var(--radius);
    background: var(--bg);
    padding: 2px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .fr img {
    width: 80px;
    height: 52px;
    object-fit: contain;
    background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 8px 8px;
  }
  .fr.sel {
    border-color: var(--accent-soft);
    background: var(--accent-soft);
  }
  .fr.cur {
    border-color: var(--accent);
  }
  .n {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 10px;
    color: var(--text-muted);
  }
  .d {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
