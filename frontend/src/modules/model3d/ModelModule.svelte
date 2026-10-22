<script lang="ts">
  import Camera from '@lucide/svelte/icons/camera';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Box from '@lucide/svelte/icons/box';
  import { fitBar } from '../../core/fit';
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Square from '@lucide/svelte/icons/square';
  import Film from '@lucide/svelte/icons/film';
  import type { Tab } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { ui, toastError } from '../../core/ui.svelte';
  import { t, tn } from '../../core/i18n';
  import { ModelViewer, type AnimState, type ModelStats } from './viewer';
  import { MAIN_THREAD_EXTS } from './load';
  import { modelViews } from './views';
  import type { LoadOut } from './loadWorker';

  let { tab }: { tab: Tab } = $props();

  let host = $state<HTMLDivElement>();
  let viewer = $state.raw<ModelViewer | null>(null);
  let loading = $state(true);
  let progress = $state(0);
  let error = $state('');
  let stats = $state<ModelStats | null>(null);
  let anims = $state<{ name: string; duration: number }[]>([]);
  let anim = $state<AnimState>({ index: -1, playing: false, time: 0, duration: 0, speed: 1 });
  let wireframe = $state(false);
  let lighting = $state(true);
  let grid = $state(true);
  let bg = $state<'dark' | 'light'>('dark');
  let loadInfo = $state({ millis: 0, worker: true });
  const ext = $derived(extname(tab.name));

  async function folderBase(): Promise<string> {
    if (!tab.filePath) return `${location.origin}/__mf/page/none/`;
    try {
      return `${location.origin}/__mf/page/${await api.PageRoot(dirname(tab.filePath))}/`;
    } catch {
      return `${location.origin}/__mf/page/none/`;
    }
  }

  async function load() {
    loading = true;
    error = '';
    progress = 0;
    const t0 = performance.now();
    try {
      const base = await folderBase();
      let scene, animations;
      if (MAIN_THREAD_EXTS.includes(ext)) {
        // These loaders need DOMParser, which workers lack.
        const [{ loadModel }, { fetchBytes }] = await Promise.all([import('./load'), import('../../core/fetchbytes')]);
        const bytes = await fetchBytes(tab.url(), (d, t) => (progress = d / t));
        ({ scene, animations } = await loadModel(ext, bytes.buffer as ArrayBuffer, base, tab.title));
        loadInfo = { millis: 0, worker: false };
      } else {
        const { default: LoadWorker } = await import('./loadWorker?worker');
        const w = new LoadWorker();
        const out = await new Promise<Extract<LoadOut, { ok: true }>>((resolve, reject) => {
          w.onmessage = (e: MessageEvent<LoadOut>) => {
            const m = e.data;
            if ('progress' in m) progress = m.progress;
            else if (m.ok) resolve(m);
            else reject(new Error(m.error));
          };
          w.onerror = (e) => reject(new Error(e.message || t('could not read the model')));
          w.postMessage({ url: new URL(tab.url(), location.href).href, ext, base, name: tab.title });
        }).finally(() => w.terminate());
        const { unpack } = await import('./transfer');
        ({ scene, animations } = await unpack(out.packed));
        loadInfo = { millis: out.millis, worker: true };
      }
      await viewer!.setModel(scene, animations);
      stats = viewer!.stats();
      anims = viewer!.animations;
      updateStatus(Math.round(performance.now() - t0));
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function updateStatus(ms?: number) {
    const s = stats;
    tab.status = {
      ...tab.status,
      type: t('{format} model', { format: ext.toUpperCase() }),
      position: s ? (s.points && !s.meshes ? tn('{n} points', '{n} points', s.points) : tn('{n} triangles', '{n} triangles', s.triangles)) : undefined,
      info: ms !== undefined ? t('loaded in {ms} ms', { ms }) : tab.status.info,
    };
  }

  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  function toggle(which: 'wireframe' | 'lighting' | 'grid') {
    if (!viewer) return;
    if (which === 'wireframe') viewer.setWireframe((wireframe = !wireframe));
    else if (which === 'lighting') viewer.setLighting((lighting = !lighting));
    else viewer.setGrid((grid = !grid));
  }

  async function screenshot() {
    if (!viewer) return;
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`);
    let path = await api.SaveFileDialog(t('Save view as PNG'), base, [{ name: 'PNG', patterns: '*.png' }]);
    if (!path) return;
    if (extname(path) !== 'png') path += '.png';
    try {
      await saveFile(path, await viewer.screenshot());
      ui.toast(t('View saved'), 'success');
    } catch (e) {
      toastError(e);
    }
  }

  modelViews.set(tab.id, {
    reset: () => viewer?.frame(),
    toggle,
    play: (i: number) => viewer?.play(i),
    pause: () => viewer?.togglePause(),
  });

  onMount(() => {
    try {
      viewer = new ModelViewer(host!);
    } catch (e) {
      error = t('3D needs WebGL, which is not available here ({error}).', { error: (e as Error).message });
      loading = false;
      return;
    }
    viewer.onAnim = (a) => (anim = a);
    tab.handlers = { ...tab.handlers, reload: load, onShow: () => (viewer?.attach(), updateStatus()), getState: () => undefined };
    void load();
    return () => {
      modelViews.delete(tab.id);
      viewer?.destroy();
    };
  });

  (tab as unknown as { modelTest: unknown }).modelTest = { viewer: () => viewer, stats: () => stats, anims: () => anims, anim: () => anim, loading: () => loading, error: () => error, loadInfo: () => loadInfo, toggle };
</script>

<div class="toolbar" use:fitBar>
  <button class="btn ghost" class:on={wireframe} title="{t('Wireframe')} (W)" onclick={() => toggle('wireframe')}><Icon icon={Box} size={14} /> {t('Wireframe')}</button>
  <button class="btn ghost" class:on={lighting} title={t('Lighting on/off (L) — off shows flat, unlit colours')} onclick={() => toggle('lighting')}><Icon icon={Lightbulb} size={14} /> {t('Lighting')}</button>
  <button class="btn ghost" class:on={grid} title="{t('Floor grid')} (G)" onclick={() => toggle('grid')}><Icon icon={Grid3x3} size={14} /> {t('Grid')}</button>
  <span class="sep"></span>
  <div class="seg" role="group" aria-label={t('Background')}>
    <button class="btn ghost" class:on={bg === 'dark'} title={t('Dark background')} onclick={() => viewer?.setBackground((bg = 'dark'))}><Icon icon={Moon} size={14} /></button>
    <button class="btn ghost" class:on={bg === 'light'} title={t('Light background')} onclick={() => viewer?.setBackground((bg = 'light'))}><Icon icon={Sun} size={14} /></button>
  </div>
  <span class="spacer"></span>
  {#if stats}
    <span class="label">{stats.meshes ? `${tn('{n} mesh', '{n} meshes', stats.meshes)} · ${tn('{n} vertices', '{n} vertices', stats.vertices)}` : ''}{stats.points ? ` · ${tn('{n} points', '{n} points', stats.points)}` : ''}{stats.materials ? ` · ${tn('{n} material', '{n} materials', stats.materials)}` : ''}{stats.bones ? ` · ${tn('{n} bones', '{n} bones', stats.bones)}` : ''}</span>
    <span class="sep"></span>
  {/if}
  <button class="btn ghost" title="{t('Reset view')} (0)" onclick={() => viewer?.frame()}><Icon icon={RotateCcw} size={14} /> {t('Reset view')}</button>
  <button class="btn ghost" title={t('Save the current view as PNG')} onclick={screenshot}><Icon icon={Camera} size={14} /> {t('Screenshot…')}</button>
</div>

<div class="body">
  <div class="stage" bind:this={host}>
    {#if loading}
      <div class="empty-state overlay">
        <span class="spinner"></span>
        {#if progress > 0 && progress < 1}<span class="muted">{Math.round(progress * 100)}%</span>{/if}
      </div>
    {/if}
    {#if error}<div class="empty-state overlay err">{error}</div>{/if}
  </div>
  {#if anims.length}
    <aside data-sidepanel class="anims" aria-label={t('Animations')}>
      <h4><Icon icon={Film} size={14} /> {t('Animations ({n})', { n: anims.length })}</h4>
      <div class="list" role="listbox">
        {#each anims as a, i (i)}
          <button class="clip" class:on={anim.index === i} role="option" aria-selected={anim.index === i} onclick={() => viewer?.play(i)} title={t('Play {name}', { name: a.name })}>
            <span class="ico"><Icon icon={anim.index === i && anim.playing ? Pause : Play} size={13} /></span>
            <span class="nm">{a.name}</span>
            <span class="dur">{a.duration.toFixed(1)} s</span>
          </button>
        {/each}
      </div>
      {#if anim.index >= 0}
        <div class="transport">
          <input type="range" min="0" max={anim.duration} step="0.01" value={anim.time} oninput={(e) => viewer?.seek(+(e.target as HTMLInputElement).value)} aria-label={t('Animation time')} />
          <div class="row">
            <button class="icon-btn" title={anim.playing ? t('Pause') : t('Play')} onclick={() => viewer?.togglePause()}><Icon icon={anim.playing ? Pause : Play} size={14} /></button>
            <button class="icon-btn" title={t('Stop')} onclick={() => viewer?.stopAnimation()}><Icon icon={Square} size={14} /></button>
            <span class="t">{fmtTime(anim.time)} / {fmtTime(anim.duration)}</span>
            <select value={String(anim.speed)} onchange={(e) => viewer?.setSpeed(+(e.target as HTMLSelectElement).value)} title={t('Speed')}>
              {#each [0.25, 0.5, 1, 1.5, 2] as s (s)}<option value={String(s)}>{s}×</option>{/each}
            </select>
          </div>
        </div>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .stage {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .stage :global(canvas) {
    display: block;
  }
  .overlay {
    position: absolute;
    inset: 0;
    gap: 8px;
  }
  .err {
    color: var(--danger);
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .anims {
    width: 240px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border-soft);
    min-height: 0;
  }
  h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 10px 12px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 6px;
  }
  .clip {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .clip:hover {
    background: var(--bg-hover);
  }
  .clip.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ico {
    display: inline-flex;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dur {
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .transport {
    padding: 8px 10px;
    border-top: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .transport input {
    width: 100%;
    accent-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .t {
    flex: 1;
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
