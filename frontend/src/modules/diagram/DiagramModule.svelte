<script lang="ts">
  // Graphviz (.dot/.gv) and Mermaid (.mmd) diagrams: the source in the
  // editor, the drawing beside it (zoom with the wheel, drag to pan, click a
  // node or edge to jump to its line). Errors point at their line and keep
  // the last good drawing. Export as SVG or PNG.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Maximize from '@lucide/svelte/icons/maximize';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { toastError, ui } from '../../core/ui.svelte';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { diagramViews, type ViewMode } from './views';
  import { kindOfPath, renderDiagram, type DiagramResult } from './render';
  import { dotLanguage, mermaidLanguage } from './syntax';

  let { tab }: { tab: Tab } = $props();

  const kind = kindOfPath(tab.path ?? tab.title);
  const restored = (tab.restoredState as { view?: ViewMode } | undefined)?.view;
  let view = $state<ViewMode>(restored ?? 'split');
  let svg = $state('');
  let size = $state({ w: 0, h: 0 });
  let error = $state('');
  let errorLine = $state(0);
  let busy = $state(false);
  let stats = $state('');
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let fitted = $state(true);
  let stage = $state<HTMLDivElement>();
  let ctl: TextController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  diagramViews.set(tab.id, {
    get: () => view,
    set: (v) => {
      view = v;
      workspace.touch();
      queueMicrotask(() => {
        ctl?.view.requestMeasure();
        if (fitted) fit();
      });
    },
  });

  const options = {
    minimap: false,
    language: kind === 'dot' ? dotLanguage : mermaidLanguage,
    onDocChanged: () => schedule(),
    onLoaded: () => void draw(),
    wrap: false,
  };

  function schedule() {
    clearTimeout(timer);
    // Mermaid draws on the main thread (~100 ms on slow machines): wait for a pause in typing.
    const wait = kind === 'mermaid' ? 400 : (ctl?.view.state.doc.length ?? 0) > 50_000 ? 500 : 200;
    timer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(() => void draw(), { timeout: 500 }) : void draw()), wait);
  }

  async function draw() {
    if (!ctl || view === 'source') return;
    const id = ++seq;
    const src = ctl.view.state.doc.toString();
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => (busy = true), 300);
    let r: DiagramResult;
    try {
      r = await renderDiagram(kind, src);
    } finally {
      clearTimeout(busyTimer);
      if (id === seq) busy = false;
    }
    if (id !== seq) return;
    if (r.svg) {
      const first = !svg;
      svg = r.svg;
      size = { w: r.width ?? 0, h: r.height ?? 0 };
      error = '';
      errorLine = 0;
      const nodes = (r as { nodes?: number }).nodes;
      const edges = (r as { edges?: number }).edges;
      stats = nodes !== undefined ? `${nodes} nodes · ${edges} edges` : '';
      tab.status = { ...tab.status, type: kind === 'dot' ? 'Graphviz diagram' : 'Mermaid diagram', info: stats };
      if (first || fitted) queueMicrotask(fit);
    } else {
      error = r.error ?? 'Could not draw this diagram.';
      errorLine = r.line ?? 0;
      tab.status = { ...tab.status, type: kind === 'dot' ? 'Graphviz diagram' : 'Mermaid diagram', info: 'Error' };
    }
  }

  $effect(() => {
    if (view !== 'source') void draw();
  });

  function fit() {
    if (!stage || !size.w || !size.h) return;
    const r = stage.getBoundingClientRect();
    zoom = Math.min(2, Math.max(0.05, Math.min((r.width - 32) / size.w, (r.height - 32) / size.h)));
    pan = { x: (r.width - size.w * zoom) / 2, y: (r.height - size.h * zoom) / 2 };
    fitted = true;
  }

  function zoomBy(f: number, cx?: number, cy?: number) {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const nz = Math.min(8, Math.max(0.05, zoom * f));
    pan = { x: px - ((px - pan.x) * nz) / zoom, y: py - ((py - pan.y) * nz) / zoom };
    zoom = nz;
    fitted = false;
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = stage!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || !e.shiftKey) zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    else pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
  }

  let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) {
      pan = { x: drag.px + dx, y: drag.py + dy };
      fitted = false;
    }
  }
  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d || d.moved) return;
    // A click: jump to the clicked element's source line.
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-line]') as HTMLElement | null;
    const line = Number(hit?.dataset.line ?? hit?.getAttribute('data-line'));
    if (line) goLine(line);
  }

  function goLine(line: number) {
    if (!ctl) return;
    const doc = ctl.view.state.doc;
    const l = doc.line(Math.min(Math.max(1, line), doc.lines));
    ctl.view.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
    if (view === 'preview') diagramViews.get(tab.id)?.set('split');
    ctl.view.focus();
  }

  function svgText(): string {
    return svg.startsWith('<svg') && !svg.includes('xmlns="http://www.w3.org/2000/svg"') ? svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') : svg;
  }

  async function exportSvg() {
    if (!svg) return;
    let path = await api.SaveFileDialog('Export SVG', join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.svg`), [{ name: 'SVG', patterns: '*.svg' }]);
    if (!path) return;
    if (extname(path) !== 'svg') path += '.svg';
    try {
      await saveFile(path, svgText());
      const p = path;
      ui.toast('Exported SVG', 'success', { label: 'Open', run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e, 'Export failed');
    }
  }

  async function exportPng() {
    if (!svg || !size.w) return;
    let path = await api.SaveFileDialog('Export PNG', join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`), [{ name: 'PNG', patterns: '*.png' }]);
    if (!path) return;
    if (extname(path) !== 'png') path += '.png';
    await pngTo(path, 2);
  }

  async function pngTo(path: string, scale: number): Promise<boolean> {
    try {
      const w = Math.max(1, Math.round(size.w * scale));
      const h = Math.max(1, Math.round(size.h * scale));
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml' }));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encoding failed'))), 'image/png'));
      await saveFile(path, blob);
      const p = path;
      ui.toast(`Exported ${w} × ${h} PNG`, 'success', { label: 'Open', run: () => void workspace.openPath(p) });
      return true;
    } catch (e) {
      toastError(e, 'Export failed');
      return false;
    }
  }

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view });
    const prevShow = tab.handlers.onShow;
    tab.handlers.onShow = () => {
      prevShow?.();
      void draw();
    };
  }

  (tab as unknown as { diagramTest: unknown }).diagramTest = {
    svg: () => svg,
    error: () => ({ error, line: errorLine }),
    stage: () => stage,
    zoom: () => zoom,
    zoomBy,
    fit,
    goLine,
    pngTo,
    setText: (s: string) => ctl?.view.dispatch({ changes: { from: 0, to: ctl.view.state.doc.length, insert: s } }),
    cursorLine: () => (ctl ? ctl.view.state.doc.lineAt(ctl.view.state.selection.main.head).number : 0),
  };

  onMount(() => {
    const ro = new ResizeObserver(() => fitted && fit());
    if (stage) ro.observe(stage);
    return () => {
      ro.disconnect();
      diagramViews.delete(tab.id);
      clearTimeout(timer);
      clearTimeout(busyTimer);
    };
  });
</script>

<div class="toolbar">
  <div class="seg" role="group" aria-label="View">
    <button class="btn ghost" class:on={view === 'source'} onclick={() => diagramViews.get(tab.id)?.set('source')}>Source</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => diagramViews.get(tab.id)?.set('split')}>Split</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => diagramViews.get(tab.id)?.set('preview')}>Preview</button>
  </div>
  <span class="sep"></span>
  <button class="icon-btn" title="Zoom out" onclick={() => zoomBy(1 / 1.25)} disabled={view === 'source'}><Icon icon={ZoomOut} /></button>
  <span class="label zoom">{Math.round(zoom * 100)}%</span>
  <button class="icon-btn" title="Zoom in" onclick={() => zoomBy(1.25)} disabled={view === 'source'}><Icon icon={ZoomIn} /></button>
  <button class="icon-btn" title="Fit" onclick={fit} disabled={view === 'source'}><Icon icon={Maximize} /></button>
  <span class="spacer"></span>
  {#if stats}<span class="label">{stats}</span>{/if}
  <button class="btn ghost" onclick={exportSvg} disabled={!svg}>Export SVG…</button>
  <button class="btn ghost" onclick={exportPng} disabled={!svg}>Export PNG…</button>
</div>
<div class="panes" data-view={view}>
  <div class="src"><TextEditor {tab} {options} onready={ready} /></div>
  {#if view !== 'source'}
    <div class="preview">
      {#if error}
        <button class="err" onclick={() => errorLine && goLine(errorLine)} title={errorLine ? 'Go to the line' : ''}>
          <Icon icon={AlertTriangle} size={14} /><span>{error}</span>
        </button>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="stage" bind:this={stage} onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up} class:stale={!!error}>
        {#if svg}
          <div class="paper" style="transform: translate({pan.x}px, {pan.y}px) scale({zoom}); width: {size.w}px; height: {size.h}px">
            {@html svg}
          </div>
        {:else if !error}
          <div class="empty-state"><span class="spinner"></span></div>
        {/if}
        {#if busy}<div class="busy"><span class="spinner"></span> Laying out…</div>{/if}
      </div>
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
  .zoom {
    min-width: 42px;
    text-align: center;
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
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border-soft);
  }
  .panes[data-view='preview'] .src {
    display: none;
  }
  .panes[data-view='preview'] .preview {
    border-left: none;
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: var(--bg-sidebar);
    cursor: grab;
    touch-action: none;
  }
  .stage.stale .paper {
    opacity: 0.45;
  }
  .paper {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
  }
  .paper :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none !important;
  }
  .paper :global([data-line]) {
    cursor: pointer;
  }
  .err {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    text-align: left;
    padding: 6px 10px;
    border: none;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font: inherit;
    font-size: var(--fs-small);
    white-space: pre-wrap;
    cursor: pointer;
  }
  .busy {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--bg);
    font-size: var(--fs-small);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }
</style>
