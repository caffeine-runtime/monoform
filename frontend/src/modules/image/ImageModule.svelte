<script lang="ts">
  import { isNarrow } from '../../core/fit';
  import ImageIco from '@lucide/svelte/icons/image';
  import { fitBar } from '../../core/fit';
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Hand from '@lucide/svelte/icons/hand';
  import Move from '@lucide/svelte/icons/move';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Rotate3d from '@lucide/svelte/icons/rotate-3d';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import Lasso from '@lucide/svelte/icons/lasso';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import Crop from '@lucide/svelte/icons/crop';
  import Ruler from '@lucide/svelte/icons/ruler';
  import HistoryIcon from '@lucide/svelte/icons/history';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import { RULER } from './editor';
  import { rulerSteps } from './guides';
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
  import Stamp from '@lucide/svelte/icons/stamp';
  import Bandage from '@lucide/svelte/icons/bandage';
  import Blend from '@lucide/svelte/icons/blend';
  import UserRoundSearch from '@lucide/svelte/icons/user-round-search';
  import Download from '@lucide/svelte/icons/download';
  import { flashAt, openSettingsAt } from '../../core/settingsLink';
  import Copy from '@lucide/svelte/icons/copy';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Trash from '@lucide/svelte/icons/trash-2';
  import PaintBucket from '@lucide/svelte/icons/paint-bucket';
  import Highlighter from '@lucide/svelte/icons/highlighter';
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
  import { num, t, tn } from '../../core/i18n';
  import { ImageEditor, SELECT_TOOLS, type EditorState, type Tool, type ToolOptions } from './editor';
  import { centered, fitZoom, keepAspect, stepZoom, zoomAt, clampZoom, type View } from './geometry';
  import { imageControllers, type MaskOp } from './editors';
  import * as raster from './raster';
  import * as selection from './selection';
  import type { ModifyOp } from './vision/selmodify';
  import { eraseRect } from './vision/erase';
  import { aiModels } from '../../core/aimodels.svelte';
  import { jobs } from '../../core/jobs.svelte';
  import type { SelectMode } from './selection';
  import { availableFonts, fontLabel } from './fonts';
  import { vision, type MaskResult } from './vision/vision';
  import { readOra, writeOra, blendToOra } from './ora';
  import { parseStyle as parseLayerStyle } from './styles';
  import type { WarpMode } from './warp';
  import LayersPanel from './LayersPanel.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
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
    ui.toast(tn('Pixelated {n} word. Undo with {shortcut}.', 'Pixelated {n} words. Undo with {shortcut}.', ocrWords.length, { shortcut: formatShortcut('Mod+Z') }), 'success');
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
  // Rulers, grid, guides and snapping: remembered between sessions.
  type Overlays = { rulers: boolean; grid: boolean; guides: boolean; snap: boolean; gridSize: number };
  let overlays = $state<Overlays>(loadOverlays());
  function loadOverlays(): Overlays {
    const d = { rulers: false, grid: false, guides: true, snap: true, gridSize: 0 };
    try {
      return { ...d, ...JSON.parse(localStorage.getItem('mf.image.overlays') ?? '{}') };
    } catch {
      return d;
    }
  }
  function setOverlays(o: Partial<Overlays>) {
    overlays = { ...overlays, ...o };
    try {
      localStorage.setItem('mf.image.overlays', JSON.stringify(overlays));
    } catch {
      /* private mode */
    }
    editor?.setOverlays({ grid: overlays.grid, gridSize: overlays.gridSize, guidesShown: overlays.guides, snap: overlays.snap, rulersShown: overlays.rulers });
  }
  async function askGridSize() {
    const v = await ui.prompt(t('Grid size in pixels (empty: automatic)'), overlays.gridSize ? String(overlays.gridSize) : '', t('Set'));
    if (v === null) return;
    const n = Math.round(Number(v));
    setOverlays({ gridSize: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 0, grid: true });
  }
  function viewMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Rulers'), checked: overlays.rulers, shortcut: formatShortcut('Mod+R'), run: () => setOverlays({ rulers: !overlays.rulers }) },
      { label: t('Guides'), checked: overlays.guides, shortcut: formatShortcut('Mod+;'), run: () => setOverlays({ guides: !overlays.guides }) },
      { label: t('Grid'), checked: overlays.grid, shortcut: formatShortcut("Mod+'"), run: () => setOverlays({ grid: !overlays.grid }) },
      { label: t('Snap'), checked: overlays.snap, shortcut: formatShortcut('Mod+Shift+;'), run: () => setOverlays({ snap: !overlays.snap }) },
      { separator: true },
      { label: overlays.gridSize ? t('Grid size: {n} px…', { n: String(overlays.gridSize) }) : t('Grid size: automatic…'), run: () => void askGridSize() },
      { label: t('Clear guides'), disabled: !editor?.guideList().length, run: () => editor?.clearGuides() },
    ]);
  }

  // The rulers: picture pixels along the top and left, a mark where the pointer is.
  let rulerTop = $state<HTMLCanvasElement>();
  let rulerLeft = $state<HTMLCanvasElement>();
  let pointerAt = $state<{ x: number; y: number } | null>(null);
  const showRulers = $derived(overlays.rulers && !!editor && !imgMode && !es?.viewRotation);

  function drawRulers() {
    if (!editor || !rulerTop || !rulerLeft) return;
    const ed = editor;
    const z = ed.view.zoom || 1;
    const { major, minor } = rulerSteps(z);
    const cs = getComputedStyle(rulerTop);
    const bg = cs.getPropertyValue('--bg-elevated').trim() || '#fff';
    const fg = cs.getPropertyValue('--text-muted').trim() || '#666';
    const line = cs.getPropertyValue('--border').trim() || '#ccc';
    const accent = cs.getPropertyValue('--accent').trim() || '#d97757';
    const dpr = window.devicePixelRatio || 1;
    for (const [c, horiz] of [
      [rulerTop, true],
      [rulerLeft, false],
    ] as const) {
      const box = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(box.width * dpr));
      c.height = Math.max(1, Math.round(box.height * dpr));
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = bg;
      g.fillRect(0, 0, box.width, box.height);
      g.fillStyle = line;
      if (horiz) g.fillRect(0, box.height - 1, box.width, 1);
      else g.fillRect(box.width - 1, 0, 1, box.height);
      // Picture coordinates at the ruler's two ends.
      const a = ed.toDoc(box.left, box.top);
      const b = ed.toDoc(box.right, box.bottom);
      const [from, to] = horiz ? [a.x, b.x] : [a.y, b.y];
      const at = (v: number) => (horiz ? ed.toScreen({ x: v, y: 0 }).x - box.left : ed.toScreen({ x: 0, y: v }).y - box.top);
      g.strokeStyle = fg;
      g.fillStyle = fg;
      g.lineWidth = 1;
      g.font = '9px Inter Variable, sans-serif';
      g.beginPath();
      for (let v = Math.floor(from / minor) * minor; v <= to; v += minor) {
        const p = Math.round(at(v)) + 0.5;
        const big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const len = big ? RULER - 4 : 5;
        if (horiz) {
          g.moveTo(p, RULER);
          g.lineTo(p, RULER - len);
        } else {
          g.moveTo(RULER, p);
          g.lineTo(RULER - len, p);
        }
        if (big) {
          const label = String(Math.round(v));
          if (horiz) g.fillText(label, p + 3, 9);
          else {
            g.save();
            g.translate(9, p - 3);
            g.rotate(-Math.PI / 2);
            g.fillText(label, 0, 0);
            g.restore();
          }
        }
      }
      g.stroke();
      if (pointerAt) {
        const p = Math.round(at(horiz ? pointerAt.x : pointerAt.y)) + 0.5;
        g.strokeStyle = accent;
        g.beginPath();
        if (horiz) {
          g.moveTo(p, 0);
          g.lineTo(p, RULER);
        } else {
          g.moveTo(0, p);
          g.lineTo(RULER, p);
        }
        g.stroke();
      }
    }
  }
  $effect(() => {
    if (!showRulers) return;
    void es;
    void bodyW;
    void pointerAt;
    const id = requestAnimationFrame(drawRulers);
    return () => cancelAnimationFrame(id);
  });

  /** Drag from a ruler onto the picture: a new guide (back onto the ruler: none). */
  function guideFromRuler(e: PointerEvent, axis: 'x' | 'y') {
    if (!editor || e.button !== 0) return;
    e.preventDefault();
    const ruler = e.currentTarget as HTMLElement;
    try {
      ruler.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const ed = editor;
    if (!overlays.guides) setOverlays({ guides: true });
    let id = 0;
    const move = (m: PointerEvent) => {
      const d = ed.toDoc(m.clientX, m.clientY);
      const pos = Math.round(axis === 'x' ? d.x : d.y);
      if (!id) id = ed.addGuide(axis, pos);
      else ed.moveGuide(id, pos);
    };
    const up = (u: PointerEvent) => {
      ruler.removeEventListener('pointermove', move);
      ruler.removeEventListener('pointerup', up);
      const r = ruler.getBoundingClientRect();
      if (id && u.clientX >= r.left && u.clientX <= r.right && u.clientY >= r.top && u.clientY <= r.bottom) ed.removeGuide(id);
    };
    ruler.addEventListener('pointermove', move);
    ruler.addEventListener('pointerup', up);
  }

  let canvasOpen = $state(false);
  let cw = $state(0);
  let ch = $state(0);
  /** Where the picture sits in the new canvas: 0, 0.5 or 1 each way. */
  let anchor = $state({ x: 0.5, y: 0.5 });
  let canvasFill = $state<'clear' | 'colour'>('clear');
  const WARPS: { id: WarpMode; label: string; help: string }[] = [
    { id: 'skew', label: t('Skew'), help: t('Drag the middle of a side to slant it along itself.') },
    { id: 'distort', label: t('Distort'), help: t('Drag any corner (or the middle of a side) anywhere.') },
    { id: 'perspective', label: t('Perspective'), help: t('Drag a corner: the one beside it moves the other way, as if the picture leaned back.') },
  ];
  const ANCHORS = [
    { x: 0, y: 0, label: t('[anchor] Top left') },
    { x: 0.5, y: 0, label: t('[anchor] Top') },
    { x: 1, y: 0, label: t('[anchor] Top right') },
    { x: 0, y: 0.5, label: t('[anchor] Left') },
    { x: 0.5, y: 0.5, label: t('Centre') },
    { x: 1, y: 0.5, label: t('[anchor] Right') },
    { x: 0, y: 1, label: t('[anchor] Bottom left') },
    { x: 0.5, y: 1, label: t('[anchor] Bottom') },
    { x: 1, y: 1, label: t('[anchor] Bottom right') },
  ];
  let rotateOpen = $state(false);
  /** What "Rotate by angle" turns: the whole picture, or the active layer. */
  let rotateLayer = $state(false);
  let angle = $state(0);
  let expand = $state(true);
  let siblings = $state<string[] | null>(null);
  let panel = $state<'layers' | 'adjust' | 'colours' | 'history' | null>(loadPanel());
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

  function loadPanel(): 'layers' | 'adjust' | 'colours' | 'history' | null {
    try {
      const v = localStorage.getItem('mf.image.panel');
      return v === 'none' ? null : v === 'adjust' || v === 'colours' || v === 'history' ? v : 'layers';
    } catch {
      return 'layers';
    }
  }
  /** Toolbar buttons toggle; commands and tabs just show. */
  function togglePanel(p: 'layers' | 'adjust' | 'colours' | 'history') {
    setPanel(panel === p ? null : p);
  }
  function setPanel(p: 'layers' | 'adjust' | 'colours' | 'history' | null) {
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
    if (!res.ok) throw new Error(t('could not read image ({status})', { status: String(res.status) }));
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
          tab.status = { ...tab.status, type: t('Animated {format}', { format: ext.toUpperCase() }), position: `${anim.width} × ${anim.height} px`, info: tn('{n} frame', '{n} frames', anim.frames.length) };
          return;
        } catch (e) {
          // Damaged frames that browsers still play: show it animating, without frame editing.
          imgMode = true;
          src = url;
          ui.toast(t("Frames can't be edited: {error}", { error: String((e as Error)?.message ?? e) }), 'warning');
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
              return { ...l, canvas: raw ?? l.canvas, mask: raw && mask ? mask : null, maskOn: o.mask?.on ?? true, style: parseLayerStyle(o.style) };
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
    editor.askText = (initial) => ui.prompt(initial ? t('Edit text') : t('Add text'), initial, initial ? t('Update') : t('Add'));
    editor.onChange = (s) => {
      es = s;
      if (opts && opts.maskHide !== editor!.opts.maskHide) opts.maskHide = editor!.opts.maskHide;
      tab.dirty = s.dirty;
      updateStatus();
    };
    editor.onPick = (t, x, y, mode) => (t === 'picker' ? pickAt(x, y) : void (t === 'fill' ? fillAt(x, y) : t === 'wand' ? wandAt(x, y, mode) : objectAt(x, y, mode)));
    editor.notify = (msg) => ui.toast(msg);
    editor.setOverlays({ grid: overlays.grid, gridSize: overlays.gridSize, guidesShown: overlays.guides, snap: overlays.snap, rulersShown: overlays.rulers });
    editor.onHeal = async (crop, mask) => {
      const slow = setTimeout(() => (busy = t('Healing…')), 300);
      try {
        return await vision.heal(crop, mask);
      } catch (e) {
        toastError(e);
        return null;
      } finally {
        clearTimeout(slow);
        busy = '';
      }
    };
    editor.onPainted = (s) =>
      void vision
        .edges(s.mask)
        .then((r) => {
          r.mask.close();
          editor?.setSelectionEdges(s, { canvas: r.edges, scale: r.edgeScale });
        })
        .catch(() => {});
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

  // A colour asked for by a panel (Adjust › Clean up): the next picker click answers it.
  let pickWanted: ((hex: string | null) => void) | null = null;
  function pickForPanel(): Promise<string | null> {
    pickWanted?.(null);
    const prev = tool === 'picker' ? 'hand' : tool;
    setTool('picker');
    ui.toast(t('Click the colour to remove in the image.'), 'info');
    return new Promise((resolve) => {
      pickWanted = (hex) => {
        pickWanted = null;
        if (tool === 'picker') setTool(prev);
        resolve(hex);
      };
    });
  }

  /** The colour of the visible image at a document point. */
  function pickAt(x: number, y: number) {
    if (!editor) return;
    if (pickWanted) {
      // The layer's own pixels, not a clean-up preview of them.
      const b = editor.base;
      const d = b.getContext('2d')!.getImageData(Math.min(b.width - 1, Math.max(0, Math.floor(x))), Math.min(b.height - 1, Math.max(0, Math.floor(y))), 1, 1).data;
      pickWanted('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
      return;
    }
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
    const ps = es?.pixelSelection;
    const format = ext.toUpperCase();
    const pct = `${Math.round(zoom * 100)}`;
    tab.status = {
      ...tab.status,
      type: isSvg ? t('SVG image (view-only)') : ext === 'ora' ? t('OpenRaster image') : viaSystem ? t('{format} image (decoded by {tool})', { format, tool: viaSystem }) : t('{format} image', { format }),
      position: !w ? undefined : ps ? t('{w} × {h} px · selection {sw} × {sh}', { w: String(w), h: String(h), sw: String(ps.width), sh: String(ps.height) }) : `${w} × ${h} px`,
      info: es && es.layers.length > 1 ? tn('{zoom}% · {n} layer', '{zoom}% · {n} layers', es.layers.length, { zoom: pct }) : `${pct}%`,
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
      toastError(e, t('Magic wand failed'));
    }
  }

  /** Paint bucket: flood-fill the clicked colour area of the active layer (the wand's fill, off the main thread). */
  async function fillAt(x: number, y: number) {
    if (!editor || x < 0 || y < 0 || x >= editor.width || y >= editor.height) return;
    try {
      const r = await vision.wand(editor.base, x, y, editor.opts.wandTolerance, editor.opts.wandContiguous);
      r.edges?.close();
      editor.bucketFill(maskCanvas(r));
    } catch (e) {
      toastError(e, t('Fill failed'));
    }
  }

  /** The Adjust panel at one of its pages (Blur and Pixelate start at a visible strength). */
  async function openAdjust(page: 'blur' | 'pixelate' | 'cleanup') {
    if (panel !== 'adjust') setPanel('adjust');
    await tick();
    adjustPanel?.open(page, page !== 'cleanup');
  }

  /** Image › Remove a watermark: the Adjust panel's Clean up, highlighted (on a photo, the AI removal is the better tool). */
  async function openCleanup() {
    await openAdjust('cleanup');
    await flashAt(`.tabview[data-tab-id="${tab.id}"] .adjust .cleanup`);
  }

  /** Make sure the object model has seen the current image. */
  /** The analysis under way (choosing the tool starts it; a click meanwhile waits for it). */
  let analysing: { key: string; done: Promise<string | null> } | null = null;

  function analyse(): Promise<string | null> {
    if (!editor) return Promise.resolve(null);
    const key = `${tab.id}:${editor.state().version}`;
    if (vision.samKey === key) return Promise.resolve(key);
    if (analysing?.key === key) return analysing.done;
    objectPoints = [];
    const src = editor.composite();
    const done = (async () => {
      busy = t('Analysing the image to find objects… (once per image)');
      try {
        await vision.analyse(src, key);
        return key;
      } catch (e) {
        toastError(e, t('Object selection failed'));
        return null;
      } finally {
        busy = '';
        if (analysing?.key === key) analysing = null;
      }
    })();
    analysing = { key, done };
    return done;
  }

  async function objectAt(x: number, y: number, mode: SelectMode) {
    if (!editor || x < 0 || y < 0 || x >= editor.width || y >= editor.height) return;
    const key = await analyse();
    if (!key) return;
    if (mode === 'replace') objectPoints = [];
    objectPoints.push({ x, y, positive: mode !== 'subtract' });
    const slow = setTimeout(() => (busy = t('Finding the object’s edges…')), 300);
    try {
      const r = await vision.selectObject(key, objectPoints);
      editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), 'replace');
    } catch (e) {
      toastError(e, t('Object selection failed'));
    } finally {
      clearTimeout(slow);
      busy = '';
    }
  }

  let subjectTipShown = false;
  /**
   * The main subject's mask: with the optional BiRefNet model (much better on
   * people and hair) when `precise`, else the bundled U²-Netp.
   */
  async function subjectMask(precise = !!aiModels.pack('subject')?.installed): Promise<MaskResult | null> {
    if (!editor) return null;
    busy = t('Finding the subject…');
    try {
      if (precise && (await aiModels.installed('subject'))) return await vision.subjectAI(editor.base, endpoint('ai'));
      if (!subjectTipShown && aiModels.pack('subject')?.supported && !aiModels.pack('subject')?.installed) {
        subjectTipShown = true;
        ui.toast(t('Not precise enough? A better subject finder is an optional download.'), 'info', { label: t('Get it'), run: () => void openSettingsAt('.pack[data-pack="subject"]') }, 8000);
      }
      return await vision.removeBackground(editor.base);
    } catch (e) {
      toastError(e, t('Background removal failed'));
      return null;
    } finally {
      busy = '';
    }
  }

  /**
   * Remove background. 'auto': a plain (one-colour) background is made
   * transparent by colour, keeping thin lines and soft edges; anything else
   * goes to the subject model. 'plain' and 'ai' force one way.
   * `everywhere`: also closed areas of the colour (decided from the picture when not given).
   */
  async function removeBackground(how: 'auto' | 'plain' | 'ai' = 'auto', everywhere: boolean | 'auto' = 'auto') {
    if (!editor || busy) return;
    if (how !== 'ai') {
      busy = t('Removing the background…');
      let r;
      try {
        r = await vision.plainBackground(editor.base, everywhere, how === 'plain');
      } catch (e) {
        toastError(e, t('Background removal failed'));
        return;
      } finally {
        busy = '';
      }
      if (r.image) {
        editor.replacePixels(r.image, t('Remove background'));
        r.image.close();
        const v = editor.state().version;
        const redo = (all: boolean) => () => {
          if (editor?.state().version !== v) return;
          editor.undo();
          void removeBackground('plain', all);
        };
        ui.toast(
          r.everywhere ? t('Plain background removed, also inside closed shapes. Save as PNG or WebP to keep the transparency.') : t('Plain background removed around the subject. Save as PNG or WebP to keep the transparency.'),
          'success',
          r.everywhere ? { label: t('Keep closed areas'), run: redo(false) } : { label: t('Also inside closed shapes'), run: redo(true) },
          8000,
        );
        return;
      }
      if (how === 'plain') return;
    }
    const r = await subjectMask();
    if (!r || !editor) return;
    r.edges.close();
    editor.applyMaskToLayer(maskCanvas(r));
    ui.toast(t('Background removed — save as PNG or WebP to keep the transparency.'), 'success');
  }

  /** Select subject (Select object's toolbar): the bundled model; the AI tool below Select object uses the downloaded one. */
  async function selectSubject(precise = false) {
    const r = await subjectMask(precise);
    if (!r || !editor) return;
    editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), editor.selectMode);
  }

  /** Remove what's selected and fill the gap (optional Moebius model). */
  async function removeObject() {
    if (!editor || busy) return;
    const s = editor.selection;
    if (!s) {
      ui.toast(t('Select what to remove first — lasso around it, or click it with Select object.'), 'info');
      return;
    }
    if (!(await aiModels.installed('eraser')) && !(await aiModels.install('eraser'))) return;
    const rect = eraseRect(s.bounds, editor.width, editor.height);
    busy = t('Removing the object…');
    try {
      const started = await vision.eraseBegin(editor.composite(), s.mask, rect, endpoint('ai'), Math.floor(Math.random() * 2 ** 31));
      const done = await jobs.run(t('Removing the object'), () => Promise.resolve(started.job));
      if (done.cancelled) return;
      if (done.error) throw new Error(done.error);
      const { patch } = await vision.eraseFinish(started, endpoint('ai'));
      editor.paintPatch(patch, rect.x, rect.y);
      patch.close();
      editor.deselect();
      ui.toast(t('Removed. Not right? Undo and run it again for a different fill.'), 'success');
    } catch (e) {
      toastError(e, t('Object removal failed'));
    } finally {
      busy = '';
    }
  }

  /** Select › Modify: how much is asked for each, and the last amount used. */
  const MODIFY: { op: ModifyOp; label: string; ask: string; amount: number }[] = [
    { op: 'feather', label: t('Feather…'), ask: t('Feather radius (pixels)'), amount: 8 },
    { op: 'expand', label: t('Expand…'), ask: t('Expand by (pixels)'), amount: 4 },
    { op: 'contract', label: t('Contract…'), ask: t('Contract by (pixels)'), amount: 4 },
    { op: 'smooth', label: t('Smooth…'), ask: t('Smooth radius (pixels)'), amount: 4 },
    { op: 'border', label: t('Border…'), ask: t('Border width (pixels)'), amount: 8 },
  ];

  async function modifySelection(op: ModifyOp, amount?: number) {
    if (!editor?.selection) return;
    const m = MODIFY.find((x) => x.op === op)!;
    if (amount === undefined) {
      const v = await ui.prompt(m.ask, String(m.amount), t('Apply'));
      if (v === null) return;
      amount = parseFloat(v.replace(',', '.'));
    }
    if (!(amount > 0 && amount <= 500)) {
      ui.toast(t('Enter a number of pixels from 1 to 500.'), 'error');
      return;
    }
    m.amount = amount;
    const sel0 = editor.selection;
    const slow = setTimeout(() => (busy = t('Changing the selection…')), 300);
    try {
      const r = await vision.modify(sel0.mask, op, amount);
      if (editor.selection !== sel0) return r.mask.close(); // changed meanwhile
      editor.setPixelSelection(selection.fromMask(maskCanvas(r), r.bounds, { canvas: r.edges, scale: r.edgeScale }), 'replace');
      if (!editor.selection) ui.toast(t('Nothing is left selected.'));
    } catch (e) {
      toastError(e);
    } finally {
      clearTimeout(slow);
      busy = '';
    }
  }

  function modifyMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, MODIFY.map((m) => ({ label: m.label, run: () => void modifySelection(m.op) })));
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
    void copyTransfer({ kind: 'image', image: canvas, name: editor.selection ? t('{name} (part)', { name: stem(tab.title) }) : stem(tab.title) });
    if (cut) editor.clearSelectionPixels();
    ui.toast(cut ? t('Cut {w} × {h} px', { w: String(canvas.width), h: String(canvas.height) }) : t('Copied {w} × {h} px', { w: String(canvas.width), h: String(canvas.height) }), 'success');
  }

  async function paste() {
    if (!editor) return;
    const tr = await readTransfer();
    if (!tr) return ui.toast(t('The clipboard is empty.'), 'info');
    if (tr.kind === 'image') {
      // Our own copy goes back where it came from.
      const same = clip && clip.canvas.width === tr.image.width && clip.canvas.height === tr.image.height && Date.now() - clip.at < 10 * 60_000;
      editor.pasteImage(tr.image, same ? { x: clip!.x, y: clip!.y } : undefined, tr.name || t('Pasted'));
    } else await take(tr);
  }

  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];

  /** The selection, or the picture as it looks, for another tab (a drag, Ctrl+C elsewhere). */
  function giveImage(): Transfer | null {
    if (!editor) return null;
    const { canvas } = editor.copySelection(true);
    return { kind: 'image', image: canvas, name: editor.selection ? t('{name} (part)', { name: stem(tab.title) }) : stem(tab.title) };
  }

  /** From another tab: a picture becomes a layer, text a text object, image files layers — at the drop point. */
  async function take(tr: Transfer, at?: { x: number; y: number }): Promise<boolean> {
    if (!editor || !editable) return false;
    const p = at ? editor.docPoint(at.x, at.y) : undefined;
    const centred = (c: HTMLCanvasElement) => (p ? { x: Math.round(p.x - c.width / 2), y: Math.round(p.y - c.height / 2) } : undefined);
    if (tr.kind === 'image') editor.pasteImage(tr.image, centred(tr.image), tr.name || t('Pasted'));
    else if (tr.kind === 'text') await editor.addText(p ?? { x: Math.round(editor.width / 8), y: Math.round(editor.height / 8) }, tr.text.trim().slice(0, 2000));
    else {
      const imgs = tr.paths.filter((x) => IMAGE_EXT.includes(extname(x)));
      if (!imgs.length) {
        ui.toast(t('Only pictures can be added as layers.'), 'info');
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
    apply: () => (es?.transforming ? editor?.finishTransform(true) : es?.warping ? editor?.finishWarp(true) : editor?.applyRegion()),
    escape: () => {
      if (es?.transforming) editor?.finishTransform(false);
      else if (es?.warping) editor?.finishWarp(false);
      else if (resizeOpen) resizeOpen = false;
      else if (canvasOpen) canvasOpen = false;
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
    canvasSize: () => openCanvasSize(),
    overlay: (k: 'rulers' | 'grid' | 'guides' | 'snap') => setOverlays({ [k]: !overlays[k] }),
    clearGuides: () => editor?.clearGuides(),
    warp: (m: WarpMode) => {
      if (tool !== 'move') setTool('move');
      editor?.startWarp(m);
    },
    perspectiveCrop: () => {
      if (tool !== 'crop') setTool('crop');
      editor?.startPerspectiveCrop();
    },
    rotateAngle: () => openRotate(),
    transformSelection: () => editor?.transformSelection(),
    rotateLayer: (deg: number) => editor?.rotateLayer(deg),
    rotateLayerAngle: () => openRotate(true),
    rotateView: (deg: number, reset = false) => editor?.rotateView(deg, reset),
    copy: (merged: boolean) => copy(false, merged),
    cut: () => copy(true),
    paste: () => void paste(),
    selectAll: () => editor?.selectAll(),
    deselect: () => editor?.deselect(),
    invert: () => void invertSelection(),
    modifySelection: (op: ModifyOp) => void modifySelection(op),
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
    openCleanup: () => void openCleanup(),
    selectSubject: () => void selectSubject(),
    removeObject: () => void removeObject(),
    saveCopy: () => void saveCopy(),
    saveLayers: () => void saveWithLayers(),
    panel: (p: 'layers' | 'adjust' | 'colours' | 'history') => setPanel(p),
    picked: () => picked,
    editable: () => editable,
  };
  imageControllers.set(tab.id, ctl);

  function setTool(next: Tool) {
    if (!editable && next !== 'hand') return;
    if (pickWanted && next !== 'picker') pickWanted(null);
    tool = next;
    editor?.setTool(next);
    if (next === 'text' && !fonts.length) fonts = availableFonts();
    // The image is analysed while the pointer travels to the object.
    if (next === 'object') void analyse();
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
      ui.toast(t('Editing a GIF keeps only its first frame.'), 'info');
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
    canvasOpen = false;
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

  function openCanvasSize() {
    if (!editor) return;
    resizeOpen = false;
    cw = editor.width;
    ch = editor.height;
    anchor = { x: 0.5, y: 0.5 };
    canvasOpen = true;
  }
  function applyCanvasSize() {
    if (!editor || cw < 1 || ch < 1 || cw > 20000 || ch > 20000) return;
    editor.canvasSize(cw, ch, anchor, canvasFill === 'colour' ? editor.opts.color : null);
    canvasOpen = false;
  }

  function openRotate(layer = false) {
    if (!editor) return;
    angle = 0;
    rotateLayer = layer;
    rotateOpen = true;
  }
  function previewAngle() {
    if (rotateLayer) editor?.previewLayerRotation(angle);
    else editor?.previewRotation(angle);
  }
  function applyRotate() {
    if (!editor) return;
    rotateOpen = false;
    if (rotateLayer) editor.endLayerRotation(true);
    else editor.rotateBy(angle, expand);
  }
  function cancelRotate() {
    rotateOpen = false;
    if (rotateLayer) editor?.endLayerRotation(false);
    else editor?.previewRotation(0);
  }

  // ---- folder navigation ----
  async function navigate(dir: 1 | -1) {
    const p = tab.filePath;
    if (!p) return;
    if (tab.dirty && !(await ui.confirm(t('Discard changes?'), t('{name} has unsaved edits.', { name: tab.title }), t('Discard'), true))) return;
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
          style: l.style ? JSON.stringify(l.style) : undefined,
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
    editor.finishTransform(true); // a lifted selection goes back into its layer first
    let format = extname(path);
    if (!SAVE_FORMATS.includes(format)) {
      ui.toast(t("Can't save .{ext}. Choose PNG, JPEG, WebP, GIF, BMP, ICO, ICNS or ORA.", { ext: format }), 'warning');
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
      ui.toast(t('Layers were merged into the saved image. Use “Save with layers (.ora)” to keep them editable.'), 'info');
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
      ui.toast(t('Saved a copy: {name} (the original is unchanged)', { name: basename(target) }), 'success');
    }
    return ok;
  }

  async function save(): Promise<boolean> {
    if (anim) return animEd?.save() ?? false;
    if (icons) return false;
    if (isSvg) {
      ui.toast(t('SVG files are view-only.'), 'info');
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
      ui.toast(isSvg ? t('SVG files are view-only.') : t('Start editing to save a copy.'), 'info');
      return false;
    }
    const base = tab.filePath ?? join(dirname(tab.path ?? ''), tab.title);
    const path = await api.SaveFileDialog(t('Save image as'), base, [
      { name: 'PNG', patterns: '*.png' },
      { name: 'JPEG', patterns: '*.jpg;*.jpeg' },
      { name: t('WebP (lossless)'), patterns: '*.webp' },
      { name: 'GIF', patterns: '*.gif' },
      { name: 'BMP', patterns: '*.bmp' },
      { name: t('Windows icon (all sizes)'), patterns: '*.ico' },
      { name: t('macOS icon (all sizes)'), patterns: '*.icns' },
      { name: t('OpenRaster with layers'), patterns: '*.ora' },
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
    const path = await api.SaveFileDialog(t('Save with layers'), base, [{ name: 'OpenRaster (GIMP, Krita, MyPaint)', patterns: '*.ora' }]); // i18n-ignore: format and app names
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
      { label: t('Rotate left'), shortcut: '[', run: () => ed.rotate(false) },
      { label: t('Rotate right'), shortcut: ']', run: () => ed.rotate(true) },
      { label: t('Rotate by angle…'), shortcut: formatShortcut('Mod+Alt+R'), run: () => openRotate() },
      { label: t('Flip horizontally'), shortcut: 'Shift+H', run: () => ed.flip(true) },
      { label: t('Flip vertically'), shortcut: 'Shift+V', run: () => ed.flip(false) },
      { label: t('Resize…'), shortcut: formatShortcut('Mod+Alt+I'), run: () => openResize() },
      { label: t('Canvas size…'), shortcut: formatShortcut('Mod+Alt+C'), run: () => openCanvasSize() },
      { label: t('Perspective crop…'), run: () => ctl.perspectiveCrop() },
      { label: t('Skew…'), run: () => ctl.warp('skew') },
      { label: t('Distort…'), run: () => ctl.warp('distort') },
      { label: t('Perspective…'), run: () => ctl.warp('perspective') },
      { separator: true },
      { label: t('Remove a watermark…'), run: () => void openCleanup() },
      { label: t('Remove background'), run: () => void removeBackground() },
      { label: t('Remove a plain background (one colour)'), run: () => void removeBackground('plain') },
      { label: t('Remove background (add-on)'), run: () => void removeBackground('ai') },
      { label: t('Select subject'), run: () => void selectSubject(!!aiModels.pack('subject')?.installed) },
      { label: t('Remove object (fill the gap)'), disabled: !es?.pixelSelection, run: () => void removeObject() },
      { separator: true },
      { label: t('New layer'), shortcut: formatShortcut('Mod+Shift+N'), run: () => ed.addLayer() },
      { label: t('Flatten image'), run: () => ed.flatten() },
    ]);
  }

  function saveMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Save'), shortcut: formatShortcut('Mod+S'), run: () => void save() },
      { label: t('Save a copy (keep original)'), shortcut: formatShortcut('Mod+Alt+S'), run: () => void saveCopy() },
      { label: t('Save as…'), shortcut: formatShortcut('Mod+Shift+S'), run: () => void saveAs() },
      { label: t('Save with layers (.ora)…'), run: () => void saveWithLayers() },
      { separator: true },
      { label: settings.value.imageKeepOriginal ? `✓ ${t('Always keep originals')}` : t('Always keep originals'), run: () => settings.update((s) => (s.imageKeepOriginal = !s.imageKeepOriginal)) },
    ]);
  }

  onMount(() => {
    if (!aiModels.packs.length) void aiModels.refresh();
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
    fillAt,
    objectAt,
    removeBackground,
    openCleanup,
    selectSubject,
    removeObject,
    copy,
    paste,
    saveCopy,
    adjust: () => adjustPanel,
    setPanel,
    openAdjust,
    modifySelection,
    setOverlays,
    busy: () => busy,
    fonts: () => availableFonts(),
    tool: () => tool,
    setTool: (t: Tool) => setTool(t),
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
      { id: 'hand', icon: Hand, label: t('Hand'), help: t('Drag to pan the view; click an arrow, shape or text to select and edit it. Scroll to zoom.'), key: 'H' },
      { id: 'move', icon: Move, label: t('Move layer'), help: t('Drag to move the active layer; drag the handles to scale or rotate it.'), key: 'V' },
    ],
    [
      { id: 'select', icon: SquareDashed, label: t('Rectangle select'), help: t('Drag to select a rectangle. Hold Ctrl for a square, Shift to add, Alt to subtract. Drag inside a selection to move it; its handles resize and turn it.'), key: 'M' },
      { id: 'ellipse', icon: CircleDashed, label: t('Ellipse select'), help: t('Drag to select an ellipse. Hold Ctrl for a circle, Shift to add, Alt to subtract. Drag inside a selection to move it; its handles resize and turn it.') },
      { id: 'lasso', icon: Lasso, label: t('Lasso select'), help: t('Drag around an area to select it freehand. Shift adds, Alt subtracts. Drag inside a selection to move it; its handles resize and turn it.'), key: 'L' },
      { id: 'selbrush', icon: Highlighter, label: t('Selection brush'), help: t('Paint over what to select — e.g. a watermark on a photo, then Remove object (add-on) fills it in. Each stroke adds; Alt-drag takes away. Set the size in the toolbar.') },
      { id: 'wand', icon: Wand, label: t('Magic wand'), help: t('Click to select pixels of a similar colour. Set Tolerance in the toolbar; Shift adds, Alt subtracts.'), key: 'W' },
      { id: 'object', icon: ScanEye, label: t('Select object'), help: t('Click an object to select it, with edges snapped to the pixels. Shift-click adds, Alt-click excludes a part.'), key: 'O' },
    ],
    [
      { id: 'crop', icon: Crop, label: t('Crop'), help: t('Drag the area to keep (Ctrl for a square), adjust the handles, then press Enter.'), key: 'C' },
      { id: 'straighten', icon: Ruler, label: t('Straighten'), help: t('Drag along something that should be level (a horizon, a shelf) or upright: the picture turns to match.') },
    ],
    [
      { id: 'brush', icon: Brush, label: t('Brush'), help: t('Drag to paint on the active layer. Set size, opacity and colour in the toolbar.'), key: 'B' },
      { id: 'eraser', icon: Eraser, label: t('Eraser'), help: t('Drag to erase the active layer to transparency.'), key: 'E' },
      { id: 'clone', icon: Stamp, label: t('Clone stamp'), help: t('Alt-click where to copy from, then paint where it should go. The source follows the brush.'), key: 'S' },
      { id: 'heal', icon: Bandage, label: t('Spot healing brush'), help: t('Paint over a spot, a blemish or a small object: it is replaced from nearby, matched to the light around it.'), key: 'J' },
      { id: 'gradient', icon: Blend, label: t('Gradient'), help: t('Drag from where the colour starts to where it has faded (Shift: in 45° steps). Linear or radial in the toolbar; on a layer mask it fades the layer out.'), key: 'Shift+G' },
      { id: 'fill', icon: PaintBucket, label: t('Paint bucket'), help: t('Click to fill an area of similar colour on the active layer (only inside the selection, if there is one). Set Tolerance in the toolbar.'), key: 'G' },
    ],
    [
      { id: 'picker', icon: Pipette, label: t('Colour picker'), help: t('Click the image to pick a colour: see it as HEX/RGB/HSL in Colours, copy it or use it to draw.'), key: 'I' },
      { id: 'text', icon: Type, label: t('Text'), help: t('Click where the text should go and type it. Double-click text later to edit it.'), key: 'T' },
      { id: 'arrow', icon: MoveUpRight, label: t('Arrow'), help: t('Drag from the tail to the tip to draw an arrow.'), key: 'A' },
      { id: 'rect', icon: Square, label: t('Rectangle'), help: t('Drag to draw a rectangle. Hold Ctrl (or Shift) for a square; set Corners in the toolbar for rounded or sharp corners.'), key: 'R' },
      { id: 'oval', icon: CircleIcon, label: t('Ellipse'), help: t('Drag to draw an ellipse. Hold Ctrl (or Shift) for a circle.') },
    ],
    [
      { id: 'blur', icon: Droplets, label: t('Blur region'), help: t('Drag over an area (faces, plates…), adjust it, then press Enter to blur it.'), key: 'U' },
      { id: 'pixelate', icon: Grid, label: t('Pixelate region'), help: t('Drag over an area, adjust it, then press Enter to pixelate it.'), key: 'P' },
    ],
  ];
  // Tools that use the optional models (Settings › Add-ons), below Select
  // object. Until their model is downloaded they show greyed out and lead to
  // the download in Settings.
  type AITool = { pack: string; icon: any; label: string; help: string; run: () => void };
  const aiTools: AITool[] = [
    {
      pack: 'subject',
      icon: UserRoundSearch,
      label: t('Select subject (add-on)'),
      help: t('Selects the main subject — people, hair, objects — precisely, with the downloaded model. Shift adds, Alt subtracts.'),
      run: () => void selectSubjectAI(),
    },
    {
      pack: 'eraser',
      icon: Eraser2,
      label: t('Remove object (add-on)'),
      help: t('Removes the selected object and fills the gap with what could be behind it. Select it first, e.g. by clicking it with Select object.'),
      run: () => void removeObjectAI(),
    },
  ];
  const aiReady = (pack: string) => !!aiModels.pack(pack)?.installed;
  function aiToolTitle(a: AITool): string {
    if (aiReady(a.pack)) return `${a.label} — ${a.help}`;
    const p = aiModels.pack(a.pack);
    if (p && !p.supported) return `${a.label} — ${t('Not available on this system')}`;
    return `${a.label} — ${t('Needs an optional download: click to get it in Settings › Add-ons.')}`;
  }
  function aiToolClick(a: AITool) {
    if (aiReady(a.pack)) a.run();
    else void openSettingsAt(`.pack[data-pack="${a.pack}"]`);
  }
  async function selectSubjectAI() {
    setTool('object'); // add or exclude parts by clicking afterwards
    await selectSubject(true);
  }
  async function removeObjectAI() {
    if (!editor?.selection) {
      setTool('object');
      ui.toast(t('Click the object to remove (Shift-click adds a part), then press Remove object (add-on) again.'), 'info', undefined, 6000);
      return;
    }
    await removeObject();
  }

  const shapeTool = $derived(['arrow', 'rect', 'oval'].includes(tool));
  const obj = $derived(es?.object ?? null);
</script>

<div class="toolbar" use:fitBar>
  {#if editable && opts}
    <!-- Contextual options for the current tool / selected object -->
    {#if obj?.kind === 'text'}
      <select class="font" value={obj.fontFamily} onfocus={() => (fonts = fonts.length ? fonts : availableFonts())} onchange={(e) => editor?.updateObject({ fontFamily: (e.target as HTMLSelectElement).value })} title={t('Font')}>
        {#each fonts.length ? fonts : [obj.fontFamily ?? 'Inter Variable'] as f (f)}<option value={f} style:font-family={f}>{fontLabel(f)}</option>{/each}
      </select>
      <input class="input num sm" type="number" min="4" max="2000" value={obj.fontSize} title={t('Size')} onchange={(e) => editor?.updateObject({ fontSize: +(e.target as HTMLInputElement).value })} />
      <button class="btn ghost b" class:on={obj.bold} title={t('Bold')} onclick={() => editor?.updateObject({ bold: !obj.bold })}>B</button>
      <button class="btn ghost i" class:on={obj.italic} title={t('Italic')} onclick={() => editor?.updateObject({ italic: !obj.italic })}>I</button>
      <button class="btn ghost" class:on={obj.outline} title={t('Outline', {}, 'text effect')} onclick={() => editor?.updateObject({ outline: !obj.outline })}>{t('Outline', {}, 'text effect')}</button>
      <button class="btn ghost" class:on={obj.shadow} title={t('Shadow')} onclick={() => editor?.updateObject({ shadow: !obj.shadow })}>{t('Shadow')}</button>
      <button class="btn ghost" title={t('Edit text')} onclick={async () => {
        const txt = await ui.prompt(t('Edit text'), obj.text ?? '', t('Update'));
        if (txt) editor?.updateObject({ text: txt });
      }}><Icon icon={Pencil} size={14} /></button>
      <span class="sep"></span>
    {:else if tool === 'text'}
      <select class="font" value={opts.fontFamily} onchange={(e) => setOpt('fontFamily', (e.target as HTMLSelectElement).value)} title={t('Font')}>
        {#each fonts as f (f)}<option value={f} style:font-family={f}>{fontLabel(f)}</option>{/each}
      </select>
      <input class="input num sm" type="number" min="0" max="2000" value={opts.fontSize || ''} placeholder={t('auto')} title={t('Size (empty = automatic)')} onchange={(e) => setOpt('fontSize', +(e.target as HTMLInputElement).value || 0)} />
      <button class="btn ghost b" class:on={opts.bold} title={t('Bold')} onclick={() => setOpt('bold', !opts!.bold)}>B</button>
      <button class="btn ghost i" class:on={opts.italic} title={t('Italic')} onclick={() => setOpt('italic', !opts!.italic)}>I</button>
      <button class="btn ghost" class:on={opts.outline} title={t('Outline around the letters')} onclick={() => setOpt('outline', !opts!.outline)}>{t('Outline', {}, 'text effect')}</button>
      <button class="btn ghost" class:on={opts.shadow} title={t('Soft shadow behind the text')} onclick={() => setOpt('shadow', !opts!.shadow)}>{t('Shadow')}</button>
      <span class="sep"></span>
    {:else if tool === 'crop' && !es?.warping}
      <button class="btn ghost" title={t('Drag four corners onto something photographed at an angle (a page, a sign, a screen); it is cropped out and made a rectangle')} onclick={() => editor?.startPerspectiveCrop()}>{t('Perspective crop…')}</button>
      <span class="sep"></span>
    {:else if tool === 'straighten'}
      <span class="hint">{t('Drag along a line that should be level or upright')}</span>
      <label class="opt chk" title={t('Cut off the empty corners the turn leaves; otherwise the canvas grows to fit')}><input type="checkbox" checked={opts.straightenCrop} onchange={(e) => setOpt('straightenCrop', (e.target as HTMLInputElement).checked)} /> {t('Crop the corners')}</label>
      <span class="sep"></span>
    {:else if tool === 'move' && !es?.transforming && !es?.warping}
      <span class="hint">{t('Drag to move · handles scale · round handle rotates')}</span>
      <button class="btn ghost" title={t('Rotate the layer 90° counter-clockwise')} onclick={() => editor?.rotateLayer(-90)}><Icon icon={RotateCcw} size={14} /> 90°</button>
      <button class="btn ghost" title={t('Rotate the layer 90° clockwise')} onclick={() => editor?.rotateLayer(90)}><Icon icon={RotateCw} size={14} /> 90°</button>
      <button class="btn ghost" title={t('Rotate the layer by an angle')} onclick={() => openRotate(true)}>{t('Angle…')}</button>
      <span class="sep"></span>
      {#each WARPS as w (w.id)}<button class="btn ghost" title={w.help} onclick={() => editor?.startWarp(w.id)}>{w.label}</button>{/each}
      <span class="sep"></span>
    {:else if tool === 'blur'}
      <label class="opt" title={t('How strongly the area is blurred (shown in it before you apply)')}>{t('Strength')} <input class="region-strength" type="range" min="0.25" max="3" step="0.05" value={opts.regionBlur} oninput={(e) => setOpt('regionBlur', +(e.target as HTMLInputElement).value)} /><span class="v">{Math.round(opts.regionBlur * 100)}%</span></label>
      <span class="sep"></span>
    {:else if tool === 'pixelate'}
      <label class="opt" title={t('Size of the squares (shown in the area before you apply)')}>{t('Block size')} <input class="region-strength" type="range" min="2" max="100" step="1" value={opts.pixelSize || Math.max(6, Math.round(Math.max(es?.width ?? 0, es?.height ?? 0) / 80))} oninput={(e) => setOpt('pixelSize', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.pixelSize || Math.max(6, Math.round(Math.max(es?.width ?? 0, es?.height ?? 0) / 80))} px</span></label>
      <span class="sep"></span>
    {:else if tool === 'selbrush'}
      <label class="opt">{t('Size')} <input type="range" min="2" max="300" value={opts.brushSize || 24} oninput={(e) => setOpt('brushSize', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.brushSize || 24}</span></label>
      <span class="hint">{t('Paint to add · Alt-drag to take away')}</span>
      {#if es?.pixelSelection}<button class="btn ghost" title={t('Remove what is selected and fill the gap (optional add-on)')} onclick={() => void removeObject()}><Icon icon={Sparkles} size={14} /> {t('Remove object (add-on)')}</button>{/if}
      <span class="sep"></span>
    {:else if SELECT_TOOLS.includes(tool)}
      <div class="seg" role="radiogroup" aria-label={t('Selection mode')}>
        {#each [['replace', t('New', {}, 'selection'), t('New selection')], ['add', t('Add', {}, 'selection'), t('Add to the selection (or hold Shift)')], ['subtract', t('Subtract'), t('Subtract from the selection (or hold Alt)')]] as [m, l, h] (m)}
          <button role="radio" aria-checked={selMode === m} class:on={selMode === m} title={h} onclick={() => setSelMode(m as SelectMode)}>{l}</button>
        {/each}
      </div>
      {#if tool === 'wand'}
        <label class="opt">{t('Tolerance')} <input type="range" min="0" max="128" value={opts.wandTolerance} oninput={(e) => setOpt('wandTolerance', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.wandTolerance}</span></label>
        <label class="opt chk"><input type="checkbox" checked={opts.wandContiguous} onchange={(e) => setOpt('wandContiguous', (e.target as HTMLInputElement).checked)} /> {t('Contiguous')}</label>
      {:else if tool === 'object'}
        <span class="hint">{t('Click an object · Shift-click to add · Alt-click to exclude')}</span>
        <button class="btn ghost" title={t('Select the main subject of the image automatically')} onclick={() => void selectSubject()}><Icon icon={Sparkles} size={14} /> {t('Select subject')}</button>
      {/if}
      <span class="sep"></span>
    {:else if tool === 'fill'}
      <label class="opt" title={t('How different a colour can be and still be filled')}>{t('Tolerance')} <input type="range" min="0" max="128" value={opts.wandTolerance} oninput={(e) => setOpt('wandTolerance', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.wandTolerance}</span></label>
      <label class="opt chk" title={t('Off: fill every pixel of that colour, not only the connected area')}><input type="checkbox" checked={opts.wandContiguous} onchange={(e) => setOpt('wandContiguous', (e.target as HTMLInputElement).checked)} /> {t('Contiguous')}</label>
      <span class="sep"></span>
    {:else if tool === 'gradient'}
      <span class="chips" role="radiogroup" aria-label={t('Gradient shape')}>
        <button class="chip" role="radio" aria-checked={opts.gradType === 'linear'} class:on={opts.gradType === 'linear'} onclick={() => setOpt('gradType', 'linear')}>{t('Linear')}</button>
        <button class="chip" role="radio" aria-checked={opts.gradType === 'radial'} class:on={opts.gradType === 'radial'} onclick={() => setOpt('gradType', 'radial')}>{t('Radial')}</button>
      </span>
      {#if !es?.editMask}
        <label class="opt" title={t('What the colour fades to')}>{t('To', {}, 'gradient')}
          <select value={opts.gradEnd} onchange={(e) => setOpt('gradEnd', (e.target as HTMLSelectElement).value as 'transparent' | 'white' | 'black')}>
            <option value="transparent">{t('Transparent')}</option>
            <option value="white">{t('White')}</option>
            <option value="black">{t('Black')}</option>
          </select>
        </label>
        <label class="opt">{t('Opacity')} <input type="range" min="5" max="100" value={Math.round(opts.brushOpacity * 100)} oninput={(e) => setOpt('brushOpacity', +(e.target as HTMLInputElement).value / 100)} /></label>
      {:else}
        <span class="hint">{t('On the mask: shown → hidden')}</span>
      {/if}
      <button class="btn ghost" class:on={opts.gradReverse} title={t('Swap the start and end colours')} onclick={() => setOpt('gradReverse', !opts!.gradReverse)}>{t('Reverse')}</button>
      <span class="sep"></span>
    {:else if tool === 'clone' || tool === 'heal'}
      <label class="opt">{t('Size')} <input type="range" min="2" max="300" value={opts.brushSize || 24} oninput={(e) => setOpt('brushSize', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.brushSize || 24}</span></label>
      {#if tool === 'clone'}<label class="opt">{t('Opacity')} <input type="range" min="5" max="100" value={Math.round(opts.brushOpacity * 100)} oninput={(e) => setOpt('brushOpacity', +(e.target as HTMLInputElement).value / 100)} /></label>{/if}
      <span class="hint">{tool === 'clone' ? t('Alt-click the source, then paint') : t('Paint over what should go')}</span>
      <span class="sep"></span>
    {:else if tool === 'brush' || tool === 'eraser'}
      <label class="opt">{t('Size')} <input type="range" min="1" max="300" value={opts.brushSize || 12} oninput={(e) => setOpt('brushSize', +(e.target as HTMLInputElement).value)} /><span class="v">{opts.brushSize || t('auto')}</span></label>
      {#if tool === 'brush'}<label class="opt">{t('Opacity')} <input type="range" min="5" max="100" value={Math.round(opts.brushOpacity * 100)} oninput={(e) => setOpt('brushOpacity', +(e.target as HTMLInputElement).value / 100)} /></label>{/if}
      {#if es?.editMask}
        <span class="chips" role="radiogroup" aria-label={t('On the mask the brush')}>
          <button class="chip" role="radio" aria-checked={opts.maskHide} class:on={opts.maskHide} title={t('The brush hides, the eraser shows (X swaps)')} onclick={() => editor?.setMaskHide(true)}>{t('Hide')}</button>
          <button class="chip" role="radio" aria-checked={!opts.maskHide} class:on={!opts.maskHide} title={t('The brush shows, the eraser hides (X swaps)')} onclick={() => editor?.setMaskHide(false)}>{t('Show')}</button>
        </span>
        <button class="btn ghost" title={t("Paint on the layer's pixels again")} onclick={() => editor?.setEditMask(false)}>{t('Done with mask')}</button>
      {/if}
      <span class="sep"></span>
    {:else if shapeTool || obj}
      <label class="opt" title={t('Line width')}>{t('Width', {}, 'line')} <input type="range" min="1" max="60" value={obj?.strokeWidth ?? (opts.strokeWidth || 6)} oninput={(e) => (obj ? editor?.updateObject({ strokeWidth: +(e.target as HTMLInputElement).value }) : setOpt('strokeWidth', +(e.target as HTMLInputElement).value))} /></label>
      {#if tool === 'rect' || tool === 'oval' || obj?.kind === 'rect' || obj?.kind === 'oval'}
        <label class="opt chk" title={t('Fill the shape with the colour')}><input type="checkbox" checked={obj ? !!obj.filled : opts.filled} onchange={(e) => (obj ? editor?.updateObject({ filled: (e.target as HTMLInputElement).checked }) : setOpt('filled', (e.target as HTMLInputElement).checked))} /> {t('Filled')}</label>
      {/if}
      {#if tool === 'rect' || obj?.kind === 'rect'}
        {@const radius = obj ? (obj.cornerRadius ?? 0) : opts.cornerRadius}
        <label class="opt" title={t('Corner radius: 0 = sharp corners, higher = rounder')}>{t('Corners')} <input type="range" min="0" max="200" value={radius} oninput={(e) => (obj ? editor?.updateObject({ cornerRadius: +(e.target as HTMLInputElement).value }) : setOpt('cornerRadius', +(e.target as HTMLInputElement).value))} /><span class="v">{radius}</span></label>
      {/if}
      <span class="sep"></span>
    {/if}
    {#if tool !== 'eraser' && !SELECT_TOOLS.includes(tool) && tool !== 'crop' && tool !== 'blur' && tool !== 'pixelate' && tool !== 'clone' && tool !== 'heal'}
      {#each COLORS as c (c)}
        <button class="swatch" class:on={(obj?.color ?? opts.color) === c} style:background={c} title={t('Colour')} aria-label={t('Colour {value}', { value: c })} onclick={() => pickColor(c)}></button>
      {/each}
      <input class="custom" type="color" value={obj?.color ?? opts.color} title={t('Custom colour')} oninput={(e) => pickColor((e.target as HTMLInputElement).value)} />
      <span class="sep"></span>
    {/if}
    <button class="icon-btn" title={t('Undo ({shortcut})', { shortcut: formatShortcut('Mod+Z') })} disabled={!es?.canUndo} onclick={() => editor?.undo()}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title={t('Redo ({shortcut})', { shortcut: formatShortcut('Mod+Shift+Z') })} disabled={!es?.canRedo} onclick={() => editor?.redo()}><Icon icon={Redo2} /></button>
    <span class="sep"></span>
    <button class="btn ghost" title={t('Rotate, flip, resize, remove background…')} onclick={imageMenu}><Icon icon={ImageIco} size={14} /> {t('Image')} ▾</button>
  {:else if isSvg}
    <span class="label">{t('SVG — view only here')}</span>
  {:else if imgMode && ext === 'gif'}
    <button class="btn ghost" title={t('Open the first frame in the editor')} onclick={startEditingGif}><Icon icon={Pencil} size={14} /> {t('Edit (first frame)')}</button>
  {:else if tab.readOnly}
    <span class="label">{t('Read-only — use Save as to edit a copy')}</span>
  {/if}
  <span class="spacer"></span>
  {#if editable}
    <GiveButton {tab} get={giveImage} what={es?.pixelSelection ? t('the selection') : t('the picture')} />
    <button class="btn ghost" title={t('Save options')} onclick={saveMenu}><Icon icon={Save} size={14} /> {t('Save')} ▾</button>
    <span class="sep"></span>
  {/if}
  <button class="btn ghost" title={t('Zoom out')} onclick={() => ctl.zoom(-1)}>−</button>
  <button class="btn ghost zoomlabel" title={t('Fit (0) · Actual size (1)')} onclick={() => (zoom === 1 ? ctl.fit() : ctl.actual())}>{Math.round(zoom * 100)}%</button>
  <button class="btn ghost" title={t('Zoom in')} onclick={() => ctl.zoom(1)}>+</button>
  {#if editor && !imgMode}
    <button class="icon-btn" title={t('Turn the view left ({shortcut}) — the picture itself is not changed', { shortcut: formatShortcut('Alt+ArrowLeft') })} aria-label={t('Turn the view left')} onclick={() => editor?.rotateView(-15)}><Icon icon={RotateCcw} /></button>
    {#if es?.viewRotation}<button class="btn ghost viewangle" title={t('Straighten the view ({shortcut})', { shortcut: formatShortcut('Alt+0') })} onclick={() => editor?.rotateView(0, true)}>{Math.round(es.viewRotation)}°</button>{/if}
    <button class="icon-btn" title={t('Turn the view right ({shortcut}) — the picture itself is not changed', { shortcut: formatShortcut('Alt+ArrowRight') })} aria-label={t('Turn the view right')} onclick={() => editor?.rotateView(15)}><Icon icon={RotateCw} /></button>
    <button class="icon-btn" class:on={overlays.rulers || overlays.grid} title={t('Rulers, guides, grid and snapping')} aria-label={t('View options')} onclick={viewMenu}><Icon icon={Grid3x3} /></button>
  {/if}
  {#if tab.filePath}
    <span class="sep"></span>
    <button class="icon-btn" title={t('Previous image (←)')} onclick={() => navigate(-1)}><Icon icon={ChevronLeft} /></button>
    {#if position}<span class="label">{position}</span>{/if}
    <button class="icon-btn" title={t('Next image (→)')} onclick={() => navigate(1)}><Icon icon={ChevronRightIcon} /></button>
  {/if}
  <span class="sep"></span>
  <button class="icon-btn" class:on={ocrOpen} title={t('Copy text from the image (OCR) — from the selection if there is one')} aria-label={t('Recognise text')} onclick={() => (ocrOpen ? (ocrOpen = false) : openOcr())}><Icon icon={ScanText} /></button>
  {#if editable}
    <span class="sep"></span>
    <button class="icon-btn" class:on={panel === 'layers'} title={t('Layers')} onclick={() => togglePanel('layers')}><Icon icon={Layers} /></button>
    <button class="icon-btn" class:on={panel === 'adjust'} title={t('Adjust colours')} onclick={() => togglePanel('adjust')}><Icon icon={Sliders} /></button>
    <button class="icon-btn" class:on={panel === 'history'} title={t('History: go back several steps at once')} onclick={() => togglePanel('history')}><Icon icon={HistoryIcon} /></button>
  {/if}
</div>

{#if resizeOpen && editor}
  <div class="banner resize">
    <label>{t('Width')} <input class="input num" type="number" min="1" bind:value={rw} oninput={changeW} /></label>
    <label>{t('Height')} <input class="input num" type="number" min="1" bind:value={rh} oninput={changeH} /></label>
    <label class="chk"><input type="checkbox" bind:checked={lockAspect} /> {t('Keep aspect ratio')}</label>
    <span class="muted">{t('from {w} × {h}', { w: String(editor.width), h: String(editor.height) })}</span>
    <span class="grow"></span>
    <button class="btn" title={t('Close without resizing')} onclick={() => (resizeOpen = false)}>{t('Cancel')}</button>
    <button class="btn primary" onclick={applyResize}>{t('Resize')}</button>
  </div>
{/if}

{#if canvasOpen && editor}
  <div class="banner resize canvas-size">
    <label>{t('Width')} <input class="input num" type="number" min="1" bind:value={cw} /></label>
    <label>{t('Height')} <input class="input num" type="number" min="1" bind:value={ch} /></label>
    <div class="anchor" role="group" aria-label={t('Where the picture sits')}>
      {#each ANCHORS as a (a.label)}
        <button class="cell" class:on={anchor.x === a.x && anchor.y === a.y} title={a.label} aria-label={a.label} aria-pressed={anchor.x === a.x && anchor.y === a.y} onclick={() => (anchor = { x: a.x, y: a.y })}></button>
      {/each}
    </div>
    <label>{t('New space')}
      <select class="input" bind:value={canvasFill}>
        <option value="clear">{t('Transparent')}</option>
        <option value="colour">{t('Current colour')}</option>
      </select>
    </label>
    <span class="muted">{t('from {w} × {h}', { w: String(editor.width), h: String(editor.height) })}</span>
    <span class="grow"></span>
    <button class="btn" title={t('Close without changing the canvas')} onclick={() => (canvasOpen = false)}>{t('Cancel')}</button>
    <button class="btn primary" onclick={applyCanvasSize}>{t('Apply')}</button>
  </div>
{/if}

{#if rotateOpen && editor}
  <div class="banner resize">
    <label class="angle">{t('Angle')} <input type="range" min="-180" max="180" step="0.5" bind:value={angle} oninput={previewAngle} /> <input class="input num sm" type="number" min="-360" max="360" step="0.5" bind:value={angle} oninput={previewAngle} />°</label>
    {#if rotateLayer}<span class="muted">{t('Turns the active layer about its middle')}</span>{:else}<label class="chk"><input type="checkbox" bind:checked={expand} /> {t('Enlarge canvas to fit')}</label>{/if}
    <span class="grow"></span>
    <button class="btn" onclick={cancelRotate}>{t('Cancel')}</button>
    <button class="btn primary" onclick={applyRotate}>{t('Rotate')}</button>
  </div>
{/if}

{#if es?.warping === 'crop'}
  <div class="banner warping">
    <span class="grow">{t('Drag the corners onto the edges of what should become a rectangle (a page, a sign, a screen), then apply.')}</span>
    <button class="btn ghost" title={t('Discard the crop (Esc)')} onclick={() => editor?.finishWarp(false)}><Icon icon={XIcon} size={14} /> {t('Cancel')}</button>
    <button class="btn primary" onclick={() => editor?.finishWarp(true)}><Icon icon={Check} size={14} /> {t('Apply (Enter)')}</button>
  </div>
{:else if es?.transforming || es?.warping}
  <div class="banner transforming">
    <span class="chips" role="radiogroup" aria-label={t('How the handles change it')}>
      {#if es.transforming}<button class="chip" role="radio" aria-checked={!es.warping} class:on={!es.warping} onclick={() => editor?.finishWarp(true)}>{t('Scale & rotate')}</button>{/if}
      {#each WARPS as w (w.id)}<button class="chip" role="radio" aria-checked={es.warping === w.id} class:on={es.warping === w.id} title={w.help} onclick={() => editor?.startWarp(w.id)}>{w.label}</button>{/each}
    </span>
    <span class="grow">{es.warping ? WARPS.find((w) => w.id === es!.warping)!.help : t('Drag to move the selection; drag the handles to scale it, the round one to rotate it (any angle; hold Shift for 15° steps).')}</span>
    <button class="btn ghost" title={t('Put it back as it was (Esc)')} onclick={() => (es?.transforming ? editor?.finishTransform(false) : editor?.finishWarp(false))}><Icon icon={XIcon} size={14} /> {t('Cancel')}</button>
    <button class="btn primary" onclick={() => (es?.transforming ? editor?.finishTransform(true) : editor?.finishWarp(true))}><Icon icon={Check} size={14} /> {t('Apply (Enter)')}</button>
  </div>
{:else if es?.hasRegion}
  <div class="banner">
    <span class="grow">{tool === 'crop' ? t('Adjust the crop area, then apply.') : tool === 'blur' ? t('Adjust the area to blur, then apply.') : t('Adjust the area to pixelate, then apply.')}</span>
    <button class="btn ghost" title={t('Discard the area (Esc)')} onclick={() => editor?.cancelRegion()}><Icon icon={XIcon} size={14} /> {t('Cancel')}</button>
    <button class="btn primary" onclick={() => editor?.applyRegion()}><Icon icon={Check} size={14} /> {t('Apply (Enter)')}</button>
  </div>
{:else if es?.pixelSelection && editable}
  <div class="banner selbar">
    <span class="muted">{t('Selection {w} × {h}', { w: String(es.pixelSelection.width), h: String(es.pixelSelection.height) })}</span>
    <span class="grow"></span>
    <button class="btn ghost" title={t('Copy ({shortcut})', { shortcut: formatShortcut('Mod+C') })} onclick={() => copy()}><Icon icon={Copy} size={14} /> {t('Copy')}</button>
    <button class="btn ghost" title={t('Cut ({shortcut})', { shortcut: formatShortcut('Mod+X') })} onclick={() => copy(true)}><Icon icon={Scissors} size={14} /> {t('Cut')}</button>
    <button class="btn ghost" title={t('Rotate, scale or move the selected pixels ({shortcut})', { shortcut: formatShortcut('Mod+Shift+R') })} onclick={() => editor?.transformSelection()}><Icon icon={Rotate3d} size={14} /> {t('Transform pixels')}</button>
    <button class="btn ghost" title={t('New layer from selection ({shortcut})', { shortcut: formatShortcut('Mod+J') })} onclick={() => editor?.layerFromSelection()}><Icon icon={SquaresUnite} size={14} /> {t('To layer')}</button>
    <button class="btn ghost remove-object" title={t('Remove the selected object and fill the gap with what could be behind it')} onclick={() => void removeObject()}><Icon icon={Eraser2} size={14} /> {t('Remove')}</button>
    <button class="btn ghost" title={t('Delete pixels (Delete)')} onclick={() => editor?.clearSelectionPixels()}><Icon icon={Trash} size={14} /></button>
    <button class="btn ghost" title={t('Fill with colour')} onclick={() => editor?.fillSelection()}><Icon icon={PaintBucket} size={14} /></button>
    <button class="btn ghost" title={t('Blur the selection: opens Adjust → Blur (Gaussian, motion, zoom, spin, lens, tilt-shift, surface, frosted glass)')} onclick={() => void openAdjust('blur')}><Icon icon={Droplets} size={14} /></button>
    <button class="btn ghost" title={t('Pixelate the selection: opens Adjust → Pixelate, with the block size')} onclick={() => void openAdjust('pixelate')}><Icon icon={Grid} size={14} /></button>
    <button class="btn ghost" title={t('Crop to selection')} onclick={() => editor?.cropToSelection()}><Icon icon={Crop} size={14} /></button>
    <button class="btn ghost" title={t('Copy the text in the selection (OCR)')} onclick={openOcr}><Icon icon={ScanText} size={14} /> {t('Text')}</button>
    <button class="btn ghost" title={t('Feather, expand, contract, smooth or border the selection')} onclick={modifyMenu}>{t('Modify')} ▾</button>
    <button class="btn ghost" title={t('Invert selection ({shortcut})', { shortcut: formatShortcut('Mod+Shift+I') })} onclick={invertSelection}>{t('Invert')}</button>
    <button class="btn ghost" title={t('Deselect ({shortcut})', { shortcut: formatShortcut('Mod+D') })} onclick={() => editor?.deselect()}><Icon icon={XIcon} size={14} /></button>
  </div>
{/if}

{#if anim}
  <AnimEditor bind:this={animEd} {tab} info={anim} />
{:else if icons}
  <IconView {tab} entries={icons} onreload={() => void load()} />
{:else}
<div class="body" bind:clientWidth={bodyW}>
  {#if editable}
    <div class="tools" role="toolbar" aria-orientation="vertical" aria-label={t('Tools')}>
      {#each toolGroups as group, gi (gi)}
        {#if gi}<span class="hsep"></span>{/if}
        {#each group as tl (tl.id)}
          <button class="icon-btn" class:on={tool === tl.id} title="{tl.label}{tl.key ? ` (${formatShortcut(tl.key)})` : ''} — {tl.help}" aria-label={tl.label} onclick={() => setTool(tl.id)}><Icon icon={tl.icon} /></button>
          {#if tl.id === 'object'}
            {#each aiTools as a (a.pack)}
              <button class="icon-btn ai" class:locked={!aiReady(a.pack)} data-pack={a.pack} title={aiToolTitle(a)} aria-label={a.label} aria-disabled={!aiReady(a.pack)} onclick={() => aiToolClick(a)}>
                <Icon icon={a.icon} />
                <span class="badge" aria-hidden="true">{#if aiReady(a.pack)}AI{:else}<Icon icon={Download} size={9} />{/if}</span><!-- i18n-ignore -->
              </button>
            {/each}
          {/if}
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
      if (showRulers && editor) pointerAt = editor.toDoc(e.clientX, e.clientY);
      if (!drag) return;
      imgView = { ...imgView, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
      imgFitted = false;
    }}
    onpointerup={() => (drag = null)}
    ondblclick={() => imgMode && (imgView.zoom === 1 ? imgFit() : ctl.actual())}
  >
    <div class="stage" class:hidden={imgMode} bind:this={stageHost}></div>
    {#if showRulers}
      <canvas class="ruler top" bind:this={rulerTop} title={t('Drag down onto the picture for a guide')} onpointerdown={(e) => guideFromRuler(e, 'y')}></canvas>
      <canvas class="ruler left" bind:this={rulerLeft} title={t('Drag right onto the picture for a guide')} onpointerdown={(e) => guideFromRuler(e, 'x')}></canvas>
      <div class="ruler corner"></div>
    {/if}
    {#if imgMode && src}
      <img
        bind:this={imgEl}
        {src}
        alt={tab.title}
        draggable="false"
        onload={imgLoaded}
        onerror={() => (error = t('This image could not be displayed.'))}
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
        <button class:on={panel === 'layers'} onclick={() => setPanel('layers')}>{t('Layers')}</button>
        <button class:on={panel === 'adjust'} onclick={() => setPanel('adjust')}>{t('Adjust')}</button>
        <button class:on={panel === 'colours'} onclick={() => setPanel('colours')}>{t('Colours')}</button>
        <button class:on={panel === 'history'} onclick={() => setPanel('history')}>{t('History')}</button>
      </div>
      {#if panel === 'layers'}
        <LayersPanel {editor} {es} onrotate={() => openRotate(true)} />
      {:else if panel === 'history'}
        <HistoryPanel {editor} {es} />
      {:else if panel === 'colours'}
        <ColoursPanel {editor} {picked} title={tab.filePath ?? tab.title} onuse={(c) => (pickColor(c), ui.toast(t('Using {colour}', { colour: c }), 'success'))} />
      {:else}
        <AdjustPanel bind:this={adjustPanel} {editor} {es} pick={pickForPanel} />
      {/if}
    </aside>
  {/if}
  {#if ocrOpen}
    {#key ocrKey}
      <OcrPanel title={es?.pixelSelection ? t('Text in the selection') : t('Text in the image')} run={runOcr} onclose={() => (ocrOpen = false)}>
        {#snippet actions()}
          {#if editable && editor && ocrWords.length}<button class="btn ghost" title={t('Pixelate every recognised word — for passwords, names and numbers in screenshots')} onclick={hideText}>{t('Hide text')}</button>{/if}
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
  .tools .ai {
    position: relative;
  }
  .tools .ai .badge {
    position: absolute;
    right: 1px;
    bottom: 1px;
    min-width: 12px;
    height: 11px;
    padding: 0 2px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    background: var(--accent);
    color: #fff;
    pointer-events: none;
  }
  .tools .ai.locked {
    opacity: 0.45;
  }
  .tools .ai.locked:hover {
    opacity: 0.8;
  }
  .tools .ai.locked .badge {
    background: var(--text-muted);
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
  .ruler {
    position: absolute;
    z-index: 2;
    display: block;
  }
  .ruler.top {
    top: 0;
    left: 20px;
    right: 0;
    height: 20px;
    width: calc(100% - 20px);
    cursor: ns-resize;
  }
  .ruler.left {
    top: 20px;
    left: 0;
    bottom: 0;
    width: 20px;
    height: calc(100% - 20px);
    cursor: ew-resize;
  }
  .ruler.corner {
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    box-sizing: border-box;
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
    border-radius: 4px;
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
    padding: 6px 8px;
    /* Four tabs share a narrow panel: they shrink (with an ellipsis) rather than spill over. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .anchor {
    display: grid;
    grid-template-columns: repeat(3, 14px);
    gap: 2px;
  }
  .anchor .cell {
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg-hover);
    cursor: pointer;
  }
  .anchor .cell.on {
    background: var(--accent);
    border-color: var(--accent);
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
    border-radius: 4px;
    padding: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    padding: 3px 10px;
    border-radius: 4px;
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
    border-radius: var(--radius-sm);
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
