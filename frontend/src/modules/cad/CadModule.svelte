<script lang="ts">
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { isNarrow } from '../../core/fit';
  import { fitBar } from '../../core/fit';
  // DXF viewer and light CAD editor. The drawing lives in a worker (parse,
  // edit, rebuild); this view draws the scene on a canvas and runs the tools:
  // select (click, window, crossing), pan/zoom, line, polyline, rectangle,
  // circle, arc, text, measure, move, copy, rotate, scale — with object snaps,
  // grid, ortho and typed coordinates ("x,y", "@dx,dy", "len<angle").
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import MousePointer from '@lucide/svelte/icons/mouse-pointer-2';
  import Hand from '@lucide/svelte/icons/hand';
  import Ruler from '@lucide/svelte/icons/ruler';
  import Slash from '@lucide/svelte/icons/slash';
  import Spline from '@lucide/svelte/icons/spline';
  import Square from '@lucide/svelte/icons/square';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import ArcIcon from '@lucide/svelte/icons/rainbow';
  import Type from '@lucide/svelte/icons/type';
  import Move from '@lucide/svelte/icons/move';
  import Copy from '@lucide/svelte/icons/copy';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Scale from '@lucide/svelte/icons/scaling';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Magnet from '@lucide/svelte/icons/magnet';
  import Grid from '@lucide/svelte/icons/grid-3x3';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Lock from '@lucide/svelte/icons/lock';
  import Plus from '@lucide/svelte/icons/plus';
  import Download from '@lucide/svelte/icons/download';
  import FileText from '@lucide/svelte/icons/file-text';
  import { api, saveFile, sessionToken } from '../../core/backend';
  import { formatShortcut } from '../../core/keys';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { theme } from '../../core/theme.svelte';
  import { menu, toastError, ui } from '../../core/ui.svelte';
  import { num, t, tn } from '../../core/i18n';
  import { CadClient } from './cadClient';
  import type { CadInfo } from './cadWorker';
  import type { NewEntity, Prop } from './doc';
  import { rotateAbout, scaleAbout, translate, type M, type Scene } from './geometry';
  import { css, drawEntities, fittedHeight, Painter, renderFitted, toSvg, type View } from './paint';
  import { arc3, boxSelect, gridStep, nearestSnap, parsePoint, pick } from './pick';
  import { cadViews, type CadOp, type CadTool } from './views';

  let { tab }: { tab: Tab } = $props();

  type P2 = [number, number];
  interface Props {
    type: string;
    handle: string | null;
    layer: string;
    color: number;
    trueColor: number | null;
    props: Prop[];
    length?: number;
    area?: number;
    editable: boolean;
  }

  const client = new CadClient();
  // A narrow pane (split view, small window): the panel floats over the
  // content, opened from the toolbar.
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  let panelOpen = $state(false);
  let info = $state<CadInfo | null>(null);
  let scene: Scene | null = null;
  let painter: Painter | null = null;
  let sceneVersion = $state(0);
  let sel = $state<number[]>([]);
  let selSet = new Set<number>();
  let hover = -1;
  let tool = $state<CadTool>('select');
  let pts = $state<P2[]>([]);
  let cursor: P2 = [0, 0];
  let cursorScreen: P2 = [0, 0];
  let snapHit: [number, number, number] | null = null;
  let snapOn = $state(true);
  let gridOn = $state(false);
  let orthoOn = $state(false);
  let view: View = { z: 1, x: 0, y: 0 };
  let fitted = true;
  let objProps = $state<Props | null>(null);
  let curLayer = $state('0');
  let curColor = $state(256);
  let textHeight = $state(0); // 0: automatic (from the zoom)
  let extraLayers = $state<string[]>([]);
  let cmd = $state('');
  let measureText = $state('');
  let panel = $state<'props' | 'layers'>('props');
  let busy = $state('');
  let error = $state('');
  let loading = $state(true);
  let area = $state<HTMLDivElement>();
  let base = $state<HTMLCanvasElement>();
  let over = $state<HTMLCanvasElement>();
  let cmdInput = $state<HTMLInputElement>();
  let size = { w: 0, h: 0, dpr: 1 };
  let drag: null | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number } | { kind: 'band'; sx: number; sy: number; ex: number; ey: number } | { kind: 'grab'; sx: number; sy: number; base: P2; moved: boolean } = null;
  let spaceDown = false;
  let longestBase = 0;
  let longestPainter = 0;
  // Worker rendering: the last frame and the view it was drawn for.
  let canRender = false;
  let frame: { img: ImageBitmap; view: View; version: number; dark: boolean; w: number; h: number; dpr: number } | null = null;
  let rendering = false;
  let renderAgain = false;
  let longestRender = 0;

  const editable = $derived(!tab.readOnly);
  const layerNames = $derived([...new Set([...(info?.layers.map((l) => l.name) ?? []), ...extraLayers])]);
  const dark = $derived(theme.resolved === 'dark');
  const UNITS: Record<number, string> = { 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd' };
  const VERSIONS: Record<string, string> = { AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' };
  const ACI = [
    [256, t('By layer')],
    [1, t('Red')],
    [2, t('Yellow')],
    [3, t('Green')],
    [4, t('Cyan')],
    [5, t('Blue')],
    [6, t('Magenta')],
    [7, t('White / black')],
    [8, t('Dark grey')],
    [9, t('Light grey')],
    [0, t('By block')],
  ] as const;
  const ACI_RGB: Record<number, string> = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '', 8: '#808080', 9: '#c0c0c0' };

  type ToolDef = { id: CadTool; icon: any; label: string; key: string; help: string; edit?: boolean };
  const toolGroups: ToolDef[][] = [
    [
      { id: 'select', icon: MousePointer, label: t('Select'), key: 'V', help: t('Click an object to select it (Shift adds/removes). Drag left→right to select objects fully inside, right→left to select everything touched. Drag a selected object to move it.') },
      { id: 'pan', icon: Hand, label: t('Pan'), key: 'H', help: t('Drag to pan. In any tool: middle-drag or Space+drag pans, the wheel zooms at the cursor.') },
      { id: 'measure', icon: Ruler, label: t('Measure'), key: 'D', help: t('Click two points to measure the distance, ΔX, ΔY and angle. Snaps to ends, midpoints and centres.') },
    ],
    [
      { id: 'line', icon: Slash, label: t('Line'), key: 'L', edit: true, help: t('Click points to draw connected lines; Esc or right-click ends. Type a length, "x,y", "@dx,dy" or "length<angle" and press Enter for exact points.') },
      { id: 'polyline', icon: Spline, label: t('Polyline'), key: 'P', edit: true, help: t('Click points; click the first point to close, double-click, Enter or right-click to finish. Backspace removes the last point.') },
      { id: 'rect', icon: Square, label: t('Rectangle'), key: 'B', edit: true, help: t('Click two opposite corners (Ctrl or Shift for a square). Type "@width,height" for an exact size.') },
      { id: 'circle', icon: CircleIcon, label: t('Circle'), key: 'C', edit: true, help: t('Click the centre, then a point on the circle — or type the radius and press Enter.') },
      { id: 'arc', icon: ArcIcon, label: t('Arc'), key: 'A', edit: true, help: t('Click the start, a point on the arc, then the end.') },
      { id: 'text', icon: Type, label: t('Text'), key: 'T', edit: true, help: t('Click where the text starts, then type it. Set the height in the toolbar.') },
    ],
    [
      { id: 'move', icon: Move, label: t('Move', {}, 'cad'), key: 'M', edit: true, help: t('With objects selected: click a base point, then where it goes (or type "@dx,dy").') },
      { id: 'copy', icon: Copy, label: t('Copy'), key: 'O', edit: true, help: t('With objects selected: click a base point, then each place to put a copy. Esc ends.') },
      { id: 'rotate', icon: RotateCw, label: t('Rotate'), key: 'R', edit: true, help: t('With objects selected: click the centre, then the direction (Shift snaps to 15°) — or type the angle in degrees.') },
      { id: 'scale', icon: Scale, label: t('Scale', {}, 'cad'), key: 'S', edit: true, help: t('With objects selected: click the base point, then drag out the size — or type the factor (2 = double).') },
    ],
  ];
  const TRANSFORM_TOOLS: CadTool[] = ['move', 'copy', 'rotate', 'scale'];
  const DRAW_TOOLS: CadTool[] = ['line', 'polyline', 'rect', 'circle', 'arc', 'text'];

  // ---------- coordinates ----------

  const O = (): P2 => scene?.origin ?? [0, 0];
  const toWorld = (sx: number, sy: number): P2 => [O()[0] + (sx - view.x) / view.z, O()[1] + (view.y - sy) / view.z];
  const toScreen = (w: P2): P2 => [view.x + (w[0] - O()[0]) * view.z, view.y - (w[1] - O()[1]) * view.z];
  const rel = (w: P2): P2 => [w[0] - O()[0], w[1] - O()[1]];
  const decimals = () => Math.max(0, Math.min(6, Math.ceil(Math.log10(view.z)) + 1));
  const fmtN = (v: number, d = decimals()) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(d);
  const unit = () => (info ? (UNITS[info.units] ?? '') : '');

  // ---------- worker results ----------

  interface Reply {
    info: CadInfo;
    scene?: Scene;
    select?: number[];
    skipped?: number;
    buildMs?: number;
    canRender?: boolean;
  }

  /** Labels of the object properties the worker lists (it has no translations). */
  const PROP_LABELS: Record<string, string> = {
    'Start X': t('Start X'),
    'Start Y': t('Start Y'),
    'End X': t('End X'),
    'End Y': t('End Y'),
    'Position X': t('Position X'),
    'Position Y': t('Position Y'),
    'Centre X': t('Centre X'),
    'Centre Y': t('Centre Y'),
    Radius: t('Radius'),
    'Start angle': t('Start angle'),
    'End angle': t('End angle'),
    'Minor/major ratio': t('Minor/major ratio'),
    Text: t('Text'),
    Height: t('Height'),
    Rotation: t('Rotation'),
    Block: t('Block'),
    'Scale X': t('Scale X'),
    'Scale Y': t('Scale Y'),
    Vertices: t('Vertices'),
    Closed: t('Closed'),
    Width: t('Width'),
    Degree: t('Degree'),
    'Control points': t('Control points'),
    Measurement: t('Measurement'),
  };
  /** Progress phases the worker reports. */
  const PHASES: Record<string, string> = { Reading: t('Reading'), 'Reading drawing': t('Reading drawing'), Saving: t('Saving') };

  /** A message from the worker, translated when it is one we know. */
  function workerError(m: string): string {
    if (m === 'Binary DXF isn’t supported; save it as ASCII DXF.') return t('Binary DXF isn’t supported; save it as ASCII DXF.');
    if (m === 'This DXF has no ENTITIES section.') return t('This DXF has no ENTITIES section.');
    const bad = /^Not a DXF file \(line (\d+): "([\s\S]*)"\)$/.exec(m);
    if (bad) return t('Not a DXF file (line {line}: "{text}")', { line: bad[1], text: bad[2] });
    return m;
  }

  function accept(r: Reply) {
    info = r.info;
    tab.dirty = r.info.dirty;
    if (r.canRender !== undefined) canRender = r.canRender;
    if (r.scene) setScene(r.scene);
    if (r.select) setSel(r.select);
    else setSel(sel.filter((i) => i < (r.info.entities ?? 0)));
    if (r.skipped) ui.toast(tn("{n} object (dimensions or unknown types) can't be changed this way and were left as they are.", "{n} objects (dimensions or unknown types) can't be changed this way and were left as they are.", r.skipped), 'warning');
    status();
  }

  function setScene(s: Scene) {
    const old = scene;
    if (old && (old.origin[0] !== s.origin[0] || old.origin[1] !== s.origin[1])) {
      // Keep the drawing still on screen when the origin moves.
      view = { ...view, x: view.x + (s.origin[0] - old.origin[0]) * view.z, y: view.y - (s.origin[1] - old.origin[1]) * view.z };
    }
    scene = s;
    if (!canRender) {
      const t0 = performance.now();
      painter = new Painter(s);
      longestPainter = Math.max(longestPainter, performance.now() - t0);
    }
    hover = -1;
    sceneVersion++;
    if (!old || fitted) fit();
    redraw();
  }

  async function run(msg: Record<string, unknown>, label = '') {
    if (label) busy = label;
    try {
      // $state arrays are proxies, which can't be posted to a worker.
      const r = await client.call<Reply>($state.snapshot(msg));
      accept(r);
      return r;
    } catch (e) {
      toastError(e, t('Edit failed'));
      return null;
    } finally {
      busy = '';
    }
  }

  async function load() {
    loading = true;
    error = '';
    client.onProgress = (phase, done, total) => (busy = total ? `${PHASES[phase] ?? phase}… ${Math.round((done / total) * 100)}%` : `${PHASES[phase] ?? phase}…`);
    try {
      const r = await client.call<Reply>({ type: 'load', url: new URL(tab.url(), location.href).href });
      scene = null;
      fitted = true;
      accept(r);
      if (!layerNames.includes(curLayer)) curLayer = '0';
    } catch (e) {
      error = workerError(e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
      busy = '';
    }
  }

  function setSel(ids: number[]) {
    sel = ids;
    selSet = new Set(ids);
    void refreshProps();
    redrawOverlay();
    status();
  }

  async function refreshProps() {
    if (sel.length !== 1) {
      objProps = null;
      return;
    }
    const want = sel[0];
    const r = await client.call<{ props: Props | null }>({ type: 'props', index: want });
    if (sel.length === 1 && sel[0] === want) objProps = r.props;
  }

  function status() {
    if (!info) return;
    const v = VERSIONS[info.version] ?? info.version ?? '';
    tab.status = {
      ...tab.status,
      type: v ? t('DXF {version} drawing', { version: v }) : t('DXF drawing'),
      position: `${fmtN(cursor[0])}, ${fmtN(cursor[1])}${unit() ? ` ${unit()}` : ''}`,
      info: tn('{n} object', '{n} objects', info.entities) + (sel.length ? ` · ${tn('{n} selected', '{n} selected', sel.length)}` : ''),
      encoding: info.encoding.toUpperCase(),
    };
  }

  // ---------- view ----------

  function resize() {
    if (!area || !base || !over) return;
    const dpr = window.devicePixelRatio || 1;
    const w = area.clientWidth;
    const h = area.clientHeight;
    size = { w, h, dpr };
    for (const c of [base, over]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    if (fitted) fit();
    redraw();
  }

  function fit() {
    if (!scene?.bounds || !size.w) return;
    const [x0, y0, x1, y1] = scene.bounds;
    const pad = 24;
    const bw = Math.max(x1 - x0, 1e-9);
    const bh = Math.max(y1 - y0, 1e-9);
    const z = Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh);
    view = { z, x: size.w / 2 - ((x0 + x1) / 2) * z, y: size.h / 2 + ((y0 + y1) / 2) * z };
    fitted = true;
    redraw();
  }

  function zoomAt(sx: number, sy: number, f: number) {
    const z = Math.min(1e12, Math.max(1e-12, view.z * f));
    f = z / view.z;
    view = { z, x: sx - (sx - view.x) * f, y: sy - (sy - view.y) * f };
    fitted = false;
    redraw();
  }

  let baseQueued = false;
  let overQueued = false;
  function redraw() {
    if (!baseQueued) {
      baseQueued = true;
      requestAnimationFrame(() => {
        baseQueued = false;
        drawBase();
      });
    }
    redrawOverlay();
  }
  function redrawOverlay() {
    if (overQueued) return;
    overQueued = true;
    requestAnimationFrame(() => {
      overQueued = false;
      drawOverlay();
    });
  }

  function drawBase() {
    const ctx = base?.getContext('2d');
    if (!ctx || !size.w) return;
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, base!.width, base!.height);
    if (gridOn) drawGrid(ctx);
    if (canRender) {
      // The worker's last frame, moved/scaled to the current view until the next one arrives.
      if (frame) {
        const k = view.z / frame.view.z;
        ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        ctx.imageSmoothingEnabled = k !== 1;
        ctx.drawImage(frame.img, view.x - frame.view.x * k, view.y - frame.view.y * k, frame.w * k, frame.h * k);
      }
      const stale = !frame || frame.version !== sceneVersion || frame.dark !== dark || frame.w !== size.w || frame.h !== size.h || frame.dpr !== size.dpr || frame.view.z !== view.z || frame.view.x !== view.x || frame.view.y !== view.y;
      if (stale) requestRender();
    } else painter?.draw(ctx, view, size.dpr, dark, size.w, size.h);
    longestBase = Math.max(longestBase, performance.now() - t0);
  }

  /** Ask the worker for a frame of the current view (one in flight; the latest view wins). */
  function requestRender() {
    if (rendering) {
      renderAgain = true;
      return;
    }
    if (!scene || !size.w) return;
    rendering = true;
    const want = { view: { ...view }, version: sceneVersion, dark, w: size.w, h: size.h, dpr: size.dpr };
    client
      .call<{ bmp: ImageBitmap | null; ms: number }>({ type: 'render', view: want.view, w: want.w, h: want.h, dpr: want.dpr, dark: want.dark })
      .then((r) => {
        if (!r.bmp) return;
        longestRender = Math.max(longestRender, r.ms);
        frame?.img.close();
        frame = { img: r.bmp, ...want };
        drawBase();
      })
      .catch(() => {})
      .finally(() => {
        rendering = false;
        if (renderAgain) {
          renderAgain = false;
          drawBase();
        }
      });
  }

  function drawGrid(ctx: CanvasRenderingContext2D) {
    const step = gridStep(view.z, 16);
    const [wx0, wy1] = toWorld(0, 0);
    const [wx1, wy0] = toWorld(size.w, size.h);
    ctx.save();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)';
    const big = step * 5;
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
      for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) {
        const [sx, sy] = toScreen([x, y]);
        const major = Math.abs(x / big - Math.round(x / big)) < 1e-6 && Math.abs(y / big - Math.round(y / big)) < 1e-6;
        ctx.fillRect(sx - (major ? 1 : 0.5), sy - (major ? 1 : 0.5), major ? 2 : 1, major ? 2 : 1);
      }
    }
    // Axes through 0,0.
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const [ax, ay] = toScreen([0, 0]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ay) + 0.5);
    ctx.lineTo(size.w, Math.round(ay) + 0.5);
    ctx.moveTo(Math.round(ax) + 0.5, 0);
    ctx.lineTo(Math.round(ax) + 0.5, size.h);
    ctx.stroke();
    ctx.restore();
  }

  const accent = () => getComputedStyle(area!).getPropertyValue('--accent').trim() || '#4a90d9';

  /** The transform the active move/copy/rotate/scale would apply, in relative or world coordinates. */
  function opMatrix(to: P2, relative: boolean): M | null {
    if (!TRANSFORM_TOOLS.includes(tool) || pts.length !== 1) return null;
    const b = relative ? rel(pts[0]) : pts[0];
    const c = relative ? rel(to) : to;
    if (tool === 'move' || tool === 'copy') return translate(c[0] - b[0], c[1] - b[1]);
    if (tool === 'rotate') return rotateAbout(Math.atan2(c[1] - b[1], c[0] - b[0]), b[0], b[1]);
    const f = scaleRef ? Math.max(1e-9, Math.hypot(c[0] - b[0], c[1] - b[1]) / scaleRef) : 1;
    return scaleAbout(f, b[0], b[1]);
  }
  let scaleRef = 0;

  function drawOverlay() {
    const ctx = over?.getContext('2d');
    if (!ctx || !scene) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, over!.width, over!.height);
    const acc = accent();
    if (hover >= 0 && !selSet.has(hover)) drawEntities(ctx, scene, [hover], view, size.dpr, acc + '99', 2);
    if (sel.length) drawEntities(ctx, scene, sel, view, size.dpr, acc, 2);
    ctx.save();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.strokeStyle = acc;
    ctx.fillStyle = acc;
    ctx.lineWidth = 1;
    // Preview of the command in progress.
    const m = opMatrix(cursor, true);
    if (m && sel.length) {
      drawEntities(ctx, scene, sel, view, size.dpr, dark ? '#ffffffcc' : '#000000aa', 1, m);
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    }
    const S = toScreen;
    ctx.beginPath();
    if (pts.length) {
      const c = S(cursor);
      const p0 = S(pts[0]);
      const last = S(pts[pts.length - 1]);
      if (tool === 'line' || tool === 'measure' || TRANSFORM_TOOLS.includes(tool)) {
        if (!(tool === 'measure' && pts.length === 2)) {
          ctx.moveTo(...last);
          ctx.lineTo(...c);
        } else {
          ctx.moveTo(...p0);
          ctx.lineTo(...S(pts[1]));
        }
      } else if (tool === 'polyline') {
        ctx.moveTo(...p0);
        for (const p of pts.slice(1)) ctx.lineTo(...S(p));
        ctx.lineTo(...c);
      } else if (tool === 'rect') {
        const q = rectCorner(pts[0], cursor);
        const s2 = S(q);
        ctx.rect(Math.min(p0[0], s2[0]), Math.min(p0[1], s2[1]), Math.abs(s2[0] - p0[0]), Math.abs(s2[1] - p0[1]));
      } else if (tool === 'circle') {
        ctx.arc(p0[0], p0[1], Math.hypot(c[0] - p0[0], c[1] - p0[1]), 0, 2 * Math.PI);
        ctx.moveTo(...p0);
        ctx.lineTo(...c);
      } else if (tool === 'arc') {
        if (pts.length === 1) {
          ctx.moveTo(...p0);
          ctx.lineTo(...c);
        } else {
          const a = arc3(pts[0], pts[1], cursor);
          if (a) {
            const [cx, cy] = S([a.cx, a.cy]);
            ctx.arc(cx, cy, a.r * view.z, (-a.a0 * Math.PI) / 180, (-a.a1 * Math.PI) / 180, true);
          }
        }
      }
    }
    ctx.stroke();
    // Points already placed.
    for (const p of pts) {
      const [x, y] = S(p);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // Rubber band.
    if (drag?.kind === 'band') {
      const crossing = drag.ex < drag.sx;
      ctx.setLineDash(crossing ? [5, 4] : []);
      ctx.fillStyle = crossing ? 'rgba(80,200,120,0.12)' : 'rgba(80,140,255,0.12)';
      ctx.strokeStyle = crossing ? 'rgb(60,170,100)' : 'rgb(70,120,230)';
      const x = Math.min(drag.sx, drag.ex);
      const y = Math.min(drag.sy, drag.ey);
      ctx.fillRect(x, y, Math.abs(drag.ex - drag.sx), Math.abs(drag.ey - drag.sy));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.ex - drag.sx), Math.abs(drag.ey - drag.sy));
      ctx.setLineDash([]);
    }
    // Snap marker.
    if (snapHit) {
      const [x, y] = S([snapHit[0] + O()[0], snapHit[1] + O()[1]]);
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const k = snapHit[2];
      if (k === 0) ctx.rect(x - 5, y - 5, 10, 10);
      else if (k === 1) {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y + 5);
        ctx.lineTo(x - 6, y + 5);
        ctx.closePath();
      } else if (k === 2) ctx.arc(x, y, 6, 0, 2 * Math.PI);
      else if (k === 3) {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
      } else {
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
      }
      ctx.stroke();
    }
    // Crosshair for drawing tools.
    if (tool !== 'select' && tool !== 'pan') {
      const [x, y] = S(cursor);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y - 14);
      ctx.lineTo(Math.round(x) + 0.5, y + 14);
      ctx.moveTo(x - 14, Math.round(y) + 0.5);
      ctx.lineTo(x + 14, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function rectCorner(a: P2, b: P2): P2 {
    if (!squareMod) return b;
    const s = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return [a[0] + Math.sign(b[0] - a[0] || 1) * s, a[1] + Math.sign(b[1] - a[1] || 1) * s];
  }
  let squareMod = false;
  let shiftMod = false;

  // ---------- pointer ----------

  const locked = (e: number) => {
    const name = scene?.layers[scene.entLayer[e]];
    return !!info?.layers.find((l) => l.name === name)?.locked;
  };

  /** Cursor in world coords with snapping, grid and ortho applied. */
  function track(sx: number, sy: number) {
    cursorScreen = [sx, sy];
    let w = toWorld(sx, sy);
    snapHit = null;
    if (!scene) return w;
    const live = tool !== 'select' && tool !== 'pan';
    if (snapOn && live) {
      const own: number[] = [];
      for (const p of pts) own.push(p[0] - O()[0], p[1] - O()[1], 0);
      const hit = nearestSnap(scene, w[0] - O()[0], w[1] - O()[1], 10 / view.z, own);
      if (hit) {
        snapHit = hit;
        w = [hit[0] + O()[0], hit[1] + O()[1]];
      }
    }
    if (!snapHit && gridOn && live) {
      const s = gridStep(view.z, 16);
      w = [Math.round(w[0] / s) * s, Math.round(w[1] / s) * s];
    }
    const last = pts[pts.length - 1];
    if (last && live && orthoOn !== shiftMod && tool !== 'rotate' && !snapHit) {
      w = Math.abs(w[0] - last[0]) >= Math.abs(w[1] - last[1]) ? [w[0], last[1]] : [last[0], w[1]];
    }
    if (tool === 'rotate' && last && shiftMod) {
      const a = Math.atan2(w[1] - last[1], w[0] - last[0]);
      const r = Math.hypot(w[0] - last[0], w[1] - last[1]);
      const q = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      w = [last[0] + r * Math.cos(q), last[1] + r * Math.sin(q)];
    }
    return w;
  }

  function local(e: PointerEvent | MouseEvent): P2 {
    const r = area!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onPointerDown(e: PointerEvent) {
    if (!scene) return;
    area?.focus();
    const [sx, sy] = local(e);
    squareMod = e.ctrlKey || e.shiftKey;
    shiftMod = e.shiftKey;
    try {
      area!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    if (e.button === 1 || tool === 'pan' || spaceDown) {
      drag = { kind: 'pan', sx, sy, vx: view.x, vy: view.y };
      e.preventDefault();
      return;
    }
    if (e.button === 2) return; // context menu handles it
    if (e.button !== 0) return;
    cursor = track(sx, sy);
    if (tool === 'select') {
      const hit = pick(scene, ...rel(toWorld(sx, sy)), 5 / view.z, locked);
      if (hit >= 0) {
        if (e.shiftKey) setSel(selSet.has(hit) ? sel.filter((i) => i !== hit) : [...sel, hit]);
        else {
          if (!selSet.has(hit)) setSel([hit]);
          if (editable) drag = { kind: 'grab', sx, sy, base: toWorld(sx, sy), moved: false };
        }
      } else drag = { kind: 'band', sx, sy, ex: sx, ey: sy };
      return;
    }
    void clickPoint(cursor);
  }

  function onPointerMove(e: PointerEvent) {
    if (!scene) return;
    const [sx, sy] = local(e);
    squareMod = e.ctrlKey || e.shiftKey;
    shiftMod = e.shiftKey;
    if (drag?.kind === 'pan') {
      view = { ...view, x: drag.vx + sx - drag.sx, y: drag.vy + sy - drag.sy };
      fitted = false;
      redraw();
      return;
    }
    if (drag?.kind === 'band') {
      drag.ex = sx;
      drag.ey = sy;
    } else if (drag?.kind === 'grab') {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) > 4) {
        drag.moved = true;
        tool = 'move';
        pts = [drag.base];
      }
    }
    cursor = track(sx, sy);
    if (tool === 'select' && !drag) {
      const h = pick(scene, ...rel(toWorld(sx, sy)), 5 / view.z, locked);
      if (h !== hover) hover = h;
    } else hover = -1;
    if (tool === 'measure' && pts.length === 1) measureText = describe(pts[0], cursor);
    status();
    redrawOverlay();
  }

  async function onPointerUp(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!scene || !d) return;
    if (d.kind === 'band') {
      const [sx, sy] = local(e);
      if (Math.hypot(sx - d.sx, sy - d.sy) < 3) {
        if (!e.shiftKey) setSel([]);
      } else {
        const a = rel(toWorld(d.sx, d.sy));
        const b = rel(toWorld(sx, sy));
        const got = boxSelect(scene, a[0], a[1], b[0], b[1], sx < d.sx, locked);
        setSel(e.shiftKey ? [...new Set([...sel, ...got])] : got);
      }
      redrawOverlay();
    } else if (d.kind === 'grab' && d.moved) {
      await clickPoint(cursor);
      tool = 'select';
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    cursor = track(sx, sy);
  }

  function onContext(e: MouseEvent) {
    e.preventDefault();
    if (pts.length || tool !== 'select') {
      void finish();
      return;
    }
    if (!sel.length || !editable) return;
    menu.show(e, [
      { label: t('Move', {}, 'cad'), shortcut: 'M', run: () => setTool('move') },
      { label: t('Copy'), shortcut: 'O', run: () => setTool('copy') },
      { label: t('Rotate'), shortcut: 'R', run: () => setTool('rotate') },
      { label: t('Scale', {}, 'cad'), shortcut: 'S', run: () => setTool('scale') },
      { label: t('Duplicate'), shortcut: formatShortcut('Mod+D'), run: () => doOp('duplicate') },
      { label: t('Delete'), shortcut: 'Del', run: () => doOp('delete') },
    ]);
  }

  // ---------- commands ----------

  function describe(a: P2, b: P2): string {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const u = unit();
    const n = (v: number) => fmtN(v, Math.max(decimals(), 2));
    return t('Distance {d} · ΔX {dx} · ΔY {dy} · Angle {angle}°', { d: `${n(d)}${u ? ` ${u}` : ''}`, dx: n(dx), dy: n(dy), angle: ang.toFixed(2) });
  }

  function newEntity(n: Omit<NewEntity, 'layer'>): NewEntity {
    return { ...n, layer: curLayer, ...(curColor !== 256 ? { color: curColor } : {}) };
  }

  async function add(list: Omit<NewEntity, 'layer'>[]) {
    await run({ type: 'add', list: list.map(newEntity) });
  }

  async function clickPoint(p: P2) {
    if (!scene) return;
    const last = pts[pts.length - 1];
    switch (tool) {
      case 'line':
        if (last && (last[0] !== p[0] || last[1] !== p[1])) await add([{ type: 'LINE', pts: [last, p] }]);
        pts = [p];
        break;
      case 'polyline': {
        if (pts.length >= 2) {
          const [fx, fy] = toScreen(pts[0]);
          const [px, py] = toScreen(p);
          if (Math.hypot(fx - px, fy - py) < 6) return finish(true);
        }
        if (!last || last[0] !== p[0] || last[1] !== p[1]) pts = [...pts, p];
        break;
      }
      case 'rect':
        if (!last) pts = [p];
        else {
          const q = rectCorner(last, p);
          pts = [];
          if (q[0] !== last[0] && q[1] !== last[1])
            await add([
              {
                type: 'LWPOLYLINE',
                closed: true,
                pts: [last, [q[0], last[1]], q, [last[0], q[1]]],
              },
            ]);
        }
        break;
      case 'circle':
        if (!last) pts = [p];
        else {
          const r = Math.hypot(p[0] - last[0], p[1] - last[1]);
          pts = [];
          if (r > 0) await add([{ type: 'CIRCLE', pts: [last], r }]);
        }
        break;
      case 'arc':
        if (pts.length < 2) pts = [...pts, p];
        else {
          const a = arc3(pts[0], pts[1], p);
          pts = [];
          if (a) await add([{ type: 'ARC', pts: [[a.cx, a.cy]], r: a.r, a0: a.a0, a1: a.a1 }]);
        }
        break;
      case 'text': {
        const s = await ui.prompt(t('Text'), '', t('Add'));
        if (s) await add([{ type: 'TEXT', pts: [p], text: s, h: textHeight || autoTextHeight() }]);
        break;
      }
      case 'measure':
        if (pts.length !== 1) {
          pts = [p];
          measureText = '';
        } else {
          pts = [pts[0], p];
          measureText = describe(pts[0], p);
        }
        break;
      case 'move':
      case 'copy':
      case 'rotate':
      case 'scale': {
        if (!sel.length) return;
        if (!last) {
          pts = [p];
          if (tool === 'scale') scaleRef = refLength(p);
          return;
        }
        const m = opMatrix(p, false);
        if (!m) return;
        await applyTransform(m);
        break;
      }
    }
    redrawOverlay();
  }

  async function applyTransform(m: M) {
    if (tool === 'copy') {
      // Keep copying from the same base point; keep the originals selected.
      const keep = sel;
      await run({ type: 'copy', ids: sel, m });
      setSel(keep);
      return;
    }
    await run({ type: 'transform', ids: sel, m });
    pts = [];
    tool = 'select';
  }

  /** Scale reference: from the base point to the farthest corner of the selection. */
  function refLength(b: P2): number {
    if (!scene) return 1;
    let r = 0;
    const [bx, by] = rel(b);
    for (const e of sel) {
      const k = e * 4;
      if (!(scene.boxes[k] <= scene.boxes[k + 2])) continue;
      for (const x of [scene.boxes[k], scene.boxes[k + 2]]) for (const y of [scene.boxes[k + 1], scene.boxes[k + 3]]) r = Math.max(r, Math.hypot(x - bx, y - by));
    }
    return r || 1;
  }

  function autoTextHeight(): number {
    // About 18 px tall at the current zoom, rounded to a nice value.
    const raw = 18 / view.z;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
  }

  /** Enter / right-click / double-click: finish the command in progress. */
  async function finish(close = false) {
    if (tool === 'polyline' && pts.length >= 2) {
      const list = pts;
      pts = [];
      await add([{ type: 'LWPOLYLINE', pts: list, closed: close && list.length > 2 }]);
    } else if (pts.length) pts = [];
    else if (tool !== 'select') tool = 'select';
    cmd = '';
    redrawOverlay();
  }

  async function submitCmd() {
    const s = cmd.trim();
    cmd = '';
    area?.focus();
    if (!s) return finish();
    const n = Number(s);
    const last = pts[pts.length - 1];
    if (last && Number.isFinite(n)) {
      if (tool === 'rotate') return applyTransform(rotateAbout((n * Math.PI) / 180, last[0], last[1]));
      if (tool === 'scale') return n > 0 ? applyTransform(scaleAbout(n, last[0], last[1])) : undefined;
      if (tool === 'circle') return clickPoint([last[0] + n, last[1]]);
    }
    const p = parsePoint(s, last ?? null, cursor);
    if (!p) {
      ui.toast(t('Type a point as x,y · @dx,dy · length<angle, or a length.'), 'warning');
      return;
    }
    cursor = p;
    await clickPoint(p);
  }

  function setTool(next: CadTool) {
    if (TRANSFORM_TOOLS.includes(next) && !sel.length) {
      ui.toast(t('Select the objects first, then choose this tool.'), 'info');
      next = 'select';
    }
    if ((DRAW_TOOLS.includes(next) || TRANSFORM_TOOLS.includes(next)) && !editable) return;
    tool = next;
    pts = [];
    measureText = '';
    cmd = '';
    snapHit = null;
    redrawOverlay();
    area?.focus();
  }

  async function doOp(o: CadOp) {
    switch (o) {
      case 'undo':
      case 'redo':
        if (pts.length) pts = [];
        await run({ type: o });
        break;
      case 'delete':
        if (sel.length && editable) await run({ type: 'remove', ids: sel });
        break;
      case 'duplicate':
        if (sel.length && editable && scene) {
          // Offset by 5 % of the view so the copy is visible.
          const d = gridStep(view.z, 24);
          await run({ type: 'copy', ids: sel, m: translate(d, -d) });
        }
        break;
      case 'selectAll':
        if (info) setSel(Array.from({ length: info.entities }, (_, i) => i).filter((i) => !(scene && scene.boxes[i * 4] > scene.boxes[i * 4 + 2]) && !locked(i)));
        break;
      case 'escape':
        if (cmd) cmd = '';
        else if (pts.length) pts = [];
        else if (tool !== 'select') tool = 'select';
        else setSel([]);
        measureText = '';
        redrawOverlay();
        break;
      case 'enter':
        await finish();
        break;
      case 'backspace':
        if (pts.length) pts = pts.slice(0, -1);
        redrawOverlay();
        break;
      case 'fit':
        fit();
        break;
      case 'zoomIn':
      case 'zoomOut':
        zoomAt(size.w / 2, size.h / 2, o === 'zoomIn' ? 1.5 : 1 / 1.5);
        break;
      case 'snap':
        snapOn = !snapOn;
        break;
      case 'grid':
        gridOn = !gridOn;
        redraw();
        break;
      case 'ortho':
        orthoOn = !orthoOn;
        break;
      case 'exportSvg':
        await exportSvg();
        break;
      case 'exportPng':
        await exportPng();
        break;
    }
  }

  // ---------- panels ----------

  async function toggleHidden(name: string) {
    if (!info) return;
    const hidden = info.layers.filter((l) => l.hidden !== (l.name === name)).map((l) => l.name);
    await run({ type: 'hidden', names: hidden });
  }

  async function newLayer() {
    const name = (await ui.prompt(t('New layer name'), '', t('Create')))?.trim();
    if (!name) return;
    if (!layerNames.includes(name)) extraLayers = [...extraLayers, name];
    curLayer = name;
    if (sel.length && editable && (await ui.confirm(t('Move the selection?'), tn('Put the {n} selected object on “{name}”?', 'Put the {n} selected objects on “{name}”?', sel.length, { name }), t('Move', {}, 'layer')))) await run({ type: 'setLayer', ids: sel, layer: name });
  }

  function selectLayer(name: string) {
    if (!scene) return;
    const k = scene.layers.indexOf(name);
    setSel(Array.from({ length: scene.entLayer.length }, (_, i) => i).filter((i) => scene!.entLayer[i] === k && !(scene!.boxes[i * 4] > scene!.boxes[i * 4 + 2])));
  }

  const swatch = (c: number) => (c === 256 || c === 0 ? '' : c === 7 ? (dark ? '#e8e8e8' : '#161616') : (ACI_RGB[c] ?? ''));
  const fmtProp = (p: Prop) => (p.kind === 'num' && p.value !== '' ? String(+(+p.value).toFixed(6)) : p.value);

  // ---------- export ----------

  async function exportSvg() {
    if (!scene) return;
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.svg`);
    let path = await api.SaveFileDialog(t('Export SVG'), base, [{ name: 'SVG', patterns: '*.svg' }]);
    if (!path) return;
    if (extname(path) !== 'svg') path += '.svg';
    try {
      const u = info?.units === 4 ? 'mm' : info?.units === 5 ? 'cm' : info?.units === 1 ? 'in' : '';
      await saveFile(path, toSvg(scene, u));
      const p = path;
      ui.toast(t('Exported SVG'), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e, t('Export failed'));
    }
  }

  async function renderPng(w: number): Promise<Blob> {
    if (canRender) {
      const r = await client.call<{ blob: Blob | null }>({ type: 'png', w });
      if (r.blob) return r.blob;
    }
    const H = fittedHeight(scene!, w);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = H;
    renderFitted(c.getContext('2d')!, scene!, w, H);
    return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('encoding failed')))), 'image/png'));
  }

  async function exportPng() {
    if (!scene?.bounds) return;
    const choice = await ui.pick(t('Export PNG'), [
      { id: '1920', label: t('{w} px wide', { w: '1920' }) },
      { id: '3840', label: t('{w} px wide', { w: '3840' }) },
      { id: '7680', label: t('{w} px wide', { w: '7680' }) },
    ]);
    if (!choice) return;
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`);
    let path = await api.SaveFileDialog(t('Export PNG'), base, [{ name: 'PNG', patterns: '*.png' }]);
    if (!path) return;
    if (extname(path) !== 'png') path += '.png';
    busy = t('Exporting…');
    try {
      await saveFile(path, await renderPng(+choice));
      const p = path;
      ui.toast(t('Exported PNG'), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e, t('Export failed'));
    } finally {
      busy = '';
    }
  }

  // ---------- saving ----------

  async function save(): Promise<boolean> {
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeTo(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    const p = await api.SaveFileDialog(t('Save as'), tab.filePath ?? tab.title, [{ name: t('DXF drawing'), patterns: '*.dxf' }]);
    if (!p) return false;
    const ok = await writeTo(p);
    if (ok) tab.retarget(p);
    return ok;
  }

  async function writeTo(path: string): Promise<boolean> {
    busy = t('Saving…');
    try {
      const r = await client.call<{ entry: { size: number }; info: CadInfo }>({ type: 'save', path, token: sessionToken() });
      tab.size = r.entry.size;
      info = r.info;
      tab.dirty = false;
      return true;
    } catch (e) {
      toastError(e, t('Save failed'));
      return false;
    } finally {
      busy = '';
    }
  }

  // ---------- wiring ----------

  cadViews.set(tab.id, { tool: setTool, op: (o) => void doOp(o), editable: () => editable });

  $effect(() => {
    void dark;
    redraw();
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ' && !spaceDown) {
      spaceDown = true;
      e.preventDefault();
      return;
    }
    // Typing a number or coordinate goes to the command line.
    if (tool !== 'select' && tool !== 'pan' && !e.ctrlKey && !e.metaKey && !e.altKey && /^[-0-9.,@<]$/.test(e.key)) {
      e.preventDefault();
      cmd += e.key;
      cmdInput?.focus();
    }
  }

  (tab as unknown as { cadTest: unknown }).cadTest = {
    info: () => info,
    scene: () => scene,
    view: () => view,
    sel: () => sel,
    setSel,
    tool: () => tool,
    setTool,
    pts: () => pts,
    props: () => objProps,
    clickWorld: (x: number, y: number) => clickPoint([x, y]),
    toScreen: (x: number, y: number) => toScreen([x, y]),
    op: doOp,
    run,
    setProp: (code: number, occ: number, value: string) => run({ type: 'setProp', index: sel[0], code, occ, value }),
    typeCmd: async (t: string) => {
      cmd = t;
      await submitCmd();
    },
    save,
    svg: () => (scene ? toSvg(scene) : ''),
    png: renderPng,
    measureText: () => measureText,
    longest: () => ({ base: longestBase, painter: longestPainter, render: longestRender, worker: canRender }),
    frameReady: () => !!frame && frame.version === sceneVersion,
    toggleHidden,
    setLayer: (l: string) => (curLayer = l),
    canvas: () => base,
  };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      reload: load,
      onShow: () => (resize(), status()),
      focus: () => area?.focus(),
    };
    const ro = new ResizeObserver(resize);
    if (area) ro.observe(area);
    void load();
    return () => {
      ro.disconnect();
      cadViews.delete(tab.id);
      client.destroy();
    };
  });
</script>

<div class="toolbar" use:fitBar>
  {#if narrow && info}<button class="icon-btn" class:on={panelOpen} title={t('Properties and layers')} onclick={() => (panelOpen = !panelOpen)}><Icon icon={PanelRight} /></button>{/if}
  {#if editable}
    <button class="icon-btn" title={t('Undo ({key})', { key: formatShortcut('Mod+Z') })} disabled={!info?.canUndo} onclick={() => doOp('undo')}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title={t('Redo ({key})', { key: formatShortcut('Mod+Shift+Z') })} disabled={!info?.canRedo} onclick={() => doOp('redo')}><Icon icon={Redo2} /></button>
    <button class="icon-btn" title={t('Delete selected objects ({key})', { key: 'Del' })} disabled={!sel.length} onclick={() => doOp('delete')}><Icon icon={Trash} /></button>
    <span class="sep"></span>
    <label class="opt" title={t('Layer for new objects')}>
      {t('Layer')}
      <select class="input sel" bind:value={curLayer}>
        {#each layerNames as l (l)}<option value={l}>{l}</option>{/each}
      </select>
    </label>
    <button class="icon-btn" title={t('New layer…')} onclick={newLayer}><Icon icon={Plus} /></button>
    <label class="opt" title={t('Colour for new objects')}>
      {t('Colour')}
      <select class="input sel" bind:value={curColor}>
        {#each ACI as [n, l] (n)}<option value={n}>{l}</option>{/each}
      </select>
    </label>
    {#if tool === 'text'}
      <label class="opt" title={t('Text height in drawing units (empty: about {px} px at the current zoom)', { px: 18 })}>{t('Height')} <input class="input num" type="number" min="0" step="any" value={textHeight || ''} placeholder={t('auto')} onchange={(e) => (textHeight = +(e.currentTarget as HTMLInputElement).value || 0)} /></label>
    {/if}
    <span class="sep"></span>
  {/if}
  <button class="icon-btn" class:on={snapOn} title={t('Object snap: ends, midpoints, centres, quadrants ({key})', { key: formatShortcut('F3') })} aria-pressed={snapOn} onclick={() => doOp('snap')}><Icon icon={Magnet} /></button>
  <button class="icon-btn" class:on={gridOn} title={t('Grid: show it and snap to it ({key})', { key: formatShortcut('F7') })} aria-pressed={gridOn} onclick={() => doOp('grid')}><Icon icon={Grid} /></button>
  <button class="icon-btn" class:on={orthoOn} title={t('Ortho: horizontal and vertical only ({key}; hold Shift to flip it)', { key: formatShortcut('F8') })} aria-pressed={orthoOn} onclick={() => doOp('ortho')}><Icon icon={Crosshair} /></button>
  <button class="icon-btn" title={t('Zoom to drawing ({key})', { key: formatShortcut('Mod+0') })} onclick={() => doOp('fit')}><Icon icon={Maximize} /></button>
  <span class="spacer"></span>
  {#if busy}<span class="label"><span class="spinner inline"></span> {busy}</span>{/if}
  {#if info}<span class="label">{tn('{n} object', '{n} objects', info.entities)} · {tn('{n} layer', '{n} layers', info.layers.length)}{unit() ? ` · ${unit()}` : ''}</span>{/if}
  <button class="icon-btn" title={t('Export…')} onclick={(e) => menu.show(e, [
      { label: t('Export as SVG…'), run: () => doOp('exportSvg') },
      { label: t('Export as PNG…'), run: () => doOp('exportPng') },
    ])}><Icon icon={Download} /></button>
  <button class="icon-btn" title={t('Open as text')} onclick={() => ((tab.moduleId = 'text'), workspace.touch())}><Icon icon={FileText} /></button>
</div>

<div class="body" bind:clientWidth={bodyW}>
  <div class="tools" role="toolbar" aria-orientation="vertical" aria-label={t('CAD tools')}>
    {#each toolGroups as group, gi (gi)}
      {#if gi}<span class="hsep"></span>{/if}
      {#each group.filter((t) => editable || !t.edit) as t (t.id)}
        <button class="icon-btn" class:on={tool === t.id} title="{t.label} ({t.key}) — {t.help}" aria-label={t.label} data-tool={t.id} onclick={() => setTool(t.id)}><Icon icon={t.icon} /></button>
      {/each}
    {/each}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="area"
    class:draw={tool !== 'select' && tool !== 'pan'}
    class:pan={tool === 'pan'}
    bind:this={area}
    tabindex="0"
    role="application"
    aria-label={t('Drawing')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={() => ((hover = -1), (snapHit = null), redrawOverlay())}
    onwheel={onWheel}
    oncontextmenu={onContext}
    ondblclick={() => tool === 'polyline' && finish()}
    onkeydown={onKeyDown}
    onkeyup={(e) => e.key === ' ' && (spaceDown = false)}
  >
    <canvas bind:this={base}></canvas>
    <canvas bind:this={over} class="over"></canvas>
    {#if tool !== 'select' && tool !== 'pan'}
      <div class="cmdline">
        <span class="prompt">
          {#if tool === 'measure'}{measureText || (pts.length ? t('Click the second point') : t('Click the first point'))}
          {:else if tool === 'line'}{pts.length ? t('Next point — or type a length, x,y, @dx,dy, len<angle · Esc ends') : t('First point')}
          {:else if tool === 'polyline'}{pts.length ? t('Next point · click the first point to close · Enter finishes') : t('First point')}
          {:else if tool === 'rect'}{pts.length ? t('Opposite corner — or @width,height') : t('First corner')}
          {:else if tool === 'circle'}{pts.length ? t('Point on the circle — or type the radius') : t('Centre')}
          {:else if tool === 'arc'}{[t('Start point'), t('A point on the arc'), t('End point')][pts.length]}
          {:else if tool === 'text'}{t('Click where the text starts')}
          {:else if tool === 'rotate'}{pts.length ? t('Direction — or type the angle in degrees') : t('Centre of rotation')}
          {:else if tool === 'scale'}{pts.length ? t('Drag out the size — or type the factor') : t('Base point')}
          {:else}{pts.length ? t('Where it goes — or @dx,dy') : t('Base point')}{/if}
        </span>
        <input
          class="input"
          bind:this={cmdInput}
          bind:value={cmd}
          placeholder={t('type…')}
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submitCmd();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cmd = '';
              area?.focus();
            }
          }}
        />
      </div>
    {:else if measureText}
      <div class="cmdline"><span class="prompt">{measureText}</span></div>
    {/if}
    {#if error}<div class="empty-state overlay">{error}</div>{/if}
    {#if loading && !error}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
    {#if info && !info.entities && !loading}<div class="empty-state overlay hint">{t('This drawing is empty. Pick a drawing tool on the left to start.')}</div>{/if}
  </div>
  {#if info && (!narrow || panelOpen)}
    <aside data-sidepanel class="panel" class:floating={narrow} class:right={narrow}>
      <div class="ptabs">
        <button class:on={panel === 'props'} onclick={() => (panel = 'props')}>{t('Properties')}</button>
        <button class:on={panel === 'layers'} onclick={() => (panel = 'layers')}>{t('Layers')}</button>
      </div>
      {#key sceneVersion}
        {#if panel === 'props'}
          <div class="pbody">
            {#if !sel.length}
              <p class="muted">{t('Nothing selected. Click an object, or drag a window around several.')}</p>
              <dl>
                {#each Object.entries(info.counts).sort((a, b) => b[1] - a[1]) as [type, n] (type)}<dt>{type}</dt><dd>{num(n)}</dd>{/each}
              </dl>
            {:else}
              <div class="head">{sel.length === 1 && objProps ? objProps.type : tn('{n} object', '{n} objects', sel.length)}{objProps?.handle ? ` · #${objProps.handle}` : ''}</div>
              {#if editable}
                <label class="row">{t('Layer')}
                  <select class="input" value={sel.length === 1 && objProps ? objProps.layer : ''} onchange={(e) => run({ type: 'setLayer', ids: sel, layer: (e.currentTarget as HTMLSelectElement).value })}>
                    {#if !(sel.length === 1 && objProps)}<option value="" disabled>—</option>{/if}
                    {#each layerNames as l (l)}<option value={l}>{l}</option>{/each}
                  </select>
                </label>
                <label class="row">{t('Colour')}
                  <select class="input" value={sel.length === 1 && objProps && !objProps.trueColor ? objProps.color : -1} onchange={(e) => run({ type: 'setColor', ids: sel, color: +(e.currentTarget as HTMLSelectElement).value })}>
                    <option value={-1} disabled>{objProps?.trueColor ? t('True colour') : '—'}</option>
                    {#each ACI as [n, l] (n)}<option value={n}>{l}</option>{/each}
                    {#if objProps && !ACI.some(([n]) => n === objProps!.color) && !objProps.trueColor}<option value={objProps.color}>ACI {objProps.color}</option>{/if}<!-- i18n-ignore: AutoCAD Color Index -->
                  </select>
                  {#if objProps && swatch(objProps.color)}<span class="sw" style:background={swatch(objProps.color)}></span>{/if}
                </label>
              {/if}
              {#if sel.length === 1 && objProps}
                {#each objProps.props as p (p.label)}
                  <label class="row">{PROP_LABELS[p.label] ?? p.label}
                    {#if p.kind === 'ro' || !editable}<span class="ro">{fmtProp(p) || '—'}</span>
                    {:else if p.kind === 'flag'}<input type="checkbox" checked={p.value === '1'} onchange={(e) => run({ type: 'setProp', index: sel[0], code: p.code, occ: p.occ, value: (e.currentTarget as HTMLInputElement).checked ? '1' : '0' })} />
                    {:else if p.kind === 'text'}<textarea class="input" rows="2" value={p.value.replace(/\\P/g, '\n')} onchange={(e) => run({ type: 'setProp', index: sel[0], code: p.code, occ: p.occ, value: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
                    {:else}<input class="input" type="number" step="any" value={fmtProp(p)} placeholder={t('default')} onchange={(e) => run({ type: 'setProp', index: sel[0], code: p.code, occ: p.occ, value: (e.currentTarget as HTMLInputElement).value })} />{/if}
                  </label>
                {/each}
                {#if objProps.length !== undefined}<div class="row">{t('Length')} <span class="ro">{fmtN(objProps.length, 4)}{unit() ? ` ${unit()}` : ''}</span></div>{/if}
                {#if objProps.area !== undefined}<div class="row">{t('Area', {}, 'cad')} <span class="ro">{fmtN(objProps.area, 4)}{unit() ? ` ${unit()}²` : ''}</span></div>{/if}
                {#if !objProps.editable}<p class="muted">{t('This object can be recoloured, moved to another layer or deleted, but not moved or reshaped here.')}</p>{/if}
              {/if}
            {/if}
          </div>
        {:else}
          <div class="pbody layers">
            {#each info.layers as l (l.name)}
              <div class="layer" class:cur={l.name === curLayer} class:off={l.off || l.hidden}>
                <button class="icon-btn sm" title={l.off ? t('Off or frozen in the file') : l.hidden ? t('Show this layer') : t('Hide this layer (view only, not saved)')} disabled={l.off} onclick={() => toggleHidden(l.name)}><Icon icon={l.off || l.hidden ? EyeOff : Eye} size={14} /></button>
                <span class="sw" style:background={css(l.color, dark)}></span>
                <button class="name" title={t('Make this the layer for new objects')} onclick={() => (curLayer = l.name)}>{l.name}</button>
                {#if l.locked}<span title={t("Locked: can't be selected")}><Icon icon={Lock} size={12} /></span>{/if}
                <button class="count" title={t('Select everything on this layer')} onclick={() => selectLayer(l.name)}>{num(l.count)}</button>
              </div>
            {/each}
            {#if editable}<button class="btn ghost add" onclick={newLayer}><Icon icon={Plus} size={14} /> {t('New layer')}</button>{/if}
          </div>
        {/if}
      {/key}
    </aside>
  {/if}
</div>

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
    background: var(--pasteboard);
    outline: none;
    touch-action: none;
  }
  .area.draw {
    cursor: none;
  }
  .area.pan {
    cursor: grab;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
  .cmdline {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    font-size: var(--fs-small);
    max-width: calc(100% - 20px);
  }
  .cmdline .prompt {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cmdline input {
    width: calc(130px * var(--ui-scale));
    font-family: var(--font-mono);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .sel {
    max-width: calc(140px * var(--ui-scale));
  }
  .num {
    width: calc(70px * var(--ui-scale));
  }
  .panel {
    width: calc(250px * var(--ui-scale));
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
    background: none;
    color: var(--text-muted);
    padding: 6px 10px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font: inherit;
  }
  .ptabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .pbody {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--fs-small);
  }
  .muted {
    color: var(--text-muted);
    margin: 0;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .head {
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: 38% 1fr auto;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .row .input {
    min-width: 0;
    width: 100%;
  }
  .row textarea {
    resize: vertical;
    font: inherit;
  }
  .row input[type='checkbox'] {
    justify-self: start;
  }
  .ro {
    color: var(--text);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--border);
    flex: none;
  }
  .layers {
    gap: 2px;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: var(--radius);
  }
  .layer.cur {
    background: var(--accent-soft);
  }
  .layer.off .name {
    color: var(--text-faint);
  }
  .layer .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 0;
  }
  .layer .count {
    border: none;
    background: none;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .layer .count:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .icon-btn.sm {
    width: 22px;
    height: 22px;
  }
  .add {
    margin-top: 6px;
    align-self: flex-start;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
  .hint {
    pointer-events: none;
  }
</style>
