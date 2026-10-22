<script lang="ts">
  import PaneDivider, { savedRatio } from '../../shell/PaneDivider.svelte';
  import ImageDown from '@lucide/svelte/icons/image-down';
  import FileDown from '@lucide/svelte/icons/file-down';
  import Eye from '@lucide/svelte/icons/eye';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import Code from '@lucide/svelte/icons/code';
  import { fitBar } from '../../core/fit';
  // Graphviz (.dot/.gv) and Mermaid (.mmd) diagrams: the source in the
  // editor, the drawing beside it (zoom with the wheel, drag to pan, click a
  // node or edge to jump to its line). Errors point at their line and keep
  // the last good drawing. Export as SVG or PNG.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import { theme } from '../../core/theme.svelte';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { toastError, ui } from '../../core/ui.svelte';
  import { t, tn } from '../../core/i18n';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { diagramViews, type ViewMode } from './views';
  import { kindOfPath, renderDiagram, type DiagramResult } from './render';
  import { dotLanguage, mermaidLanguage } from './syntax';

  let { tab }: { tab: Tab } = $props();

  const kind = kindOfPath(tab.path ?? tab.title);
  const restored = (tab.restoredState as { view?: ViewMode } | undefined)?.view;
  let view = $state<ViewMode>(restored ?? 'split');
  let ratio = $state(savedRatio('diagram'));
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
    timer = setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(() => void draw(), { timeout: 500 }) : void draw()), wait);
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
      stats = nodes !== undefined ? `${tn('{n} node', '{n} nodes', nodes)} · ${tn('{n} edge', '{n} edges', edges ?? 0)}` : '';
      tab.status = { ...tab.status, type: kind === 'dot' ? t('Graphviz diagram') : t('Mermaid diagram'), info: stats };
      if (first || fitted) queueMicrotask(fit);
    } else {
      error = r.error ?? t('Could not draw this diagram.');
      errorLine = r.line ?? 0;
      tab.status = { ...tab.status, type: kind === 'dot' ? t('Graphviz diagram') : t('Mermaid diagram'), info: t('Error') };
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
    let path = await api.SaveFileDialog(t('Export SVG'), join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.svg`), [{ name: 'SVG', patterns: '*.svg' }]);
    if (!path) return;
    if (extname(path) !== 'svg') path += '.svg';
    try {
      await saveFile(path, svgText());
      const p = path;
      ui.toast(t('Exported SVG'), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e, t('Export failed'));
    }
  }

  async function exportPng() {
    if (!svg || !size.w) return;
    let path = await api.SaveFileDialog(t('Export PNG'), join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`), [{ name: 'PNG', patterns: '*.png' }]);
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
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('encoding failed')))), 'image/png'));
      await saveFile(path, blob);
      const p = path;
      ui.toast(t('Exported {w} × {h} PNG', { w: String(w), h: String(h) }), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
      return true;
    } catch (e) {
      toastError(e, t('Export failed'));
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

<div class="toolbar" use:fitBar>
  <div class="seg" role="group" aria-label={t('View')}>
    <button class="btn ghost" class:on={view === 'source'} onclick={() => diagramViews.get(tab.id)?.set('source')}><Icon icon={Code} size={14} /> {t('Source')}</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => diagramViews.get(tab.id)?.set('split')}><Icon icon={Columns2} size={14} /> {t('Split', {}, 'view')}</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => diagramViews.get(tab.id)?.set('preview')}><Icon icon={Eye} size={14} /> {t('Preview')}</button>
  </div>
  <span class="sep"></span>
  <button class="icon-btn" title={t('Zoom out')} onclick={() => zoomBy(1 / 1.25)} disabled={view === 'source'}><Icon icon={ZoomOut} /></button>
  <span class="label zoom">{Math.round(zoom * 100)}%</span>
  <button class="icon-btn" title={t('Zoom in')} onclick={() => zoomBy(1.25)} disabled={view === 'source'}><Icon icon={ZoomIn} /></button>
  <button class="icon-btn" title={t('Fit')} onclick={fit} disabled={view === 'source'}><Icon icon={Maximize} /></button>
  {#if theme.resolved === 'dark'}
    <button class="icon-btn" class:on={theme.darkCanvas} title={theme.darkCanvas ? t('Show the diagram on white') : t('Darken the diagram to match the theme')} aria-pressed={theme.darkCanvas} onclick={() => theme.setDarkCanvas(!theme.darkCanvas)} disabled={view === 'source'}><Icon icon={theme.darkCanvas ? Moon : Sun} /></button>
  {/if}
  <span class="spacer"></span>
  {#if stats}<span class="label">{stats}</span>{/if}
  <button class="btn ghost" onclick={exportSvg} disabled={!svg}><Icon icon={FileDown} size={14} /> {t('Export SVG…')}</button>
  <button class="btn ghost" onclick={exportPng} disabled={!svg}><Icon icon={ImageDown} size={14} /> {t('Export PNG…')}</button>
</div>
<div class="panes" data-view={view}>
  <div class="src" style:flex={view === 'split' ? `0 0 ${ratio * 100}%` : null}><TextEditor {tab} {options} onready={ready} /></div>
  {#if view === 'split'}<PaneDivider bind:ratio key="diagram" />{/if}
  {#if view !== 'source'}
    <div class="preview">
      {#if error}
        <button class="err" onclick={() => errorLine && goLine(errorLine)} title={errorLine ? t('Go to the line') : ''}>
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
        {#if busy}<div class="busy"><span class="spinner"></span> {t('Laying out…')}</div>{/if}
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
  /* Dark theme: Excalidraw's dark-mode filter (core/canvas.ts DARK_FILTER); exports stay on white. */
  :global(:root[data-canvas='dark']) .paper {
    filter: invert(93%) hue-rotate(180deg);
    box-shadow: none;
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
    border-radius: 6px;
    background: var(--bg);
    font-size: var(--fs-small);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }
</style>
