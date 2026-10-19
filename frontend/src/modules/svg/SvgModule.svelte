<script lang="ts">
  // SVG: edit the source with a live preview. The preview renders the SVG
  // through an <img> from a blob URL, so scripts and external references in
  // the file never run. Export to PNG at any scale.
  import { onMount } from 'svelte';
  import { xml } from '@codemirror/lang-xml';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { dirname, join, stem, extname } from '../../core/paths';
  import { ui, toastError } from '../../core/ui.svelte';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { centered, clampZoom, fitZoom, stepZoom, zoomAt, type View } from '../image/geometry';
  import { svgViews, type ViewMode } from './views';

  let { tab }: { tab: Tab } = $props();

  const restored = (tab.restoredState as { view?: ViewMode } | undefined)?.view;
  let view = $state<ViewMode>(restored ?? 'split');
  let src = $state('');
  let error = $state('');
  let natural = $state({ w: 0, h: 0 });
  let pv = $state<View>({ zoom: 1, x: 0, y: 0 });
  let fitted = true;
  let bg = $state<'checker' | 'light' | 'dark'>('checker');
  let area = $state<HTMLDivElement>();
  let ctl: TextController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;

  svgViews.set(tab.id, {
    get: () => view,
    set: (v) => {
      view = v;
      workspace.touch();
      queueMicrotask(() => {
        ctl?.view.requestMeasure();
        if (fitted) fit();
      });
    },
    exportPng: () => void exportPng(),
    fit: () => fit(),
  });

  const options = {
    language: xml(),
    onDocChanged: () => schedule(),
    onLoaded: () => render(),
    wrap: true,
  };

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  }

  /** Size from width/height attributes or the viewBox. */
  function measure(doc: Document): { w: number; h: number } {
    const svg = doc.documentElement;
    const num = (v: string | null) => {
      const m = v ? /^\s*([\d.]+)\s*(px)?\s*$/.exec(v) : null;
      return m ? Number(m[1]) : 0;
    };
    const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    let w = num(svg.getAttribute('width'));
    let h = num(svg.getAttribute('height'));
    if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (w && !h) h = (w * vb[3]) / vb[2];
      else if (h && !w) w = (h * vb[2]) / vb[3];
      else {
        w = vb[2];
        h = vb[3];
      }
    }
    return { w: w || 300, h: h || 150 };
  }

  function render() {
    if (!ctl) return;
    const text = ctl.view.state.doc.toString();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err || doc.documentElement.localName !== 'svg') {
      const msg = err?.textContent?.replace(/\s+/g, ' ').trim() ?? 'The root element must be <svg>.';
      error = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
      return; // keep showing the last good render
    }
    error = '';
    const size = measure(doc);
    const first = !src;
    natural = size;
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    if (src) URL.revokeObjectURL(src);
    src = url;
    const count = doc.getElementsByTagName('*').length;
    tab.status = { ...tab.status, type: 'SVG image', position: `${Math.round(size.w)} × ${Math.round(size.h)}`, info: `${count} elements` };
    if (first || fitted) queueMicrotask(fit);
  }

  function fit() {
    if (!area || !natural.w) return;
    const z = fitZoom(natural.w, natural.h, area.clientWidth, area.clientHeight, 24, true);
    pv = centered(natural.w, natural.h, area.clientWidth, area.clientHeight, z);
    fitted = true;
  }

  function zoom(dir: 1 | -1) {
    if (!area) return;
    pv = zoomAt(pv, area.clientWidth / 2, area.clientHeight / 2, stepZoom(pv.zoom, dir));
    fitted = false;
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = area!.getBoundingClientRect();
    pv = zoomAt(pv, e.clientX - r.left, e.clientY - r.top, clampZoom(pv.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
    fitted = false;
  }

  /** Rasterise the current SVG at a scale and save it as PNG. */
  async function exportPng() {
    if (!src || error) {
      ui.toast('Fix the SVG errors first.', 'warning');
      return;
    }
    const choice = await ui.pick('Export PNG', [
      { id: '1', label: `1× — ${Math.round(natural.w)} × ${Math.round(natural.h)}` },
      { id: '2', label: `2× — ${Math.round(natural.w * 2)} × ${Math.round(natural.h * 2)}` },
      { id: '4', label: `4× — ${Math.round(natural.w * 4)} × ${Math.round(natural.h * 4)}` },
      { id: 'w', label: 'Custom width…' },
    ]);
    if (!choice) return;
    let scale = Number(choice);
    if (choice === 'w') {
      const v = await ui.prompt('Width in pixels', String(Math.round(natural.w * 2)), 'Export');
      if (!v || !(+v > 0)) return;
      scale = +v / natural.w;
    }
    const w = Math.max(1, Math.round(natural.w * scale));
    const h = Math.max(1, Math.round(natural.h * scale));
    if (w * h > 16384 * 16384 || w > 16384 || h > 16384) {
      ui.toast('That is too large (16384 px per side at most).', 'warning');
      return;
    }
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`);
    let path = await api.SaveFileDialog('Export PNG', base, [{ name: 'PNG', patterns: '*.png' }]);
    if (!path) return;
    if (extname(path) !== 'png') path += '.png';
    if (await exportTo(path, w, h)) {
      const p = path;
      ui.toast(`Exported ${w} × ${h} PNG`, 'success', { label: 'Open', run: () => void workspace.openPath(p) });
    }
  }

  async function exportTo(path: string, w: number, h: number): Promise<boolean> {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed'))), 'image/png'));
      await saveFile(path, blob);
      return true;
    } catch (e) {
      toastError(e, 'Export failed');
      return false;
    }
  }

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view });
  }

  onMount(() => {
    const ro = new ResizeObserver(() => fitted && fit());
    if (area) ro.observe(area);
    return () => {
      ro.disconnect();
      svgViews.delete(tab.id);
      clearTimeout(timer);
      if (src) URL.revokeObjectURL(src);
    };
  });

  (tab as unknown as { svgTest: unknown }).svgTest = {
    error: () => error,
    natural: () => natural,
    src: () => src,
    exportTo,
    setText: (t: string) => ctl?.view.dispatch({ changes: { from: 0, to: ctl.view.state.doc.length, insert: t } }),
  };
</script>

<div class="toolbar">
  <div class="seg" role="group" aria-label="View">
    <button class="btn ghost" class:on={view === 'source'} onclick={() => svgViews.get(tab.id)?.set('source')}>Source</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => svgViews.get(tab.id)?.set('split')}>Split</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => svgViews.get(tab.id)?.set('preview')}>Preview</button>
  </div>
  <span class="spacer"></span>
  {#if view !== 'source'}
    <div class="seg" role="group" aria-label="Background">
      <button class="btn ghost" class:on={bg === 'checker'} title="Transparent" onclick={() => (bg = 'checker')}>▦</button>
      <button class="btn ghost" class:on={bg === 'light'} title="Light background" onclick={() => (bg = 'light')}>☀</button>
      <button class="btn ghost" class:on={bg === 'dark'} title="Dark background" onclick={() => (bg = 'dark')}>☾</button>
    </div>
    <span class="sep"></span>
    <button class="btn ghost" title="Zoom out" onclick={() => zoom(-1)}>−</button>
    <button class="btn ghost zoomlabel" title="Fit" onclick={fit}>{Math.round(pv.zoom * 100)}%</button>
    <button class="btn ghost" title="Zoom in" onclick={() => zoom(1)}>+</button>
    <span class="sep"></span>
  {/if}
  <button class="btn ghost" onclick={exportPng}>Export PNG…</button>
  {#if tab.filePath}<button class="btn ghost" title="Open in your web browser" onclick={() => api.OpenInBrowser(tab.filePath!).catch((e) => toastError(e))}>Open in browser</button>{/if}
</div>
{#if error}<div class="banner err">SVG error: {error}</div>{/if}
<div class="panes" data-view={view}>
  <div class="src"><TextEditor {tab} {options} onready={ready} /></div>
  {#if view !== 'source'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="preview {bg}"
      bind:this={area}
      onwheel={wheel}
      ondblclick={fit}
      onpointerdown={(e) => {
        drag = { x: e.clientX, y: e.clientY, vx: pv.x, vy: pv.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onpointermove={(e) => {
        if (!drag) return;
        pv = { ...pv, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
        fitted = false;
      }}
      onpointerup={() => (drag = null)}
    >
      {#if src}
        <img {src} alt={tab.title} draggable="false" style:width="{natural.w}px" style:height="{natural.h}px" style:transform="translate({pv.x}px, {pv.y}px) scale({pv.zoom})" />
      {/if}
    </div>
  {/if}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg .btn {
    height: 26px;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .src {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .preview {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    border-left: 1px solid var(--border-soft);
    cursor: grab;
    touch-action: none;
  }
  .preview.checker {
    background-color: var(--checker-b);
    background-image: linear-gradient(45deg, var(--checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  }
  .preview.light {
    background: #ffffff;
  }
  .preview.dark {
    background: #1b1b1b;
  }
  .preview img {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    max-width: none;
    user-select: none;
  }
  .panes[data-view='preview'] .src {
    display: none;
  }
  .panes[data-view='preview'] .preview {
    border-left: none;
  }
  .zoomlabel {
    min-width: 58px;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
  .err {
    color: var(--danger);
  }
</style>
