<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Hand from '@lucide/svelte/icons/hand';
  import Crop from '@lucide/svelte/icons/crop';
  import MoveUpRight from '@lucide/svelte/icons/move-up-right';
  import Square from '@lucide/svelte/icons/square';
  import Type from '@lucide/svelte/icons/type';
  import Droplets from '@lucide/svelte/icons/droplets';
  import Grid from '@lucide/svelte/icons/grid-3x3';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import FlipH from '@lucide/svelte/icons/flip-horizontal-2';
  import FlipV from '@lucide/svelte/icons/flip-vertical-2';
  import Scaling from '@lucide/svelte/icons/scaling';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import Check from '@lucide/svelte/icons/check';
  import XIcon from '@lucide/svelte/icons/x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { api, saveFile } from '../../core/backend';
  import { basename, extname, stem, dirname, join } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { ui, toastError } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';
  import { commands } from '../../core/commands';
  import { ImageEditor, type EditorState, type Tool } from './editor';
  import { centered, fitZoom, keepAspect, stepZoom, zoomAt, clampZoom, type View } from './geometry';
  import { imageControllers } from './editors';
  import * as raster from './raster';

  let { tab }: { tab: Tab } = $props();

  const SAVE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  const COLORS = ['#e5484d', '#f5a524', '#30a46c', '#3e8ed0', '#ffffff', '#1a1a1a'];

  let stageHost = $state<HTMLDivElement>();
  let area = $state<HTMLDivElement>();
  let editor = $state.raw<ImageEditor | null>(null);
  let es = $state<EditorState | null>(null);
  let tool = $state<Tool>('hand');
  let color = $state(COLORS[0]);
  let error = $state('');
  let loading = $state(true);
  // "img mode": SVG (view-only) and GIF (until editing starts) are shown with
  // an <img> so SVGs stay crisp and GIFs keep animating.
  let imgMode = $state(false);
  let imgEl = $state<HTMLImageElement>();
  let imgView = $state<View>({ zoom: 1, x: 0, y: 0 });
  let natural = $state({ w: 0, h: 0 });
  let imgFitted = true;
  let src = $state('');
  let resizeOpen = $state(false);
  let rw = $state(0);
  let rh = $state(0);
  let lockAspect = $state(true);
  let siblings = $state<string[] | null>(null);
  const ext = $derived(extname(tab.name));
  const isSvg = $derived(ext === 'svg');
  const editable = $derived(!imgMode && !!editor && !tab.readOnly);
  const zoom = $derived(imgMode ? imgView.zoom : (es?.zoom ?? 1));
  const position = $derived(siblings && tab.filePath ? `${siblings.indexOf(tab.filePath) + 1} / ${siblings.length}` : '');

  async function decode(url: string): Promise<HTMLCanvasElement> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not read image (${res.status})`);
    const blob = await res.blob();
    try {
      const bmp = await createImageBitmap(blob);
      const c = raster.fromImage(bmp, bmp.width, bmp.height);
      bmp.close();
      return c;
    } catch {
      // Fallback for formats createImageBitmap rejects in some webviews.
      const u = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = u;
        await img.decode();
        return raster.fromImage(img, img.naturalWidth, img.naturalHeight);
      } finally {
        URL.revokeObjectURL(u);
      }
    }
  }

  async function load() {
    loading = true;
    error = '';
    if (tab.filePath)
      api
        .Siblings(tab.filePath, ['image', 'svg'])
        .then((l) => (siblings = l ?? []))
        .catch(() => {});
    try {
      const url = tab.url();
      if (isSvg || ext === 'gif') {
        imgMode = true;
        src = url;
        destroyEditor();
        return;
      }
      imgMode = false;
      const canvas = await decode(url);
      await tick();
      if (editor) editor.load(canvas);
      else createEditor(canvas);
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      loading = false;
    }
  }

  function createEditor(canvas: HTMLCanvasElement) {
    editor = new ImageEditor(stageHost!, canvas);
    editor.askText = (initial) => ui.prompt(initial ? 'Edit text' : 'Add text', initial, initial ? 'Update' : 'Add');
    editor.onChange = (s) => {
      es = s;
      tab.dirty = s.dirty;
      updateStatus();
    };
    editor.color = color;
    editor.setTool(tool);
    es = editor.state();
    updateStatus();
  }

  function destroyEditor() {
    editor?.destroy();
    editor = null;
    es = null;
  }

  function updateStatus() {
    const w = imgMode ? natural.w : (es?.width ?? 0);
    const h = imgMode ? natural.h : (es?.height ?? 0);
    tab.status = {
      ...tab.status,
      type: isSvg ? 'SVG image (view-only)' : `${ext.toUpperCase()} image`,
      position: w ? `${w} × ${h} px` : undefined,
      info: `${Math.round(zoom * 100)}%`,
    };
  }

  // ---- <img> mode zoom/pan ----
  function imgFit() {
    if (!area || !natural.w) return;
    const z = fitZoom(natural.w, natural.h, area.clientWidth, area.clientHeight, 24, isSvg);
    imgView = centered(natural.w, natural.h, area.clientWidth, area.clientHeight, z);
    imgFitted = true;
    updateStatus();
  }
  function imgLoaded() {
    if (!imgEl) return;
    natural = { w: imgEl.naturalWidth || 800, h: imgEl.naturalHeight || 600 };
    imgFit();
  }
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  function imgWheel(e: WheelEvent) {
    e.preventDefault();
    const r = area!.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
    imgView = zoomAt(imgView, e.clientX - r.left, e.clientY - r.top, clampZoom(imgView.zoom * factor));
    imgFitted = false;
    updateStatus();
  }

  // ---- controller ----
  const ctl = {
    fit: () => (imgMode ? imgFit() : editor?.fit()),
    actual: () => {
      if (imgMode && area) {
        imgView = centered(natural.w, natural.h, area.clientWidth, area.clientHeight, 1);
        imgFitted = false;
        updateStatus();
      } else editor?.actualSize();
    },
    zoom: (dir: 1 | -1) => {
      if (imgMode && area) {
        imgView = zoomAt(imgView, area.clientWidth / 2, area.clientHeight / 2, stepZoom(imgView.zoom, dir));
        imgFitted = false;
        updateStatus();
      } else editor?.zoomStep(dir);
    },
    tool: (t: string) => setTool(t as Tool),
    rotate: (cw: boolean) => editor?.rotate(cw),
    flip: (h: boolean) => editor?.flip(h),
    undo: () => editor?.undo(),
    redo: () => editor?.redo(),
    apply: () => editor?.applyRegion(),
    escape: () => {
      if (resizeOpen) resizeOpen = false;
      else if (es?.hasRegion) editor?.cancelRegion();
      else setTool('hand');
    },
    deleteSelection: () => editor?.deleteSelection(),
    navigate: (dir: 1 | -1) => void navigate(dir),
    resize: () => openResize(),
    editable: () => editable,
  };
  imageControllers.set(tab.id, ctl);

  function setTool(t: Tool) {
    if (!editable && t !== 'hand') return;
    tool = t;
    editor?.setTool(t);
  }

  function pickColor(c: string) {
    color = c;
    if (editor) editor.setColor(c);
  }

  async function startEditingGif() {
    imgMode = false;
    loading = true;
    try {
      await tick();
      const c = await decode(tab.url());
      createEditor(c);
      ui.toast('Editing a GIF keeps only its first frame.', 'info');
    } catch (e) {
      toastError(e);
    } finally {
      loading = false;
    }
  }

  function openResize() {
    if (!editor) return;
    rw = editor.width;
    rh = editor.height;
    resizeOpen = true;
  }
  function changeW() {
    if (lockAspect && editor) rh = keepAspect(editor.width, editor.height, 'w', rw).h;
  }
  function changeH() {
    if (lockAspect && editor) rw = keepAspect(editor.width, editor.height, 'h', rh).w;
  }
  function applyResize() {
    if (!editor || rw < 1 || rh < 1 || rw > 20000 || rh > 20000) return;
    editor.resizeTo(Math.round(rw), Math.round(rh));
    resizeOpen = false;
  }

  // ---- folder navigation ----
  async function navigate(dir: 1 | -1) {
    const p = tab.filePath;
    if (!p) return;
    if (tab.dirty && !(await ui.confirm('Discard changes?', `${tab.title} has unsaved edits.`, 'Discard', true))) return;
    try {
      siblings = (await api.Siblings(p, ['image', 'svg'])) ?? [];
    } catch (e) {
      toastError(e);
      return;
    }
    if (siblings.length < 2) return;
    const i = siblings.indexOf(p);
    const next = siblings[(i + dir + siblings.length) % siblings.length];
    if (workspace.findByPath(next) && workspace.findByPath(next) !== tab) {
      workspace.activate(workspace.findByPath(next)!);
      return;
    }
    tab.dirty = false;
    tab.retarget(next);
    const e = await api.Stat(next);
    tab.size = e.size;
    await load();
  }

  // ---- saving ----
  async function writeImage(path: string): Promise<boolean> {
    if (!editor) return false;
    let format = extname(path);
    if (!SAVE_FORMATS.includes(format)) {
      ui.toast(`Can't save .${format}. Choose PNG, JPEG, WebP, GIF or BMP.`, 'warning');
      return false;
    }
    if (format === 'jpeg') format = 'jpg';
    const png = await raster.toPNG(editor.composite());
    const entry = await saveFile(path, png, undefined, { transform: 'image', format, quality: '92' });
    tab.size = entry.size;
    editor.markSaved();
    return true;
  }

  async function save(): Promise<boolean> {
    if (isSvg) {
      ui.toast('SVG files are view-only.', 'info');
      return false;
    }
    if (imgMode || !editor) return false;
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeImage(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    if (imgMode || !editor) {
      ui.toast(isSvg ? 'SVG files are view-only.' : 'Start editing to save a copy.', 'info');
      return false;
    }
    const base = tab.filePath ?? join(dirname(tab.path ?? ''), tab.title);
    const path = await api.SaveFileDialog('Save image as', base, [
      { name: 'PNG', patterns: '*.png' },
      { name: 'JPEG', patterns: '*.jpg;*.jpeg' },
      { name: 'WebP (lossless)', patterns: '*.webp' },
      { name: 'GIF', patterns: '*.gif' },
      { name: 'BMP', patterns: '*.bmp' },
    ]);
    if (!path) return false;
    const target = SAVE_FORMATS.includes(extname(path)) ? path : `${path}.png`;
    const ok = await writeImage(target);
    if (ok) tab.retarget(target);
    return ok;
  }

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      reload: load,
      onShow: () => updateStatus(),
      getState: () => undefined,
    };
    void load();
    const ro = new ResizeObserver(() => imgMode && imgFitted && imgFit());
    if (area) ro.observe(area);
    return () => {
      ro.disconnect();
      imageControllers.delete(tab.id);
      destroyEditor();
    };
  });

  // Hooks for the self-test harness (src/test/m2.ts).
  (tab as unknown as { imageTest: unknown }).imageTest = { editor: () => editor, writeImage, imgMode: () => imgMode, natural: () => natural };

  const tools: { id: Tool; icon: any; label: string; key: string }[] = [
    { id: 'hand', icon: Hand, label: 'Move / select', key: 'Escape' },
    { id: 'crop', icon: Crop, label: 'Crop', key: 'C' },
    { id: 'arrow', icon: MoveUpRight, label: 'Arrow', key: 'A' },
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
    { id: 'text', icon: Type, label: 'Text', key: 'T' },
    { id: 'blur', icon: Droplets, label: 'Blur region', key: 'B' },
    { id: 'pixelate', icon: Grid, label: 'Pixelate region', key: 'P' },
  ];
</script>

<div class="toolbar">
  {#if editable}
    {#each tools as t (t.id)}
      <button class="icon-btn" class:on={tool === t.id} title="{t.label} ({formatShortcut(t.key)})" onclick={() => setTool(t.id)}><Icon icon={t.icon} /></button>
    {/each}
    <span class="sep"></span>
    {#each COLORS as c (c)}
      <button class="swatch" class:on={color === c} style:background={c} title="Colour" aria-label="Colour {c}" onclick={() => pickColor(c)}></button>
    {/each}
    <span class="sep"></span>
    <button class="icon-btn" title="Rotate counter-clockwise ([)" onclick={() => editor?.rotate(false)}><Icon icon={RotateCcw} /></button>
    <button class="icon-btn" title="Rotate clockwise (])" onclick={() => editor?.rotate(true)}><Icon icon={RotateCw} /></button>
    <button class="icon-btn" title="Flip horizontally (Shift+H)" onclick={() => editor?.flip(true)}><Icon icon={FlipH} /></button>
    <button class="icon-btn" title="Flip vertically (Shift+V)" onclick={() => editor?.flip(false)}><Icon icon={FlipV} /></button>
    <button class="icon-btn" class:on={resizeOpen} title="Resize…" onclick={() => (resizeOpen ? (resizeOpen = false) : openResize())}><Icon icon={Scaling} /></button>
    <span class="sep"></span>
    <button class="icon-btn" title="Undo ({formatShortcut('Mod+Z')})" disabled={!es?.canUndo} onclick={() => editor?.undo()}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title="Redo ({formatShortcut('Mod+Shift+Z')})" disabled={!es?.canRedo} onclick={() => editor?.redo()}><Icon icon={Redo2} /></button>
  {:else if isSvg}
    <span class="label">SVG — view only (vector images can't be edited here)</span>
  {:else if imgMode && ext === 'gif'}
    <button class="btn ghost" onclick={startEditingGif}><Icon icon={Pencil} size={14} /> Edit (first frame)</button>
  {:else if tab.readOnly}
    <span class="label">Read-only — use Save as to edit a copy</span>
  {/if}
  <span class="spacer"></span>
  <button class="btn ghost" title="Zoom out" onclick={() => ctl.zoom(-1)}>−</button>
  <button class="btn ghost zoomlabel" title="Fit (0) · Actual size (1)" onclick={() => (zoom === 1 ? ctl.fit() : ctl.actual())}>{Math.round(zoom * 100)}%</button>
  <button class="btn ghost" title="Zoom in" onclick={() => ctl.zoom(1)}>+</button>
  {#if tab.filePath}
    <span class="sep"></span>
    <button class="icon-btn" title="Previous image (←)" onclick={() => navigate(-1)}><Icon icon={ChevronLeft} /></button>
    {#if position}<span class="label">{position}</span>{/if}
    <button class="icon-btn" title="Next image (→)" onclick={() => navigate(1)}><Icon icon={ChevronRightIcon} /></button>
  {/if}
</div>

{#if resizeOpen && editor}
  <div class="banner resize">
    <label>Width <input class="input num" type="number" min="1" bind:value={rw} oninput={changeW} /></label>
    <label>Height <input class="input num" type="number" min="1" bind:value={rh} oninput={changeH} /></label>
    <label class="chk"><input type="checkbox" bind:checked={lockAspect} /> Keep aspect ratio</label>
    <span class="muted">from {editor.width} × {editor.height}</span>
    <span class="grow"></span>
    <button class="btn" onclick={() => (resizeOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={applyResize}>Resize</button>
  </div>
{/if}

{#if es?.hasRegion}
  <div class="banner">
    <span class="grow">{tool === 'crop' ? 'Adjust the crop area' : tool === 'blur' ? 'Adjust the area to blur' : 'Adjust the area to pixelate'}, then apply. Markup is merged into the image.</span>
    <button class="btn ghost" onclick={() => editor?.cancelRegion()}><Icon icon={XIcon} size={14} /> Cancel</button>
    <button class="btn primary" onclick={() => editor?.applyRegion()}><Icon icon={Check} size={14} /> Apply (Enter)</button>
  </div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="area checker"
  bind:this={area}
  onwheel={imgMode ? imgWheel : undefined}
  onpointerdown={(e) => {
    if (!imgMode) return;
    drag = { x: e.clientX, y: e.clientY, vx: imgView.x, vy: imgView.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }}
  onpointermove={(e) => {
    if (!drag) return;
    imgView = { ...imgView, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
    imgFitted = false;
  }}
  onpointerup={() => (drag = null)}
  ondblclick={() => imgMode && (imgView.zoom === 1 ? imgFit() : ctl.actual())}
>
  <div class="stage" class:hidden={imgMode} bind:this={stageHost}></div>
  {#if imgMode && src}
    <img
      bind:this={imgEl}
      {src}
      alt={tab.title}
      draggable="false"
      onload={imgLoaded}
      onerror={() => (error = 'This image could not be displayed.')}
      style:transform="translate({imgView.x}px, {imgView.y}px) scale({imgView.zoom})"
      style:width="{natural.w || undefined}px"
      class:pixelated={imgView.zoom >= 2 && !isSvg}
    />
  {/if}
  {#if error}<div class="empty-state overlay">{error}</div>{/if}
  {#if loading}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
</div>

<style>
  .area {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .checker {
    background-color: var(--checker-b);
    background-image: linear-gradient(45deg, var(--checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .stage.hidden {
    display: none;
  }
  img {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    max-width: none;
    user-select: none;
    cursor: grab;
  }
  img.pixelated {
    image-rendering: pixelated;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--bg);
    box-shadow: 0 0 0 1px var(--border);
    margin: 0 2px;
    padding: 0;
    cursor: pointer;
    flex: none;
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .zoomlabel {
    min-width: 58px;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
  .resize label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 90px;
  }
  .chk input {
    accent-color: var(--accent);
  }
</style>
