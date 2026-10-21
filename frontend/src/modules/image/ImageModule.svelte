<script lang="ts">
  import { isNarrow } from '../../core/fit';
  import ImageIco from '@lucide/svelte/icons/image';
  import { fitBar } from '../../core/fit';
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Hand from '@lucide/svelte/icons/hand';
  import Move from '@lucide/svelte/icons/move';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import Lasso from '@lucide/svelte/icons/lasso';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import Crop from '@lucide/svelte/icons/crop';
  import Brush from '@lucide/svelte/icons/paintbrush';
  import Eraser from '@lucide/svelte/icons/eraser';
  import MoveUpRight from '@lucide/svelte/icons/move-up-right';
  import Square from '@lucide/svelte/icons/square';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import Type from '@lucide/svelte/icons/type';
  import Droplets from '@lucide/svelte/icons/droplets';
  import Grid from '@lucide/svelte/icons/grid-3x3';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import Check from '@lucide/svelte/icons/check';
  import XIcon from '@lucide/svelte/icons/x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Layers from '@lucide/svelte/icons/layers';
  import Sliders from '@lucide/svelte/icons/sliders-horizontal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Copy from '@lucide/svelte/icons/copy';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Trash from '@lucide/svelte/icons/trash-2';
  import PaintBucket from '@lucide/svelte/icons/paint-bucket';
  import SquaresUnite from '@lucide/svelte/icons/squares-unite';
  import Save from '@lucide/svelte/icons/save';
  import Eraser2 from '@lucide/svelte/icons/brush-cleaning';
  import { api, endpoint, fileUrl, readFile, saveFile } from '../../core/backend';
  import { basename, extname, stem, dirname, join } from '../../core/paths';
  import { copyTransfer, readTransfer, type Transfer } from '../../core/transfer.svelte';
  import GiveButton from '../../shell/GiveButton.svelte';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { settings } from '../../core/settings.svelte';
  import { ui, toastError, menu } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';
  import { ImageEditor, SELECT_TOOLS, type EditorState, type Tool, type ToolOptions } from './editor';
  import { centered, fitZoom, keepAspect, stepZoom, zoomAt, clampZoom, type View } from './geometry';
  import { imageControllers, type MaskOp } from './editors';
  import * as raster from './raster';
  import * as selection from './selection';
  import { eraseRect } from './vision/erase';
  import { aiModels } from '../../core/aimodels.svelte';
  import { jobs } from '../../core/jobs.svelte';
  import type { SelectMode } from './selection';
  import { availableFonts, fontLabel } from './fonts';
  import { vision, type MaskResult } from './vision/vision';
  import { readOra, writeOra, blendToOra } from './ora';
  import LayersPanel from './LayersPanel.svelte';
  import AdjustPanel from './AdjustPanel.svelte';
  import AnimEditor from './AnimEditor.svelte';
  import IconView from './IconView.svelte';
  import OcrPanel from '../ocr/OcrPanel.svelte';
  import ColoursPanel from './ColoursPanel.svelte';
  import Pipette from '@lucide/svelte/icons/pipette';
  import ScanText from '@lucide/svelte/icons/scan-text';

  let { tab }: { tab: Tab } = $props();

  const SAVE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ora', 'ico', 'icns'];
  /** Formats the webview may not decode: converted by the operating system's own decoder. */
  const VIA_SYSTEM = ['heic', 'heif', 'avif'];
  const ICON_EXT = ['ico', 'cur', 'icns'];
  const COLORS = ['#e5484d', '#f5a524', '#30a46c', '#3e8ed0', '#8e4ec6', '#ffffff', '#1a1a1a'];

  let stageHost = $state<HTMLDivElement>();
  let area = $state<HTMLDivElement>();
  let editor = $state.raw<ImageEditor | null>(null);
  let es = $state<EditorState | null>(null);
  let tool = $state<Tool>('hand');
  let opts = $state<ToolOptions | null>(null);
  let selMode = $state<SelectMode>('replace');
  let error = $state('');
  let loading = $state(true);
  let busy = $state('');
  // "img mode": SVG (view-only) and GIF (until editing starts) are shown with
  // an <img> so SVGs stay crisp and GIFs keep animating.
  let imgMode = $state(false);
  let imgEl = $state<HTMLImageElement>();
  let ocrOpen = $state(false);
  let ocrKey = $state(0);

  /** The picture to read text from (all visible layers) and the selection's box, if any. */
  function ocrSource(): { canvas: HTMLCanvasElement; rect?: { left: number; top: number; width: number; height: number } } {
    if (editor) {
      const b = es?.pixelSelection ? editor.selection?.bounds : undefined;
      return { canvas: editor.composite(), rect: b && b.width > 2 && b.height > 2 ? { left: Math.round(b.x), top: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : undefined };
    }
    const c = document.createElement('canvas');
    c.width = imgEl?.naturalWidth || natural.w;
    c.height = imgEl?.naturalHeight || natural.h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    if (imgEl) g.drawImage(imgEl, 0, 0, c.width, c.height);
    return { canvas: c };
  }

  /** Word boxes of the last recognition, in document pixels (for hiding text). */
  let ocrWords = $state<{ x: number; y: number; width: number; height: number }[]>([]);

  async function runOcr(langs: string[], progress: (s: string, p: number) => void) {
    const { recognize, cropForOcr } = await import('../ocr/ocr');
    const { canvas, rect } = ocrSource();
    const r = await recognize(rect ? cropForOcr(canvas, rect) : canvas, { langs }, progress);
    // Map boxes back from the padded, maybe enlarged crop.
    const scale = rect && (rect.height < 60 || rect.width < 60) ? 2 : 1;
    const pad = rect ? 24 : 0;
    ocrWords = r.lines.flatMap((l) => l.words.filter((w) => w.text.trim() && w.conf > 20)).map((w) => ({ x: (rect?.left ?? 0) + (w.bbox.x0 - pad) / scale, y: (rect?.top ?? 0) + (w.bbox.y0 - pad) / scale, width: (w.bbox.x1 - w.bbox.x0) / scale, height: (w.bbox.y1 - w.bbox.y0) / scale }));
    return r;
  }

  /** Pixelate every recognised word (passwords, names, numbers in a screenshot). */
  function hideText() {
    if (!editor || !ocrWords.length) return;
    const path = new Path2D();
    for (const w of ocrWords) path.rect(w.x - 3, w.y - 3, w.width + 6, w.height + 6);
    const b = ocrWords.reduce((u, w) => ({ x0: Math.min(u.x0, w.x - 3), y0: Math.min(u.y0, w.y - 3), x1: Math.max(u.x1, w.x + w.width + 3), y1: Math.max(u.y1, w.y + w.height + 3) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const bounds = selection.clampRect({ x: Math.floor(b.x0), y: Math.floor(b.y0), width: Math.ceil(b.x1 - b.x0), height: Math.ceil(b.y1 - b.y0) }, editor.width, editor.height);
    editor.setPixelSelection(selection.fromPath(path, bounds, editor.width, editor.height), 'replace');
    editor.pixelateSelection();
    editor.deselect();
    ui.toast(`Pixelated ${ocrWords.length} word${ocrWords.length === 1 ? '' : 's'}. Undo with ${formatShortcut('Mod+Z')}.`, 'success');
  }

  function openOcr() {
    if (ocrOpen) ocrKey++; // run again (e.g. on a new selection)
    ocrOpen = true;
  }
  let imgView = $state<View>({ zoom: 1, x: 0, y: 0 });
  let natural = $state({ w: 0, h: 0 });
  let imgFitted = true;
  let src = $state('');
  let resizeOpen = $state(false);
  let rw = $state(0);
  let rh = $state(0);
  let lockAspect = $state(true);
  let rotateOpen = $state(false);
  let angle = $state(0);
  let expand = $state(true);
  let siblings = $state<string[] | null>(null);
  let panel = $state<'layers' | 'adjust' | 'colours' | null>(loadPanel());
  // A narrow pane (split view, small window): the panel floats over the
  // content, closed when the pane becomes narrow.
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  $effect(() => {
    if (narrow) panel = null;
  });
  let adjustPanel = $state<AdjustPanel>();
  let fonts = $state<string[]>([]);
  let objectPoints: { x: number; y: number; positive: boolean }[] = [];
  let mergedWarned = false;
  // Animated GIF/WebP and icon files get their own views.
  let anim = $state.raw<{ width: number; height: number; loop: number; frames: { path: string; delay: number }[] } | null>(null);
  let icons = $state.raw<{ width: number; height: number; format: string; kind: string; path: string }[] | null>(null);
  let animEd = $state<AnimEditor>();
  /** The system tool that decoded this image (HEIC…), shown in the status bar. */
  let viaSystem = '';
  /** Last internal copy, to paste back at the same position. */
  let clip: { canvas: HTMLCanvasElement; x: number; y: number; at: number } | null = null;

  const ext = $derived(extname(tab.name));
  const isSvg = $derived(ext === 'svg');
  const editable = $derived(!imgMode && !!editor && !tab.readOnly);
  const zoom = $derived(imgMode ? imgView.zoom : (es?.zoom ?? 1));
  const position = $derived(siblings && tab.filePath ? `${siblings.indexOf(tab.filePath) + 1} / ${siblings.length}` : '');

  function loadPanel(): 'layers' | 'adjust' | 'colours' | null {
    try {
      const v = localStorage.getItem('mf.image.panel');
      return v === 'none' ? null : v === 'adjust' ? 'adjust' : v === 'colours' ? 'colours' : 'layers';
    } catch {
      return 'layers';
    }
  }
  /** Toolbar buttons toggle; commands and tabs just show. */
  function togglePanel(p: 'layers' | 'adjust' | 'colours') {
    setPanel(panel === p ? null : p);
  }
  function setPanel(p: 'layers' | 'adjust' | 'colours' | null) {
    panel = p;
    // Asking for a panel shows side panels again if they were hidden.
    if (p && settings.value.panelsHidden) settings.update((s) => (s.panelsHidden = false));
    try {
      localStorage.setItem('mf.image.panel', panel ?? 'none');
    } catch {
      /* private mode */
    }
  }

  async function decodeBlob(blob: Blob): Promise<HTMLCanvasElement> {
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

  async function decode(url: string): Promise<HTMLCanvasElement> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not read image (${res.status})`);
    return decodeBlob(await res.blob());
  }

  async function load() {
    loading = true;
    error = '';
    vision.samKey = '';
    objectPoints = [];
    if (tab.filePath)
      api
        .Siblings(tab.filePath, ['image', 'svg'])
        .then((l) => (siblings = l ?? []))
        .catch(() => {});
    anim = null;
    icons = null;
    viaSystem = '';
    try {
      const url = tab.url();
      if (ICON_EXT.includes(ext) && tab.filePath) {
        destroyEditor();
        icons = await api.IconOpen(tab.filePath);
        return;
      }
      if ((ext === 'gif' || ext === 'webp') && tab.filePath && (await api.AnimFrameCount(tab.filePath)) > 1) {
        destroyEditor();
        try {
          imgMode = false;
          anim = await api.AnimOpen(tab.filePath);
          tab.status = { ...tab.status, type: `Animated ${ext.toUpperCase()}`, position: `${anim.width} × ${anim.height} px`, info: `${anim.frames.length} frames` };
          return;
        } catch (e) {
          // Damaged frames that browsers still play: show it animating, without frame editing.
          imgMode = true;
          src = url;
          ui.toast(`Frames can't be edited: ${String((e as Error)?.message ?? e)}`, 'warning');
          return;
        }
      }
      if (isSvg) {
        imgMode = true;
        src = url;
        destroyEditor();
        return;
      }
      imgMode = false;
      if (ext === 'ora' && tab.filePath) {
        const ora = await readOra(tab.filePath);
        const layers = ora.layers.map((l) => ({ name: l.name, canvas: raster.fromImage(l.bitmap, l.bitmap.width, l.bitmap.height), x: l.x, y: l.y, opacity: l.opacity, visible: l.visible, blend: l.blend as never, objects: parseObjects(l.objects) }));
        await tick();
        if (!editor) createEditor(raster.makeCanvas(ora.width, ora.height));
        // Our own .ora files carry markup and masks separately; take the pixels from before them.
        editor!.loadLayers(
          ora.width,
          ora.height,
          await Promise.all(
            layers.map(async (l, i) => {
              const o = ora.layers[i];
              const raw = o.raw || l.objects.length ? await oraEntry(o.raw ?? `data/raw${i}.png`) : null;
              const mask = o.mask ? await oraEntry(o.mask.src) : null;
              return { ...l, canvas: raw ?? l.canvas, mask: raw && mask ? mask : null, maskOn: o.mask?.on ?? true };
            }),
          ),
        );
        return;
      }
      let canvas: HTMLCanvasElement;
      try {
        canvas = await decode(url);
      } catch (e) {
        if (!VIA_SYSTEM.includes(ext) || !tab.filePath) throw e;
        // The webview can't decode HEIC/AVIF here: let the OS convert it.
        const r = await api.ImageViaSystem(tab.filePath);
        viaSystem = r.tool;
        canvas = await decode(fileUrl(r.path));
      }
      await tick();
      if (editor) editor.load(canvas);
      else createEditor(canvas);
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      loading = false;
    }
  }

  function parseObjects(s?: string): string[] {
    if (!s) return [];
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Our .ora files keep the markup-free raster as data/raw<i>.png next to the flattened layer. */
  async function oraEntry(entry: string): Promise<HTMLCanvasElement | null> {
    try {
      const r = await fetch(endpoint('zip', { path: tab.filePath!, entry }));
      return r.ok ? await decodeBlob(await r.blob()) : null;
    } catch {
      return null;
    }
  }

  function createEditor(canvas: HTMLCanvasElement) {
    editor = new ImageEditor(stageHost!, canvas);
    editor.askText = (initial) => ui.prompt(initial ? 'Edit text' : 'Add text', initial, initial ? 'Update' : 'Add');
    editor.onChange = (s) => {
      es = s;
      if (opts && opts.maskHide !== editor!.opts.maskHide) opts.maskHide = editor!.opts.maskHide;
      tab.dirty = s.dirty;
      updateStatus();
    };
    editor.onPick = (t, x, y, mode) => (t === 'picker' ? pickAt(x, y) : void (t === 'wand' ? wandAt(x, y, mode) : objectAt(x, y, mode)));
    editor.setTool(tool);
    editor.selectMode = selMode;
    opts = { ...editor.opts };
    es = editor.state();
    updateStatus();
    // Opened for a purpose (a screenshot to crop, a colour to pick).
    const init = tab.restoredState as { tool?: Tool; panel?: 'colours' } | undefined;
    if (init && !initApplied) {
      initApplied = true;
      if (init.tool) setTool(init.tool);
      if (init.panel) setPanel(init.panel);
    }
  }

  let initApplied = false;
  let picked = $state<[number, number, number] | null>(null);

  /** The colour of the visible image at a document point. */
  function pickAt(x: number, y: number) {
    if (!editor) return;
    const c = editor.composite();
    const px = Math.min(c.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(c.height - 1, Math.max(0, Math.floor(y)));
    const d = c.getContext('2d')!.getImageData(px, py, 1, 1).data;
    picked = [d[0], d[1], d[2]];
    if (panel !== 'colours') setPanel('colours');
  }

  function destroyEditor() {
    editor?.destroy();
    editor = null;
    es = null;
  }

  function updateStatus() {
    const w = imgMode ? natural.w : (es?.width ?? 0);
    const h = imgMode ? natural.h : (es?.height ?? 0);
    const selInfo = es?.pixelSelection ? ` · selection ${es.pixelSelection.width} × ${es.pixelSelection.height}` : '';
    tab.status = {
      ...tab.status,
      type: isSvg ? 'SVG image (view-only)' : ext === 'ora' ? 'OpenRaster image' : `${ext.toUpperCase()} image${viaSystem ? ` (decoded by ${viaSystem})` : ''}`,
      position: w ? `${w} × ${h} px${selInfo}` : undefined,
      info: `${Math.round(zoom * 100)}%${es && es.layers.length > 1 ? ` · ${es.layers.length} layers` : ''}`,
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

  // ---- smart selection ----
  function maskCanvas(r: MaskResult): HTMLCanvasElement {
    const c = raster.makeCanvas(r.mask.width, r.mask.height);
    c.getContext('2d')!.drawImage(r.mask, 0, 0);
    r.mask.close();
    return c;
  }

  async function wandAt(x: number, y: number, mode: SelectMode) {
    if (!editor || x < 0 || y < 0 || x >= editor.width || y >= editor.height) return;
    try {
      const r = await vision.wand(editor.base, x, y, opts!.wandTolerance, opts!.wandContiguous);
      editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), mode);
    } catch (e) {
      toastError(e, 'Magic wand failed');
    }
  }

  /** Make sure the object model has seen the current image. */
  async function analyse(): Promise<string | null> {
    if (!editor) return null;
    const key = `${tab.id}:${editor.state().version}`;
    if (vision.samKey === key) return key;
    objectPoints = [];
    busy = 'Analysing the image to find objects… (once per image, may take ~15 s)';
    try {
      await vision.analyse(editor.composite(), key);
      return key;
    } catch (e) {
      toastError(e, 'Object selection failed');
      return null;
    } finally {
      busy = '';
    }
  }

  async function objectAt(x: number, y: number, mode: SelectMode) {
    if (!editor || x < 0 || y < 0 || x >= editor.width || y >= editor.height) return;
    const key = await analyse();
    if (!key) return;
    if (mode === 'replace') objectPoints = [];
    objectPoints.push({ x, y, positive: mode !== 'subtract' });
    const slow = setTimeout(() => (busy = 'Finding the object’s edges…'), 300);
    try {
      const r = await vision.selectObject(key, objectPoints);
      editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), 'replace');
    } catch (e) {
      toastError(e, 'Object selection failed');
    } finally {
      clearTimeout(slow);
      busy = '';
    }
  }

  let subjectTipShown = false;
  async function subjectMask(): Promise<MaskResult | null> {
    if (!editor) return null;
    busy = 'Finding the subject…';
    try {
      // The optional BiRefNet model when installed (much better on people and hair), else the bundled U²-Netp.
      if (await aiModels.installed('subject')) return await vision.subjectAI(editor.base, endpoint('ai'));
      if (!subjectTipShown && aiModels.pack('subject')?.supported) {
        subjectTipShown = true;
        ui.toast('Not precise enough? A better subject finder is an optional download.', 'info', { label: 'Get it', run: () => void aiModels.install('subject') }, 8000);
      }
      return await vision.removeBackground(editor.base);
    } catch (e) {
      toastError(e, 'Background removal failed');
      return null;
    } finally {
      busy = '';
    }
  }

  async function removeBackground() {
    const r = await subjectMask();
    if (!r || !editor) return;
    r.edges.close();
    editor.applyMaskToLayer(maskCanvas(r));
    ui.toast('Background removed — save as PNG or WebP to keep the transparency.', 'success');
  }

  async function selectSubject() {
    const r = await subjectMask();
    if (!r || !editor) return;
    editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), editor.selectMode);
  }

  /** Remove what's selected and fill the gap (optional Moebius model). */
  async function removeObject() {
    if (!editor || busy) return;
    const s = editor.selection;
    if (!s) {
      ui.toast('Select what to remove first — lasso around it, or click it with Select object.', 'info');
      return;
    }
    if (!(await aiModels.installed('eraser')) && !(await aiModels.install('eraser'))) return;
    const rect = eraseRect(s.bounds, editor.width, editor.height);
    busy = 'Removing the object…';
    try {
      const started = await vision.eraseBegin(editor.composite(), s.mask, rect, endpoint('ai'), Math.floor(Math.random() * 2 ** 31));
      const done = await jobs.run('Removing the object', () => Promise.resolve(started.job));
      if (done.cancelled) return;
      if (done.error) throw new Error(done.error);
      const { patch } = await vision.eraseFinish(started, endpoint('ai'));
      editor.paintPatch(patch, rect.x, rect.y);
      patch.close();
      editor.deselect();
      ui.toast('Removed. Not right? Undo and run it again for a different fill.', 'success');
    } catch (e) {
      toastError(e, 'Object removal failed');
    } finally {
      busy = '';
    }
  }

  async function invertSelection() {
    if (!editor) return;
    const inv = selection.invert(editor.selection, editor.width, editor.height);
    try {
      const r = await vision.edges(inv.mask);
      r.mask.close();
      editor.invertSelection({ canvas: r.edges, scale: r.edgeScale });
    } catch {
      editor.invertSelection();
    }
  }

  // ---- clipboard ----
  function copy(cut = false, merged = false) {
    if (!editor) return;
    const { canvas, x, y } = editor.copySelection(merged);
    clip = { canvas, x, y, at: Date.now() };
    // Also on the system clipboard and for any other tab (Ctrl+V in a video, a note…).
    void copyTransfer({ kind: 'image', image: canvas, name: `${stem(tab.title)}${editor.selection ? ' (part)' : ''}` });
    if (cut) editor.clearSelectionPixels();
    ui.toast(`${cut ? 'Cut' : 'Copied'} ${canvas.width} × ${canvas.height} px`, 'success');
  }

  async function paste() {
    if (!editor) return;
    const t = await readTransfer();
    if (!t) return ui.toast('The clipboard is empty.', 'info');
    if (t.kind === 'image') {
      // Our own copy goes back where it came from.
      const same = clip && clip.canvas.width === t.image.width && clip.canvas.height === t.image.height && Date.now() - clip.at < 10 * 60_000;
      editor.pasteImage(t.image, same ? { x: clip!.x, y: clip!.y } : undefined, t.name || 'Pasted');
    } else await take(t);
  }

  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];

  /** The selection, or the picture as it looks, for another tab (a drag, Ctrl+C elsewhere). */
  function giveImage(): Transfer | null {
    if (!editor) return null;
    const { canvas } = editor.copySelection(true);
    return { kind: 'image', image: canvas, name: `${stem(tab.title)}${editor.selection ? ' (part)' : ''}` };
  }

  /** From another tab: a picture becomes a layer, text a text object, image files layers — at the drop point. */
  async function take(t: Transfer, at?: { x: number; y: number }): Promise<boolean> {
    if (!editor || !editable) return false;
    const p = at ? editor.docPoint(at.x, at.y) : undefined;
    const centred = (c: HTMLCanvasElement) => (p ? { x: Math.round(p.x - c.width / 2), y: Math.round(p.y - c.height / 2) } : undefined);
    if (t.kind === 'image') editor.pasteImage(t.image, centred(t.image), t.name || 'Pasted');
    else if (t.kind === 'text') await editor.addText(p ?? { x: Math.round(editor.width / 8), y: Math.round(editor.height / 8) }, t.text.trim().slice(0, 2000));
    else {
      const imgs = t.paths.filter((x) => IMAGE_EXT.includes(extname(x)));
      if (!imgs.length) {
        ui.toast('Only pictures can be added as layers.', 'info');
        return false;
      }
      for (const f of imgs) {
        const c = await decodeBlob(new Blob([await readFile(f)]));
        editor.pasteImage(c, centred(c), stem(f));
      }
    }
    return true;
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
    undo: () => (anim ? animEd?.undo() : editor?.undo()),
    redo: () => (anim ? animEd?.redo() : editor?.redo()),
    apply: () => editor?.applyRegion(),
    escape: () => {
      if (resizeOpen) resizeOpen = false;
      else if (rotateOpen) cancelRotate();
      else if (es?.hasRegion) editor?.cancelRegion();
      else if (es?.pixelSelection) editor?.deselect();
      else setTool('hand');
    },
    deleteSelection: () => {
      if (anim) return void animEd?.remove();
      if (es?.hasSelection) editor?.deleteSelection();
      else if (es?.pixelSelection) editor?.clearSelectionPixels();
    },
    navigate: (dir: 1 | -1) => (anim ? animEd?.step(dir) : void navigate(dir)),
    resize: () => openResize(),
    rotateAngle: () => openRotate(),
    copy: (merged: boolean) => copy(false, merged),
    cut: () => copy(true),
    paste: () => void paste(),
    selectAll: () => editor?.selectAll(),
    deselect: () => editor?.deselect(),
    invert: () => void invertSelection(),
    layerFromSelection: () => editor?.layerFromSelection(),
    newLayer: () => editor?.addLayer(),
    mergeDown: () => editor?.mergeDown(),
    flatten: () => editor?.flatten(),
    mask: (op: MaskOp) => {
      if (!editor) return;
      if (op === 'add') {
        editor.addMask(editor.selection ? 'selection' : 'show');
        setPanel('layers');
      } else if (op === 'edit') editor.setEditMask(!editor.editMask);
      else if (op === 'invert') editor.invertMask();
      else if (op === 'toggle') editor.toggleMask();
      else if (op === 'apply') editor.applyMask();
      else if (op === 'delete') editor.deleteMask();
      else if (op === 'hide' || op === 'show') editor.fillMask(op === 'show');
      else editor.setMaskHide(!editor.opts.maskHide);
    },
    removeBackground: () => void removeBackground(),
    selectSubject: () => void selectSubject(),
    removeObject: () => void removeObject(),
    saveCopy: () => void saveCopy(),
    saveLayers: () => void saveWithLayers(),
    panel: (p: 'layers' | 'adjust' | 'colours') => setPanel(p),
    picked: () => picked,
    editable: () => editable,
  };
  imageControllers.set(tab.id, ctl);

  function setTool(t: Tool) {
    if (!editable && t !== 'hand') return;
    tool = t;
    editor?.setTool(t);
    if (t === 'text' && !fonts.length) fonts = availableFonts();
  }

  function setOpt<K extends keyof ToolOptions>(k: K, v: ToolOptions[K]) {
    if (!editor || !opts) return;
    opts[k] = v;
    editor.setOptions({ [k]: v } as Partial<ToolOptions>);
  }

  function pickColor(c: string) {
    if (!opts) return;
    opts.color = c;
    editor?.setColor(c);
  }

  function setSelMode(m: SelectMode) {
    selMode = m;
    if (editor) editor.selectMode = m;
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

  function openRotate() {
    if (!editor) return;
    angle = 0;
    rotateOpen = true;
  }
  function previewAngle() {
    editor?.previewRotation(angle);
  }
  function applyRotate() {
    if (!editor) return;
    rotateOpen = false;
    editor.rotateBy(angle, expand);
  }
  function cancelRotate() {
    rotateOpen = false;
    editor?.previewRotation(0);
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
  async function writeOraFile(path: string): Promise<boolean> {
    if (!editor) return false;
    const layers = editor.exportLayers();
    const merged = editor.composite();
    const k = Math.min(1, 256 / Math.max(merged.width, merged.height));
    const thumb = raster.resize(merged, Math.max(1, Math.round(merged.width * k)), Math.max(1, Math.round(merged.height * k)));
    const raws = editor.rawLayers();
    const buf = await writeOra({
      width: editor.width,
      height: editor.height,
      layers: await Promise.all(
        layers.map(async (l, i) => ({
          name: l.name,
          png: await raster.toPNG(l.canvas),
          x: l.x,
          y: l.y,
          opacity: l.opacity,
          visible: l.visible,
          composite: blendToOra(l.blend),
          objects: l.objects.length ? JSON.stringify(l.objects) : undefined,
          raw: raws[i] ? `data/raw${i}.png` : undefined,
          mask: l.mask ? { src: `data/mask${i}.png`, on: l.maskOn ?? true } : undefined,
        })),
      ),
      merged: await raster.toPNG(merged),
      thumbnail: await raster.toPNG(thumb),
      extra: [
        ...(await Promise.all(raws.map(async (c, i) => (c ? { name: `data/raw${i}.png`, png: await raster.toPNG(c) } : null)))),
        ...(await Promise.all(layers.map(async (l, i) => (l.mask ? { name: `data/mask${i}.png`, png: await raster.toPNG(l.mask) } : null)))),
      ],
    });
    const entry = await saveFile(path, buf);
    tab.size = entry.size;
    editor.markSaved();
    return true;
  }

  async function writeImage(path: string): Promise<boolean> {
    if (!editor) return false;
    let format = extname(path);
    if (!SAVE_FORMATS.includes(format)) {
      ui.toast(`Can't save .${format}. Choose PNG, JPEG, WebP, GIF, BMP, ICO, ICNS or ORA.`, 'warning');
      return false;
    }
    if (format === 'ora') return writeOraFile(path);
    if (format === 'ico' || format === 'icns') {
      // An icon with every standard size, from the flattened image.
      const tmp = await api.TempPath('icon-source.png');
      await saveFile(tmp, await raster.toPNG(editor.composite()));
      try {
        await api.IconWrite(tmp, path, format, []);
      } finally {
        void api.RemoveTemp(tmp);
      }
      tab.size = (await api.Stat(path)).size;
      editor.markSaved();
      return true;
    }
    if (format === 'jpeg') format = 'jpg';
    if (editor.layerCount > 1 && !mergedWarned) {
      mergedWarned = true;
      ui.toast('Layers were merged into the saved image. Use “Save with layers (.ora)” to keep them editable.', 'info');
    }
    const png = await raster.toPNG(editor.composite());
    const entry = await saveFile(path, png, undefined, { transform: 'image', format, quality: '92' });
    tab.size = entry.size;
    editor.markSaved();
    return true;
  }

  /** "photo (edited).png", "photo (edited 2).png", … next to the original. */
  async function copyPath(): Promise<string> {
    const p = tab.filePath ?? join(dirname(tab.path ?? ''), tab.title);
    const dir = dirname(p);
    const e = SAVE_FORMATS.includes(extname(p)) ? extname(p) : VIA_SYSTEM.includes(extname(p)) ? 'jpg' : 'png';
    const base = stem(p).replace(/ \(edited( \d+)?\)$/, '');
    const names = Array.from({ length: 50 }, (_, i) => join(dir, `${base} (edited${i ? ` ${i + 1}` : ''}).${e}`));
    const taken = await api.Exists(names);
    return names[taken.indexOf(false)] ?? names[0];
  }

  async function saveCopy(): Promise<boolean> {
    if (imgMode || !editor) return false;
    const target = await copyPath();
    const ok = await writeImage(target);
    if (ok) {
      tab.retarget(target);
      ui.toast(`Saved a copy: ${basename(target)} (the original is unchanged)`, 'success');
    }
    return ok;
  }

  async function save(): Promise<boolean> {
    if (anim) return animEd?.save() ?? false;
    if (icons) return false;
    if (isSvg) {
      ui.toast('SVG files are view-only.', 'info');
      return false;
    }
    if (imgMode || !editor) return false;
    if (!tab.filePath || tab.readOnly) return saveAs();
    // Keep originals: the first save of an opened image goes to a copy.
    if (settings.value.imageKeepOriginal && !/ \(edited( \d+)?\)$/.test(stem(tab.filePath))) return saveCopy();
    // HEIC/AVIF can't be written: the edit goes to a JPEG copy next to it.
    if (!SAVE_FORMATS.includes(extname(tab.filePath))) return saveCopy();
    return writeImage(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    if (anim) return animEd?.saveAs() ?? false;
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
      { name: 'Windows icon (all sizes)', patterns: '*.ico' },
      { name: 'macOS icon (all sizes)', patterns: '*.icns' },
      { name: 'OpenRaster with layers', patterns: '*.ora' },
    ]);
    if (!path) return false;
    const target = SAVE_FORMATS.includes(extname(path)) ? path : `${path}.png`;
    const ok = await writeImage(target);
    if (ok) tab.retarget(target);
    return ok;
  }

  async function saveWithLayers(): Promise<boolean> {
    if (imgMode || !editor) return false;
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.ora`);
    const path = await api.SaveFileDialog('Save with layers', base, [{ name: 'OpenRaster (GIMP, Krita, MyPaint)', patterns: '*.ora' }]);
    if (!path) return false;
    const target = extname(path) === 'ora' ? path : `${path}.ora`;
    const ok = await writeOraFile(target);
    if (ok) tab.retarget(target);
    return ok;
  }

  function imageMenu(e: MouseEvent) {
    if (!editor) return;
    const ed = editor;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: 'Rotate left', shortcut: '[', run: () => ed.rotate(false) },
      { label: 'Rotate right', shortcut: ']', run: () => ed.rotate(true) },
      { label: 'Rotate by angle…', shortcut: formatShortcut('Mod+Alt+R'), run: () => openRotate() },
      { label: 'Flip horizontally', shortcut: 'Shift+H', run: () => ed.flip(true) },
      { label: 'Flip vertically', shortcut: 'Shift+V', run: () => ed.flip(false) },
      { label: 'Resize…', shortcut: formatShortcut('Mod+Alt+I'), run: () => openResize() },
      { separator: true },
      { label: 'Remove background', run: () => void removeBackground() },
      { label: 'Select subject', run: () => void selectSubject() },
      { label: 'Remove object (fill the gap)', disabled: !es?.pixelSelection, run: () => void removeObject() },
      { separator: true },
      { label: 'New layer', shortcut: formatShortcut('Mod+Shift+N'), run: () => ed.addLayer() },
      { label: 'Flatten image', run: () => ed.flatten() },
    ]);
  }

  function saveMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: 'Save', shortcut: formatShortcut('Mod+S'), run: () => void save() },
      { label: 'Save a copy (keep original)', shortcut: formatShortcut('Mod+Alt+S'), run: () => void saveCopy() },
      { label: 'Save as…', shortcut: formatShortcut('Mod+Shift+S'), run: () => void saveAs() },
      { label: 'Save with layers (.ora)…', run: () => void saveWithLayers() },
      { separator: true },
      { label: settings.value.imageKeepOriginal ? '✓ Always keep originals' : 'Always keep originals', run: () => settings.update((s) => (s.imageKeepOriginal = !s.imageKeepOriginal)) },
    ]);
  }

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      reload: load,
      onShow: () => updateStatus(),
      getState: () => undefined,
      give: giveImage,
      accept: { kinds: ['image', 'text', 'files'], take, claimsDrop: (paths) => editable && paths.every((p) => IMAGE_EXT.includes(extname(p))) },
    };
    void load();
    const ro = new ResizeObserver(() => imgMode && imgFitted && imgFit());
    if (area) ro.observe(area);
    return () => {
      ro.disconnect();
      imageControllers.delete(tab.id);
      destroyEditor();
      vision.stop();
    };
  });

  // Hooks for the self-test harness (src/test/m2.ts, m9.ts).
  (tab as unknown as { imageTest: unknown }).imageTest = {
    editor: () => editor,
    writeImage,
    imgMode: () => imgMode,
    natural: () => natural,
    wandAt,
    objectAt,
    removeBackground,
    selectSubject,
    removeObject,
    copy,
    paste,
    saveCopy,
    adjust: () => adjustPanel,
    setPanel,
    busy: () => busy,
    fonts: () => availableFonts(),
    tool: () => tool,
    panel: () => panel,
    picked: () => picked,
    pickAt,
    hideText,
    ocrWords: () => ocrWords,
  };

  /** label: name; help: how to use it (shown on hover). */
  type ToolDef = { id: Tool; icon: any; label: string; help: string; key?: string };
  const toolGroups: ToolDef[][] = [
    [
      { id: 'hand', icon: Hand, label: 'Hand', help: 'Drag to pan the view; click an arrow, shape or text to select and edit it. Scroll to zoom.', key: 'H' },
      { id: 'move', icon: Move, label: 'Move layer', help: 'Drag to move the active layer; drag the handles to scale or rotate it.', key: 'V' },
    ],
    [
      { id: 'select', icon: SquareDashed, label: 'Rectangle select', help: 'Drag to select a rectangle. Hold Ctrl for a square, Shift to add, Alt to subtract.', key: 'M' },
      { id: 'ellipse', icon: CircleDashed, label: 'Ellipse select', help: 'Drag to select an ellipse. Hold Ctrl for a circle, Shift to add, Alt to subtract.' },
      { id: 'lasso', icon: Lasso, label: 'Lasso select', help: 'Drag around an area to select it freehand. Shift adds, Alt subtracts.', key: 'L' },
      { id: 'wand', icon: Wand, label: 'Magic wand', help: 'Click to select pixels of a similar colour. Set Tolerance in the toolbar; Shift adds, Alt subtracts.', key: 'W' },
      { id: 'object', icon: ScanEye, label: 'Select object', help: 'Click an object to select it, with edges snapped to the pixels. Shift-click adds, Alt-click excludes a part.', key: 'O' },
    ],
    [{ id: 'crop', icon: Crop, label: 'Crop', help: 'Drag the area to keep (Ctrl for a square), adjust the handles, then press Enter.', key: 'C' }],
    [
      { id: 'brush', icon: Brush, label: 'Brush', help: 'Drag to paint on the active layer. Set size, opacity and colour in the toolbar.', key: 'B' },
      { id: 'eraser', icon: Eraser, label: 'Eraser', help: 'Drag to erase the active layer to transparency.', key: 'E' },
    ],
    [
      { id: 'picker', icon: Pipette, label: 'Colour picker', help: 'Click the image to pick a colour: see it as HEX/RGB/HSL in Colours, copy it or use it to draw.', key: 'I' },
      { id: 'text', icon: Type, label: 'Text', help: 'Click where the text should go and type it. Double-click text later to edit it.', key: 'T' },
      { id: 'arrow', icon: MoveUpRight, label: 'Arrow', help: 'Drag from the tail to the tip to draw an arrow.', key: 'A' },
      { id: 'rect', icon: Square, label: 'Rectangle', help: 'Drag to draw a rectangle. Hold Ctrl (or Shift) for a square; set Corners in the toolbar for rounded or sharp corners.', key: 'R' },
      { id: 'oval', icon: CircleIcon, label: 'Ellipse', help: 'Drag to draw an ellipse. Hold Ctrl (or Shift) for a circle.' },
    ],
    [
      { id: 'blur', icon: Droplets, label: 'Blur region', help: 'Drag over an area (faces, plates…), adjust it, then press Enter to blur it.', key: 'U' },
      { id: 'pixelate', icon: Grid, label: 'Pixelate region', help: 'Drag over an area, adjust it, then press Enter to pixelate it.', key: 'P' },
    ],
  ];
  const shapeTool = $derived(['arrow', 'rect', 'oval'].includes(tool));
  const obj = $derived(es?.object ?? null);
</script>

<div class="toolbar" use:fitBar>
  {#if editable && opts}
    <!-- Contextual options for the current tool / selected object -->
    {#if obj?.kind === 'text'}
      <select class="font" value={obj.fontFamily} onfocus={() => (fonts = fonts.length ? fonts : availableFonts())} onchange={(e) => editor?.updateObject({ fontFamily: (e.target as HTMLSelectElement).value })} title="Font">
        {#each fonts.length ? fonts : [obj.fontFamily ?? 'Inter Variable'] as f (f)}<option value={f} style:font-family={f}>{fontLabel(f)}</option>{/each}
      </select>
      <input class="input num sm" type="number" min="4" max="2000" value={obj.fontSize} title="Size" onchange={(e) => editor?.updateObject({ fontSize: +(e.target as HTMLInputElement).value })} />
      <button class="btn ghost b" class:on={obj.bold} title="Bold" onclick={() => editor?.updateObject({ bold: !obj.bold })}>B</button>
      <button class="btn ghost i" class:on={obj.italic} title="Italic" onclick={() => editor?.updateObject({ italic: !obj.italic })}>I</button>
      <button class="btn ghost" class:on={obj.outline} title="Outline" onclick={() => editor?.updateObject({ outline: !obj.outline })}>Outline</button>
      <button class="btn ghost" class:on={obj.shadow} title="Shadow" onclick={() => editor?.updateObject({ shadow: !obj.shadow })}>Shadow</button>
      <button class="btn ghost" title="Edit text" onclick={async () => {
        const t = await ui.prompt('Edit text', obj.text ?? '', 'Update');
        if (t) editor?.updateObject({ text: t });
      }}><Icon icon={Pencil} size={14} /></button>
      <span class="sep"></span>
    {:else if tool === 'text'}
      <select class="font" value={opts.fontFamily} onchange={(e) => setOpt('fontFamily', (e.target as HTMLSelectElement).value)} title="Font">
        {#each fonts as f (f)}<option value={f} style:font-family={f}>{fontLabel(f)}</option>{/each}
      </select>
      <input class="input num sm" type="number" min="0" max="2000" value={opts.fontSize || ''} placeholder="auto" title="Size (empty = automatic)" onchange={(e) => setOpt('fontSize', +(e.target as HTMLInputElement).value || 0)} />
      <button class="btn ghost b" class:on={opts.bold} title="Bold" onclick={() => setOpt('bold', !opts!.bold)}>B</button>
      <button class="btn ghost i" class:on={opts.italic} title="Italic" onclick={() => setOpt('italic', !opts!.italic)}>I</button>
      <button class="btn ghost" class:on={opts.outline} title="Outline around the letters" onclick={() => setOpt('outline', !opts!.outline)}>Outline</button>
      <button class="btn ghost" class:on={opts.shadow} title="Soft shadow behind the text" onclick={() => setOpt('shadow', !opts!.shadow)}>Shadow</button>
      <span class="sep"></span>
    {:else if SELECT_TOOLS.includes(tool)}
      <div class="seg" role="radiogroup" aria-label="Selection mode">
        {#each [['replace', 'New', 'New selection'], ['add', 'Add', 'Add to the selection (or hold Shift)'], ['subtract', 'Subtract', 'Subtract from the selection (or hold Alt)']] as [m, l, t] (m)}
          <button role="radio" aria-checked={selMode === m} class:on={selMode === m} title={t} onclick={() => setSelMode(m as SelectMode)}>{l}</button>
        {/each}
      </div>
      {#if tool === 'wand'}
        <label class="opt">Tolerance <input type="range" min="0" max="128" value={opts.wandTolerance} oninput={(e) => setOpt('wandTolerance', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.wandTolerance}</span></label>
        <label class="opt chk"><input type="checkbox" checked={opts.wandContiguous} onchange={(e) => setOpt('wandContiguous', (e.target as HTMLInputElement).checked)} /> Contiguous</label>
      {:else if tool === 'object'}
        <span class="hint">Click an object · Shift-click to add · Alt-click to exclude</span>
        <button class="btn ghost" title="Select the main subject of the image automatically" onclick={selectSubject}><Icon icon={Sparkles} size={14} /> Select subject</button>
      {/if}
      <span class="sep"></span>
    {:else if tool === 'brush' || tool === 'eraser'}
      <label class="opt">Size <input type="range" min="1" max="300" value={opts.brushSize || 12} oninput={(e) => setOpt('brushSize', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.brushSize || 'auto'}</span></label>
      {#if tool === 'brush'}<label class="opt">Opacity <input type="range" min="5" max="100" value={Math.round(opts.brushOpacity * 100)} oninput={(e) => setOpt('brushOpacity', +(e.target as HTMLInputElement).value / 100)} /></label>{/if}
      {#if es?.editMask}
        <span class="chips" role="radiogroup" aria-label="On the mask the brush">
          <button class="chip" role="radio" aria-checked={opts.maskHide} class:on={opts.maskHide} title="The brush hides, the eraser shows (X swaps)" onclick={() => editor?.setMaskHide(true)}>Hide</button>
          <button class="chip" role="radio" aria-checked={!opts.maskHide} class:on={!opts.maskHide} title="The brush shows, the eraser hides (X swaps)" onclick={() => editor?.setMaskHide(false)}>Show</button>
        </span>
        <button class="btn ghost" title="Paint on the layer's pixels again" onclick={() => editor?.setEditMask(false)}>Done with mask</button>
      {/if}
      <span class="sep"></span>
    {:else if shapeTool || obj}
      <label class="opt" title="Line width">Width <input type="range" min="1" max="60" value={obj?.strokeWidth ?? (opts.strokeWidth || 6)} oninput={(e) => (obj ? editor?.updateObject({ strokeWidth: +(e.target as HTMLInputElement).value }) : setOpt('strokeWidth', +(e.target as HTMLInputElement).value))} /></label>
      {#if tool === 'rect' || tool === 'oval' || obj?.kind === 'rect' || obj?.kind === 'oval'}
        <label class="opt chk" title="Fill the shape with the colour"><input type="checkbox" checked={obj ? !!obj.filled : opts.filled} onchange={(e) => (obj ? editor?.updateObject({ filled: (e.target as HTMLInputElement).checked }) : setOpt('filled', (e.target as HTMLInputElement).checked))} /> Filled</label>
      {/if}
      {#if tool === 'rect' || obj?.kind === 'rect'}
        {@const radius = obj ? (obj.cornerRadius ?? 0) : opts.cornerRadius}
        <label class="opt" title="Corner radius: 0 = sharp corners, higher = rounder">Corners <input type="range" min="0" max="200" value={radius} oninput={(e) => (obj ? editor?.updateObject({ cornerRadius: +(e.target as HTMLInputElement).value }) : setOpt('cornerRadius', +(e.target as HTMLInputElement).value))} /><span class="v">{radius}</span></label>
      {/if}
      <span class="sep"></span>
    {/if}
    {#if tool !== 'eraser' && !SELECT_TOOLS.includes(tool) && tool !== 'crop' && tool !== 'blur' && tool !== 'pixelate'}
      {#each COLORS as c (c)}
        <button class="swatch" class:on={(obj?.color ?? opts.color) === c} style:background={c} title="Colour" aria-label="Colour {c}" onclick={() => pickColor(c)}></button>
      {/each}
      <input class="custom" type="color" value={obj?.color ?? opts.color} title="Custom colour" oninput={(e) => pickColor((e.target as HTMLInputElement).value)} />
      <span class="sep"></span>
    {/if}
    <button class="icon-btn" title="Undo ({formatShortcut('Mod+Z')})" disabled={!es?.canUndo} onclick={() => editor?.undo()}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title="Redo ({formatShortcut('Mod+Shift+Z')})" disabled={!es?.canRedo} onclick={() => editor?.redo()}><Icon icon={Redo2} /></button>
    <span class="sep"></span>
    <button class="btn ghost" title="Rotate, flip, resize, remove background…" onclick={imageMenu}><Icon icon={ImageIco} size={14} /> Image ▾</button>
  {:else if isSvg}
    <span class="label">SVG — view only here</span>
  {:else if imgMode && ext === 'gif'}
    <button class="btn ghost" title="Open the first frame in the editor" onclick={startEditingGif}><Icon icon={Pencil} size={14} /> Edit (first frame)</button>
  {:else if tab.readOnly}
    <span class="label">Read-only — use Save as to edit a copy</span>
  {/if}
  <span class="spacer"></span>
  {#if editable}
    <GiveButton {tab} get={giveImage} what={es?.pixelSelection ? 'the selection' : 'the picture'} />
    <button class="btn ghost" title="Save options" onclick={saveMenu}><Icon icon={Save} size={14} /> Save ▾</button>
    <span class="sep"></span>
  {/if}
  <button class="btn ghost" title="Zoom out" onclick={() => ctl.zoom(-1)}>−</button>
  <button class="btn ghost zoomlabel" title="Fit (0) · Actual size (1)" onclick={() => (zoom === 1 ? ctl.fit() : ctl.actual())}>{Math.round(zoom * 100)}%</button>
  <button class="btn ghost" title="Zoom in" onclick={() => ctl.zoom(1)}>+</button>
  {#if tab.filePath}
    <span class="sep"></span>
    <button class="icon-btn" title="Previous image (←)" onclick={() => navigate(-1)}><Icon icon={ChevronLeft} /></button>
    {#if position}<span class="label">{position}</span>{/if}
    <button class="icon-btn" title="Next image (→)" onclick={() => navigate(1)}><Icon icon={ChevronRightIcon} /></button>
  {/if}
  <span class="sep"></span>
  <button class="icon-btn" class:on={ocrOpen} title="Copy text from the image (OCR) — from the selection if there is one" aria-label="Recognise text" onclick={() => (ocrOpen ? (ocrOpen = false) : openOcr())}><Icon icon={ScanText} /></button>
  {#if editable}
    <span class="sep"></span>
    <button class="icon-btn" class:on={panel === 'layers'} title="Layers" onclick={() => togglePanel('layers')}><Icon icon={Layers} /></button>
    <button class="icon-btn" class:on={panel === 'adjust'} title="Adjust colours" onclick={() => togglePanel('adjust')}><Icon icon={Sliders} /></button>
  {/if}
</div>

{#if resizeOpen && editor}
  <div class="banner resize">
    <label>Width <input class="input num" type="number" min="1" bind:value={rw} oninput={changeW} /></label>
    <label>Height <input class="input num" type="number" min="1" bind:value={rh} oninput={changeH} /></label>
    <label class="chk"><input type="checkbox" bind:checked={lockAspect} /> Keep aspect ratio</label>
    <span class="muted">from {editor.width} × {editor.height}</span>
    <span class="grow"></span>
    <button class="btn" title="Close without resizing" onclick={() => (resizeOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={applyResize}>Resize</button>
  </div>
{/if}

{#if rotateOpen && editor}
  <div class="banner resize">
    <label class="angle">Angle <input type="range" min="-180" max="180" step="0.5" bind:value={angle} oninput={previewAngle} /> <input class="input num sm" type="number" min="-360" max="360" step="0.5" bind:value={angle} oninput={previewAngle} />°</label>
    <label class="chk"><input type="checkbox" bind:checked={expand} /> Enlarge canvas to fit</label>
    <span class="grow"></span>
    <button class="btn" onclick={cancelRotate}>Cancel</button>
    <button class="btn primary" onclick={applyRotate}>Rotate</button>
  </div>
{/if}

{#if es?.hasRegion}
  <div class="banner">
    <span class="grow">{tool === 'crop' ? 'Adjust the crop area' : tool === 'blur' ? 'Adjust the area to blur' : 'Adjust the area to pixelate'}, then apply.</span>
    <button class="btn ghost" title="Discard the area (Esc)" onclick={() => editor?.cancelRegion()}><Icon icon={XIcon} size={14} /> Cancel</button>
    <button class="btn primary" onclick={() => editor?.applyRegion()}><Icon icon={Check} size={14} /> Apply (Enter)</button>
  </div>
{:else if es?.pixelSelection && editable}
  <div class="banner selbar">
    <span class="muted">Selection {es.pixelSelection.width} × {es.pixelSelection.height}</span>
    <span class="grow"></span>
    <button class="btn ghost" title="Copy ({formatShortcut('Mod+C')})" onclick={() => copy()}><Icon icon={Copy} size={14} /> Copy</button>
    <button class="btn ghost" title="Cut ({formatShortcut('Mod+X')})" onclick={() => copy(true)}><Icon icon={Scissors} size={14} /> Cut</button>
    <button class="btn ghost" title="New layer from selection ({formatShortcut('Mod+J')})" onclick={() => editor?.layerFromSelection()}><Icon icon={SquaresUnite} size={14} /> To layer</button>
    <button class="btn ghost remove-object" title="Remove the selected object and fill the gap with what could be behind it" onclick={() => void removeObject()}><Icon icon={Eraser2} size={14} /> Remove</button>
    <button class="btn ghost" title="Delete pixels (Delete)" onclick={() => editor?.clearSelectionPixels()}><Icon icon={Trash} size={14} /></button>
    <button class="btn ghost" title="Fill with colour" onclick={() => editor?.fillSelection()}><Icon icon={PaintBucket} size={14} /></button>
    <button class="btn ghost" title="Blur the selection: opens Adjust → Blur (Gaussian, motion, zoom, spin, lens, tilt-shift, surface)" onclick={() => setPanel('adjust')}><Icon icon={Droplets} size={14} /></button>
    <button class="btn ghost" title="Pixelate selection" onclick={() => editor?.pixelateSelection()}><Icon icon={Grid} size={14} /></button>
    <button class="btn ghost" title="Crop to selection" onclick={() => editor?.cropToSelection()}><Icon icon={Crop} size={14} /></button>
    <button class="btn ghost" title="Copy the text in the selection (OCR)" onclick={openOcr}><Icon icon={ScanText} size={14} /> Text</button>
    <button class="btn ghost" title="Invert selection ({formatShortcut('Mod+Shift+I')})" onclick={invertSelection}>Invert</button>
    <button class="btn ghost" title="Deselect ({formatShortcut('Mod+D')})" onclick={() => editor?.deselect()}><Icon icon={XIcon} size={14} /></button>
  </div>
{/if}

{#if anim}
  <AnimEditor bind:this={animEd} {tab} info={anim} />
{:else if icons}
  <IconView {tab} entries={icons} onreload={() => void load()} />
{:else}
<div class="body" bind:clientWidth={bodyW}>
  {#if editable}
    <div class="tools" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {#each toolGroups as group, gi (gi)}
        {#if gi}<span class="hsep"></span>{/if}
        {#each group as t (t.id)}
          <button class="icon-btn" class:on={tool === t.id} title="{t.label}{t.key ? ` (${formatShortcut(t.key)})` : ''} — {t.help}" aria-label={t.label} onclick={() => setTool(t.id)}><Icon icon={t.icon} /></button>
        {/each}
      {/each}
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="area"
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
        style:--z={imgView.zoom}
        class="checker"
        class:pixelated={imgView.zoom >= 2 && !isSvg}
      />
    {/if}
    {#if error}<div class="empty-state overlay">{error}</div>{/if}
    {#if loading}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
    {#if busy}<div class="busy"><span class="spinner"></span> {busy}</div>{/if}
  </div>
  {#if editable && panel && editor && es}
    <aside data-sidepanel class="panel" class:floating={narrow} class:right={narrow}>
      <div class="ptabs">
        <button class:on={panel === 'layers'} onclick={() => setPanel('layers')}>Layers</button>
        <button class:on={panel === 'adjust'} onclick={() => setPanel('adjust')}>Adjust</button>
        <button class:on={panel === 'colours'} onclick={() => setPanel('colours')}>Colours</button>
      </div>
      {#if panel === 'layers'}
        <LayersPanel {editor} {es} />
      {:else if panel === 'colours'}
        <ColoursPanel {editor} {picked} title={tab.filePath ?? tab.title} onuse={(c) => (pickColor(c), ui.toast(`Using ${c}`, 'success'))} />
      {:else}
        <AdjustPanel bind:this={adjustPanel} {editor} {es} />
      {/if}
    </aside>
  {/if}
  {#if ocrOpen}
    {#key ocrKey}
      <OcrPanel title={es?.pixelSelection ? 'Text in the selection' : 'Text in the image'} run={runOcr} onclose={() => (ocrOpen = false)}>
        {#snippet actions()}
          {#if editable && editor && ocrWords.length}<button class="btn ghost" title="Pixelate every recognised word — for passwords, names and numbers in screenshots" onclick={hideText}>Hide text</button>{/if}
        {/snippet}
      </OcrPanel>
    {/key}
  {/if}
</div>
{/if}

<style>
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-soft);
    overflow-y: auto;
    flex: none;
  }
  .hsep {
    height: 1px;
    background: var(--border-soft);
    margin: 4px 2px;
  }
  .area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .area {
    background: var(--pasteboard);
  }
  /* The image itself carries the checkerboard and a 1 px edge, so its bounds
     stay visible against the pasteboard (sizes undo the zoom transform). */
  .checker {
    --cs: calc(10px / var(--z, 1));
    background-color: var(--checker-b);
    background-image: linear-gradient(45deg, var(--checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: calc(var(--cs) * 2) calc(var(--cs) * 2);
    background-position: 0 0, 0 var(--cs), var(--cs) calc(var(--cs) * -1), calc(var(--cs) * -1) 0;
    box-shadow: 0 0 0 calc(1px / var(--z, 1)) var(--canvas-edge), 0 calc(2px / var(--z, 1)) calc(14px / var(--z, 1)) rgba(0, 0, 0, 0.35);
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
  .busy {
    position: absolute;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--bg-elevated);
    box-shadow: var(--shadow);
    font-size: var(--fs-small);
  }
  .panel {
    width: 260px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border-soft);
    min-height: 0;
  }
  .ptabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--border-soft);
  }
  .ptabs button {
    border: none;
    background: transparent;
    padding: 6px 10px;
    border-radius: var(--radius) var(--radius) 0 0;
    cursor: pointer;
    color: var(--text-muted);
  }
  .ptabs button.on {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
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
  .custom {
    width: 24px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
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
  .num.sm {
    width: 64px;
  }
  .chk input {
    accent-color: var(--accent);
  }
  .font {
    max-width: 170px;
  }
  .b {
    font-weight: 700;
  }
  .i {
    font-style: italic;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .seg {
    display: inline-flex;
    background: var(--bg-hover);
    border-radius: 8px;
    padding: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .seg button.on {
    background: var(--bg-elevated);
    color: var(--text);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .opt input[type='range'] {
    width: 100px;
    accent-color: var(--accent);
  }
  .opt .v {
    min-width: 28px;
  }
  .hint {
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .angle input[type='range'] {
    width: 220px;
    accent-color: var(--accent);
  }
  .selbar {
    gap: 2px;
  }
  .chips {
    display: inline-flex;
    gap: 4px;
  }
  .chip {
    padding: 3px 10px;
    border: none;
    border-radius: 999px;
    background: var(--bg-hover);
    color: inherit;
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
