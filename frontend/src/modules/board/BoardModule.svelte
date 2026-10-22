<script lang="ts">
  import ImageDown from '@lucide/svelte/icons/image-down';
  import FileDown from '@lucide/svelte/icons/file-down';
  import { fitBar } from '../../core/fit';
  // Excalidraw (.excalidraw) and draw.io (.drawio) drawings on one canvas:
  // select, move and resize (handles), draw shapes, connectors that attach to
  // shapes, freehand and text, double-click to edit a label, colours / line
  // width / dash (and Excalidraw's fill style and sloppiness), z-order,
  // duplicate, delete, undo/redo, pan/zoom, draw.io pages, SVG/PNG export.
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Pointer from '@lucide/svelte/icons/mouse-pointer-2';
  import Square from '@lucide/svelte/icons/square';
  import Circle from '@lucide/svelte/icons/circle';
  import Diamond from '@lucide/svelte/icons/diamond';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Minus from '@lucide/svelte/icons/minus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Type from '@lucide/svelte/icons/type';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Copy from '@lucide/svelte/icons/copy';
  import BringToFront from '@lucide/svelte/icons/bring-to-front';
  import SendToBack from '@lucide/svelte/icons/send-to-back';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import { theme } from '../../core/theme.svelte';
  import { settings } from '../../core/settings.svelte';
  import { DARK_FILTER, IMAGE_UNDO, darkColor, isLight } from '../../core/canvas';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, readFile, saveFile } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { formatShortcut } from '../../core/keys';
  import { toastError, ui, type MenuItem } from '../../core/ui.svelte';
  import { t, tn } from '../../core/i18n';
  import type { BoardAdapter, BoardItem, BoardStyle, Box, Pt, TextEdit, Tool } from './types';
  import { union } from './types';
  import { ExcalidrawBoard } from './excalidraw';
  import { DrawioBoard, expandFile } from './drawio';
  import virgilUrl from './fonts/Virgil-Regular.woff2?url';

  let { tab }: { tab: Tab } = $props();

  const isDrawio = /\.(drawio|dio)$/i.test(tab.path ?? tab.title);
  let board = $state<BoardAdapter | null>(null);
  let version = $state(0);
  let error = $state('');
  let tool = $state<Tool>('select');
  let sel = $state<string[]>([]);
  let view = $state({ x: 0, y: 0, zoom: 1 });
  let stage = $state<HTMLDivElement>();
  let content = $state<SVGGElement>();
  let editing = $state<{ id: string; edit: TextEdit; value: string } | null>(null);
  let textarea = $state<HTMLTextAreaElement>();
  let pageNames = $state<string[]>([]);
  let page = $state(0);
  let wasCompressed = false;
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let spaceDown = false;
  const ro = $derived(!!tab.readOnly);
  // In the dark theme a light drawing is shown through Excalidraw's dark-mode
  // filter (the file keeps its colours; images are flipped back).
  const paper = $derived(board?.background() ?? '');
  const lightPaper = $derived(!!board && isLight(paper));
  const dark = $derived(theme.darkCanvas && lightPaper);
  const unflip = `mf-unflip-${Math.random().toString(36).slice(2)}`;

  // ---------- text measurement ----------

  const mctx = document.createElement('canvas').getContext('2d')!;
  const widths = new Map<string, number>();
  function measure(text: string, font: string): number {
    const k = `${font}\u0000${text}`;
    let w = widths.get(k);
    if (w === undefined) {
      mctx.font = font;
      w = mctx.measureText(text).width;
      if (widths.size > 20000) widths.clear();
      widths.set(k, w);
    }
    return w;
  }

  let fontReady: Promise<void> | null = null;
  function loadFont(): Promise<void> {
    fontReady ??= (async () => {
      if ([...document.fonts].some((f) => f.family === 'HiaVirgil')) return;
      const face = new FontFace('HiaVirgil', `url(${virgilUrl})`);
      document.fonts.add(await face.load());
    })().catch(() => {});
    return fontReady;
  }

  // ---------- loading and saving ----------

  async function load() {
    error = '';
    try {
      if (!tab.filePath) throw new Error(t('Drawings inside archives can be viewed after extracting them.'));
      const text = new TextDecoder().decode(await readFile(tab.filePath));
      if (isDrawio) {
        const ex = await expandFile(text);
        wasCompressed = ex.compressed;
        const b = new DrawioBoard(ex.text, measure);
        pageNames = b.pages();
        page = 0;
        board = b;
      } else {
        await loadFont();
        board = new ExcalidrawBoard(text, measure);
      }
      undoStack = [];
      redoStack = [];
      syncUndo();
      sel = [];
      tab.dirty = false;
      bump();
      await tick();
      fit();
      status();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function status() {
    if (!board) return;
    const n = board.items().length;
    tab.status = { ...tab.status, type: isDrawio ? t('draw.io diagram') : t('Excalidraw drawing'), info: `${tn('{n} object', '{n} objects', n)}${sel.length ? ` · ${tn('{n} selected', '{n} selected', sel.length)}` : ''}${isDrawio && pageNames.length > 1 ? ` · ${pageNames[page]}` : ''}` };
  }

  async function save(): Promise<boolean> {
    if (!board) return false;
    if (!tab.filePath || ro) return saveAs();
    return writeTo(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    if (!board) return false;
    const filter = isDrawio ? { name: t('draw.io diagram'), patterns: '*.drawio' } : { name: t('Excalidraw drawing'), patterns: '*.excalidraw' };
    let p = await api.SaveFileDialog(t('Save drawing as'), tab.filePath ?? tab.title, [filter]);
    if (!p) return false;
    const ext = isDrawio ? 'drawio' : 'excalidraw';
    if (extname(p) !== ext && !(isDrawio && extname(p) === 'dio')) p += `.${ext}`;
    const ok = await writeTo(p);
    if (ok && p !== tab.filePath) tab.retarget(p);
    return ok;
  }

  async function writeTo(path: string): Promise<boolean> {
    try {
      commitText();
      const e = await saveFile(path, board!.serialize());
      tab.size = e.size;
      tab.dirty = false;
      if (wasCompressed) {
        wasCompressed = false;
        ui.toast(t('Saved (pages are now stored uncompressed, which draw.io reads as well)'), 'info');
      }
      return true;
    } catch (e) {
      toastError(e, t('Save failed'));
      return false;
    }
  }

  // ---------- rendering ----------

  function bump() {
    version++;
  }

  let frame = 0;
  $effect(() => {
    void version;
    if (!board || !content) return;
    cancelAnimationFrame(frame);
    const b = board;
    const g = content;
    frame = requestAnimationFrame(() => {
      g.innerHTML = b.render();
      status();
    });
  });

  const items = $derived.by((): BoardItem[] => {
    void version;
    return board ? board.items() : [];
  });
  const selBoxes = $derived.by(() => {
    void version;
    return sel.map((id) => board?.item(id)).filter((x): x is BoardItem => !!x);
  });
  const selBox = $derived(selBoxes.length ? union(selBoxes.map((i) => i.box)) : null);
  const selStyle = $derived.by((): BoardStyle | null => {
    void version;
    return board && sel.length ? board.style(sel) : null;
  });
  /** The style new shapes get: the last one chosen (kept in the settings). */
  const BASE: BoardStyle = { stroke: '#1e1e1e', fill: '', width: 2, dash: 'solid', fillStyle: 'solid', roughness: 1, edges: 'round' };
  const current = $derived<BoardStyle>({ ...BASE, ...(settings.value.boardStyle as Partial<BoardStyle> | undefined) });
  /** What the style bar shows: the selection's style, or (while a drawing tool is on) the one new shapes get. */
  const shownStyle = $derived(selStyle ?? (board && !ro && tool !== 'select' ? current : null));

  const toScreen = (p: Pt): Pt => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y });
  function toWorld(e: { clientX: number; clientY: number }): Pt {
    const r = stage!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
  }

  function fit() {
    if (!board || !stage) return;
    const b = board.bounds();
    const r = stage.getBoundingClientRect();
    if (!b.w || !b.h) {
      view = { x: r.width / 2, y: r.height / 2, zoom: 1 };
      return;
    }
    const zoom = Math.min(2, Math.max(0.05, Math.min((r.width - 80) / b.w, (r.height - 80) / b.h)));
    view = { zoom, x: (r.width - b.w * zoom) / 2 - b.x * zoom, y: (r.height - b.h * zoom) / 2 - b.y * zoom };
  }

  function zoomBy(f: number, cx?: number, cy?: number) {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const z = Math.min(8, Math.max(0.05, view.zoom * f));
    view = { zoom: z, x: px - ((px - view.x) * z) / view.zoom, y: py - ((py - view.y) * z) / view.zoom };
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = stage!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else view = { ...view, x: view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY) };
  }

  // ---------- undo ----------

  function snapshot() {
    if (!board) return;
    undoStack.push(board.serialize());
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    syncUndo();
    tab.dirty = true;
  }

  function syncUndo() {
    canUndo = undoStack.length > 0;
    canRedo = redoStack.length > 0;
  }

  function undo() {
    if (!board || !undoStack.length) return;
    commitText();
    redoStack.push(board.serialize());
    board.load(undoStack.pop()!);
    afterHistory();
  }

  function redo() {
    if (!board || !redoStack.length) return;
    undoStack.push(board.serialize());
    board.load(redoStack.pop()!);
    afterHistory();
  }

  function afterHistory() {
    sel = sel.filter((id) => board!.item(id));
    tab.dirty = true;
    syncUndo();
    bump();
  }

  // ---------- pointer interaction ----------

  type Drag =
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'move'; last: Pt; moved: boolean }
    | { kind: 'resize'; handle: string; start: Pt; startBox: Box; boxes: Map<string, Box> }
    | { kind: 'marquee'; start: Pt; now: Pt; add: boolean }
    | { kind: 'create'; start: Pt; now: Pt; startId?: string }
    | { kind: 'draw'; points: Pt[] };
  let drag = $state<Drag | null>(null);

  function hitId(e: PointerEvent | MouseEvent): string | undefined {
    const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    const g = el?.closest('[data-id]');
    return g ? (g.getAttribute('data-id') ?? undefined) : undefined;
  }

  /** The shape under a point, for connectors (not lines/arrows themselves). */
  function shapeAt(e: { clientX: number; clientY: number }, except?: string): string | undefined {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const id = el.closest('[data-id]')?.getAttribute('data-id');
      if (id && id !== except && board?.item(id) && !board.item(id)!.linear) return id;
    }
    return undefined;
  }

  function pointerDown(e: PointerEvent) {
    if (!board || editing) {
      if (editing && !(e.target as Element).closest('textarea')) commitText();
      if (!board) return;
    }
    stage!.focus();
    const w = toWorld(e);
    if (e.button === 1 || spaceDown || (e.button === 0 && ro && !hitId(e))) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      stage!.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    stage!.setPointerCapture(e.pointerId);
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
    if (handle && selBox && !ro) {
      snapshot();
      drag = { kind: 'resize', handle, start: w, startBox: selBox, boxes: new Map(selBoxes.map((i) => [i.id, i.box])) };
      return;
    }
    if (tool === 'select' || ro) {
      const id = hitId(e);
      if (id && board.item(id)) {
        const group = board.expand([id]);
        if (e.shiftKey) sel = group.every((g) => sel.includes(g)) ? sel.filter((s) => !group.includes(s)) : [...new Set([...sel, ...group])];
        else if (!sel.includes(id) && !group.some((g) => sel.includes(g))) sel = group;
        if (!ro) drag = { kind: 'move', last: w, moved: false };
      } else drag = { kind: 'marquee', start: w, now: w, add: e.shiftKey };
      return;
    }
    if (ro) return;
    if (tool === 'text') {
      snapshot();
      const id = board.create('text', w, w);
      styleNew(id, 'text');
      if (id) {
        sel = [id];
        bump();
        void startEdit(id, true);
      }
      tool = 'select';
      return;
    }
    if (tool === 'draw') {
      drag = { kind: 'draw', points: [w] };
      return;
    }
    drag = { kind: 'create', start: w, now: w, startId: tool === 'arrow' || tool === 'line' ? shapeAt(e) : undefined };
  }

  let moveFrame = 0;
  function pointerMove(e: PointerEvent) {
    if (!drag || !board) return;
    const w = toWorld(e);
    const d = drag;
    switch (d.kind) {
      case 'pan':
        view = { ...view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy };
        break;
      case 'move': {
        let dx = w.x - d.last.x;
        let dy = w.y - d.last.y;
        if (!d.moved) {
          if (Math.hypot(dx, dy) * view.zoom < 3) return;
          snapshot();
          d.moved = true;
        }
        if (dx || dy) {
          board.move(sel, dx, dy);
          d.last = w;
          scheduleBump();
        }
        break;
      }
      case 'resize': {
        const nb = resizedBox(d.startBox, d.handle, w.x - d.start.x, w.y - d.start.y, e.shiftKey);
        const sx = d.startBox.w ? nb.w / d.startBox.w : 1;
        const sy = d.startBox.h ? nb.h / d.startBox.h : 1;
        for (const [id, b] of d.boxes) board.resize(id, { x: nb.x + (b.x - d.startBox.x) * sx, y: nb.y + (b.y - d.startBox.y) * sy, w: b.w * sx, h: b.h * sy });
        scheduleBump();
        break;
      }
      case 'marquee':
      case 'create':
        drag = { ...d, now: w };
        break;
      case 'draw':
        d.points.push(w);
        drag = { ...d };
        break;
    }
  }

  function scheduleBump() {
    cancelAnimationFrame(moveFrame);
    moveFrame = requestAnimationFrame(bump);
  }

  function resizedBox(b: Box, h: string, dx: number, dy: number, keep: boolean): Box {
    let x0 = b.x;
    let y0 = b.y;
    let x1 = b.x + b.w;
    let y1 = b.y + b.h;
    if (h.includes('w')) x0 += dx;
    if (h.includes('e')) x1 += dx;
    if (h.includes('n')) y0 += dy;
    if (h.includes('s')) y1 += dy;
    let nb = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(1, Math.abs(x1 - x0)), h: Math.max(1, Math.abs(y1 - y0)) };
    if (keep && b.w && b.h && h.length === 2) {
      const s = Math.max(nb.w / b.w, nb.h / b.h);
      nb = { x: h.includes('w') ? b.x + b.w - b.w * s : b.x, y: h.includes('n') ? b.y + b.h - b.h * s : b.y, w: b.w * s, h: b.h * s };
    }
    return nb;
  }

  function pointerUp(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d || !board) return;
    const w = toWorld(e);
    if (d.kind === 'marquee') {
      const r = { x: Math.min(d.start.x, d.now.x), y: Math.min(d.start.y, d.now.y), w: Math.abs(d.now.x - d.start.x), h: Math.abs(d.now.y - d.start.y) };
      if (r.w * view.zoom < 3 && r.h * view.zoom < 3) {
        if (!d.add) sel = [];
        return;
      }
      const inside = items.filter((i) => i.box.x >= r.x && i.box.y >= r.y && i.box.x + i.box.w <= r.x + r.w && i.box.y + i.box.h <= r.y + r.h).map((i) => i.id);
      sel = d.add ? [...new Set([...sel, ...board.expand(inside)])] : board.expand(inside);
    } else if (d.kind === 'create') {
      snapshot();
      let a = d.start;
      let b = w;
      const tiny = Math.hypot(b.x - a.x, b.y - a.y) * view.zoom < 6;
      if (tiny) {
        if (tool === 'arrow' || tool === 'line') b = { x: a.x + 120, y: a.y };
        else {
          a = { x: a.x - 60, y: a.y - 40 };
          b = { x: a.x + 120, y: a.y + 80 };
        }
      }
      const id = board.create(tool, a, b, { startId: d.startId, endId: tool === 'arrow' || tool === 'line' ? shapeAt(e, d.startId) : undefined });
      styleNew(id, tool);
      if (id) sel = [id];
      tool = 'select';
    } else if (d.kind === 'draw') {
      if (d.points.length > 1) {
        snapshot();
        const id = board.create('draw', d.points[0], d.points[d.points.length - 1], { points: d.points });
        styleNew(id, 'draw');
        if (id) sel = [id];
      }
    }
    bump();
  }

  async function dblclick(e: MouseEvent) {
    if (!board || ro) return;
    const id = hitId(e);
    if (id && board.item(id)) {
      await startEdit(id, false);
      return;
    }
    if (!id && !isDrawio) {
      // As in Excalidraw: double-click on empty canvas adds text.
      snapshot();
      const nid = board.create('text', toWorld(e), toWorld(e));
      styleNew(nid, 'text');
      if (nid) {
        sel = [nid];
        bump();
        await startEdit(nid, true);
      }
    }
  }

  // While a text is being edited, its drawn copy is hidden (the edit box shows it).
  $effect(() => {
    const ids = editing?.edit.hide ?? [];
    if (!ids.length) return;
    const st = document.createElement('style');
    st.textContent = ids.map((id) => `svg.canvas [data-id="${CSS.escape(id)}"] text { visibility: hidden; }`).join('\n');
    document.head.append(st);
    return () => st.remove();
  });

  async function startEdit(id: string, fresh: boolean) {
    const ed = board?.textEdit(id);
    if (!ed) return;
    if (!fresh) snapshot();
    editing = { id, edit: ed, value: ed.text };
    await tick();
    textarea?.focus();
    textarea?.select();
  }

  function commitText() {
    const ed = editing;
    if (!ed || !board) return;
    editing = null;
    board.setText(ed.id, ed.value);
    sel = sel.filter((id) => board!.item(id));
    tab.dirty = true;
    bump();
  }

  function textKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commitText();
      stage?.focus();
    }
  }

  // ---------- commands ----------

  function act(f: () => void) {
    if (!board || ro) return;
    snapshot();
    f();
    bump();
  }
  const del = () => sel.length && act(() => (board!.remove(sel), (sel = [])));
  const dup = () => sel.length && act(() => (sel = board!.duplicate(sel)));
  const front = () => sel.length && act(() => board!.reorder(sel, 'front'));
  const back = () => sel.length && act(() => board!.reorder(sel, 'back'));
  /** Change the selection's style; the change is also what new shapes get from now on. */
  function setStyle(s: Partial<BoardStyle>) {
    settings.update((x) => (x.boardStyle = { ...(x.boardStyle ?? {}), ...s }));
    if (sel.length) act(() => board!.setStyle(sel, s));
  }

  /** A new shape in the current style (only what fits it: text takes the colour, lines no fill). */
  function styleNew(id: string | null, kind: Tool) {
    if (!id || !board) return;
    const want = settings.value.boardStyle as Partial<BoardStyle> | undefined;
    if (!want) return;
    const s: Partial<BoardStyle> = {};
    for (const k of board.styleKeys) if (want[k] !== undefined) (s as Record<string, unknown>)[k] = want[k];
    if (kind === 'text') {
      board.setStyle([id], s.stroke ? { stroke: s.stroke } : {});
      return;
    }
    if (kind === 'arrow' || kind === 'line' || kind === 'draw') {
      delete s.fill;
      delete s.fillStyle;
    }
    if (kind === 'ellipse' || kind === 'draw') delete s.edges;
    board.setStyle([id], s);
  }

  function keydown(e: KeyboardEvent) {
    if (!board || editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === ' ') {
      spaceDown = true;
      e.preventDefault();
      return;
    }
    if (mod && k.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo();
    if (mod && k.toLowerCase() === 'y') return e.preventDefault(), redo();
    if (mod && k.toLowerCase() === 'a') return e.preventDefault(), (sel = items.map((i) => i.id));
    if (mod && k.toLowerCase() === 'd') return e.preventDefault(), dup();
    if (mod && k === ']') return e.preventDefault(), front();
    if (mod && k === '[') return e.preventDefault(), back();
    if (k === 'Delete' || k === 'Backspace') return e.preventDefault(), del();
    if (k === 'Escape') return (tool = 'select'), (sel = []);
    if (k === 'Enter' && sel.length === 1) return e.preventDefault(), void startEdit(sel[0], false);
    if (k.startsWith('Arrow') && sel.length && !ro) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      act(() => board!.move(sel, k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0));
      return;
    }
    if (mod || e.altKey || ro) return;
    const keys: Record<string, Tool> = { v: 'select', '1': 'select', r: 'rect', '2': 'rect', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse', a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', p: 'draw', '7': 'draw', t: 'text', '8': 'text' };
    const t = keys[k.toLowerCase()];
    if (t && board.tools.includes(t)) tool = t;
  }

  /** Right-click: on a shape it is selected (unless already part of the selection) and can be edited, copied, ordered… */
  function contextMenu(e: MouseEvent): MenuItem[] {
    if (!board || !stage?.contains(e.target as Node)) return [];
    commitText();
    const hit = hitId(e);
    if (hit && !sel.includes(hit)) sel = [hit];
    if (!hit && !(e.target as Element).closest('.handle, .selitem')) sel = [];
    const sc = (s: string) => formatShortcut(s);
    const out: MenuItem[] = [];
    if (!ro) {
      out.push({ label: t('Undo'), shortcut: sc('Mod+Z'), disabled: !canUndo, run: undo }, { label: t('Redo'), shortcut: sc('Mod+Shift+Z'), disabled: !canRedo, run: redo }, { separator: true });
      if (sel.length) {
        if (sel.length === 1) out.push({ label: t('Edit text'), shortcut: 'Enter', run: () => void startEdit(sel[0], false) });
        out.push(
          { label: t('Duplicate'), shortcut: sc('Mod+D'), run: dup },
          { label: t('Bring to front'), shortcut: sc('Mod+]'), run: front },
          { label: t('Send to back'), shortcut: sc('Mod+['), run: back },
          { label: t('Delete'), shortcut: 'Del', run: del },
          { separator: true },
        );
      }
    }
    out.push(
      { label: t('Select all'), shortcut: sc('Mod+A'), run: () => (sel = items.map((i) => i.id)) },
      { label: t('Zoom to fit'), run: fit },
      { separator: true },
      { label: t('Export SVG'), run: () => void exportSvg() },
      { label: t('Export PNG'), run: () => void exportPng() },
    );
    return out;
  }

  function keyup(e: KeyboardEvent) {
    if (e.key === ' ') spaceDown = false;
  }

  function setPage(i: number) {
    if (!(board instanceof DrawioBoard)) return;
    commitText();
    board.setPage(i);
    page = i;
    sel = [];
    bump();
    void tick().then(fit);
  }

  // ---------- export ----------

  async function fontCss(): Promise<string> {
    if (isDrawio) return '';
    try {
      const buf = new Uint8Array(await (await fetch(virgilUrl)).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `<style>@font-face{font-family:HiaVirgil;src:url(data:font/woff2;base64,${btoa(s)}) format("woff2")}</style>`;
    } catch {
      return '';
    }
  }

  async function exportSvgText(): Promise<{ svg: string; w: number; h: number }> {
    const b = board!.bounds();
    const pad = 20;
    const w = Math.ceil(b.w + pad * 2);
    const h = Math.ceil(b.h + pad * 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x - pad} ${b.y - pad} ${w} ${h}">${await fontCss()}<rect x="${b.x - pad}" y="${b.y - pad}" width="${w}" height="${h}" fill="${board!.background()}"/>${board!.render()}</svg>`;
    return { svg, w, h };
  }

  async function exportSvg() {
    if (!board) return;
    let p = await api.SaveFileDialog(t('Export SVG'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)}.svg`), [{ name: 'SVG', patterns: '*.svg' }]);
    if (!p) return;
    if (extname(p) !== 'svg') p += '.svg';
    try {
      await saveFile(p, (await exportSvgText()).svg);
      const path = p;
      ui.toast(t('Exported SVG'), 'success', { label: t('Open'), run: () => void workspace.openPath(path) });
    } catch (e) {
      toastError(e, t('Export failed'));
    }
  }

  async function pngTo(path: string, scale = 2): Promise<boolean> {
    try {
      const { svg, w, h } = await exportSvgText();
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('encoding failed')))), 'image/png'));
      await saveFile(path, blob);
      return true;
    } catch (e) {
      toastError(e, t('Export failed'));
      return false;
    }
  }

  async function exportPng() {
    if (!board) return;
    let p = await api.SaveFileDialog(t('Export PNG'), join(dirname(tab.filePath ?? ''), `${stem(tab.title)}.png`), [{ name: 'PNG', patterns: '*.png' }]);
    if (!p) return;
    if (extname(p) !== 'png') p += '.png';
    if (await pngTo(p)) {
      const path = p;
      ui.toast(t('Exported PNG'), 'success', { label: t('Open'), run: () => void workspace.openPath(path) });
    }
  }

  // ---------- wiring ----------

  const TOOL_INFO: Record<Tool, { icon: typeof Pointer; label: string; key: string }> = {
    select: { icon: Pointer, label: t('Select'), key: 'V' },
    rect: { icon: Square, label: t('Rectangle'), key: 'R' },
    diamond: { icon: Diamond, label: t('Diamond'), key: 'D' },
    ellipse: { icon: Circle, label: t('Ellipse'), key: 'O' },
    arrow: { icon: ArrowUpRight, label: t('Arrow (drag from shape to shape to connect)'), key: 'A' },
    line: { icon: Minus, label: t('Line'), key: 'L' },
    draw: { icon: Pencil, label: t('Draw'), key: 'P' },
    text: { icon: Type, label: t('Text'), key: 'T' },
  };
  const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#868e96', '#ffffff'];
  const FILLS = ['', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#eebefa', '#e9ecef', '#ffffff'];

  (tab as unknown as { boardTest: unknown }).boardTest = {
    board: () => board,
    sel: () => sel,
    setSel: (s: string[]) => (sel = s),
    tool: () => tool,
    setTool: (t: Tool) => (tool = t),
    view: () => view,
    toScreen: (p: Pt) => {
      const r = stage!.getBoundingClientRect();
      const s = toScreen(p);
      return { x: s.x + r.left, y: s.y + r.top };
    },
    stage: () => stage,
    content: () => content,
    editing: () => editing,
    setEditValue: (v: string) => editing && (editing.value = v),
    commitText,
    undo,
    redo,
    save,
    pngTo,
    exportSvgText,
    setPage,
    canUndo: () => canUndo,
    contextMenu,
    dark: () => dark,
    version: () => version,
  };

  onMount(() => {
    tab.handlers = { ...tab.handlers, save, saveAs, reload: load, focus: () => stage?.focus(), onShow: status, contextMenu };
    void load();
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="toolbar" use:fitBar>
  {#if !ro}
    {#each board?.tools ?? [] as t (t)}
      <button class="icon-btn" class:on={tool === t} title="{TOOL_INFO[t].label} ({TOOL_INFO[t].key})" aria-label={TOOL_INFO[t].label} onclick={() => (tool = t)}><Icon icon={TOOL_INFO[t].icon} /></button>
    {/each}
    <span class="sep"></span>
    <button class="icon-btn" title={t('Undo ({key})', { key: formatShortcut('Mod+Z') })} disabled={!canUndo} onclick={undo}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title={t('Redo ({key})', { key: formatShortcut('Mod+Shift+Z') })} disabled={!canRedo} onclick={redo}><Icon icon={Redo2} /></button>
    <span class="sep"></span>
    <button class="icon-btn" title={t('Duplicate ({key})', { key: formatShortcut('Mod+D') })} disabled={!sel.length} onclick={dup}><Icon icon={Copy} /></button>
    <button class="icon-btn" title={t('Bring to front ({key})', { key: formatShortcut('Mod+]') })} disabled={!sel.length} onclick={front}><Icon icon={BringToFront} /></button>
    <button class="icon-btn" title={t('Send to back ({key})', { key: formatShortcut('Mod+[') })} disabled={!sel.length} onclick={back}><Icon icon={SendToBack} /></button>
    <button class="icon-btn" title={t('Delete ({key})', { key: 'Del' })} disabled={!sel.length} onclick={del}><Icon icon={Trash} /></button>
  {/if}
  {#if pageNames.length > 1}
    <span class="sep"></span>
    <select class="input page" value={page} onchange={(e) => setPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label={t('Page')}>
      {#each pageNames as p, i (i)}<option value={i}>{p}</option>{/each}
    </select>
  {/if}
  <span class="spacer"></span>
  <button class="icon-btn" title={t('Zoom out')} onclick={() => zoomBy(1 / 1.25)}><Icon icon={ZoomOut} /></button>
  <span class="label zoom">{Math.round(view.zoom * 100)}%</span>
  <button class="icon-btn" title={t('Zoom in')} onclick={() => zoomBy(1.25)}><Icon icon={ZoomIn} /></button>
  <button class="icon-btn" title={t('Fit')} onclick={fit}><Icon icon={Maximize} /></button>
  {#if theme.resolved === 'dark' && lightPaper}
    <button class="icon-btn" class:on={dark} title={dark ? t('Show the drawing light (as in the file)') : t('Darken the drawing to match the theme')} aria-pressed={dark} onclick={() => theme.setDarkCanvas(!dark)}><Icon icon={dark ? Moon : Sun} /></button>
  {/if}
  <button class="btn ghost" onclick={exportSvg} disabled={!board}><Icon icon={FileDown} size={14} /> {t('Export SVG…')}</button>
  <button class="btn ghost" onclick={exportPng} disabled={!board}><Icon icon={ImageDown} size={14} /> {t('Export PNG…')}</button>
</div>

{#if shownStyle && !ro}
  <div class="stylebar" role="toolbar" aria-label={t('Style')}>
    <span class="label">{t('Stroke')}</span>
    {#each STROKES as c (c)}
      <button class="sw" class:on={shownStyle.stroke.toLowerCase() === c} style="background:{c}" title={c} aria-label={t('Stroke {colour}', { colour: c })} onclick={() => setStyle({ stroke: c })}></button>
    {/each}
    <input type="color" value={/^#[0-9a-f]{6}$/i.test(shownStyle.stroke) ? shownStyle.stroke : '#000000'} onchange={(e) => setStyle({ stroke: (e.currentTarget as HTMLInputElement).value })} aria-label={t('Stroke colour')} />
    <span class="sep"></span>
    <span class="label">{t('Fill')}</span>
    {#each FILLS as c (c)}
      <button class="sw" class:none={!c} class:on={shownStyle.fill.toLowerCase() === c} style="background:{c || 'transparent'}" title={c || t('None')} aria-label={c ? t('Fill {colour}', { colour: c }) : t('Fill none')} onclick={() => setStyle({ fill: c })}></button>
    {/each}
    <span class="sep"></span>
    {#each [1, 2, 4] as w (w)}
      <button class="btn ghost small" class:on={shownStyle.width === w} onclick={() => setStyle({ width: w })} title={t('Line width {w}', { w })}>{w === 1 ? t('Thin', {}, 'width') : w === 2 ? t('Bold', {}, 'width') : t('Extra', {}, 'width')}</button>
    {/each}
    <select class="input small" value={shownStyle.dash} onchange={(e) => setStyle({ dash: (e.currentTarget as HTMLSelectElement).value as BoardStyle['dash'] })} aria-label={t('Line style')}>
      <option value="solid">{t('Solid', {}, 'line')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option>
    </select>
    {#if board?.styleKeys.includes('edges')}
      <span class="seg" role="radiogroup" aria-label={t('Edges')}>
        <button class="btn ghost small" role="radio" aria-checked={shownStyle.edges === 'sharp'} class:on={shownStyle.edges === 'sharp'} title={t('Sharp corners')} onclick={() => setStyle({ edges: 'sharp' })}>{t('Sharp')}</button>
        <button class="btn ghost small" role="radio" aria-checked={shownStyle.edges === 'round'} class:on={shownStyle.edges === 'round'} title={t('Rounded corners')} onclick={() => setStyle({ edges: 'round' })}>{t('Round')}</button>
      </span>
    {/if}
    {#if board?.styleKeys.includes('fillStyle')}
      <select class="input small" value={shownStyle.fillStyle} onchange={(e) => setStyle({ fillStyle: (e.currentTarget as HTMLSelectElement).value as BoardStyle['fillStyle'] })} aria-label={t('Fill style')}>
        <option value="hachure">{t('Hatched')}</option><option value="cross-hatch">{t('Cross-hatched')}</option><option value="solid">{t('Solid', {}, 'fill')}</option><option value="zigzag">{t('Zigzag')}</option>
      </select>
      <select class="input small" value={String(shownStyle.roughness)} onchange={(e) => setStyle({ roughness: Number((e.currentTarget as HTMLSelectElement).value) })} aria-label={t('Sloppiness')}>
        <option value="0">{t('Architect')}</option><option value="1">{t('Artist')}</option><option value="2">{t('Cartoonist')}</option>
      </select>
    {/if}
  </div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div
  class="stage"
  class:panning={drag?.kind === 'pan'}
  class:drawing={tool !== 'select' && !ro}
  bind:this={stage}
  tabindex="0"
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  ondblclick={dblclick}
  onwheel={wheel}
  onkeydown={keydown}
  onkeyup={keyup}
  style="background:{board ? (dark ? darkColor(paper) : paper) : 'var(--bg)'}"
>
  {#if error}
    <div class="empty-state">{error}</div>
  {/if}
  <svg class="canvas" class:dark width="100%" height="100%" style:filter={dark ? DARK_FILTER : null} style:--unflip="url(#{unflip})">
    <defs>
      <filter id={unflip} color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values={IMAGE_UNDO} /></filter>
    </defs>
    <g transform="translate({view.x} {view.y}) scale({view.zoom})">
      <g bind:this={content}></g>
    </g>
  </svg>
  <svg class="canvas overlay" width="100%" height="100%">
    <g transform="translate({view.x} {view.y}) scale({view.zoom})">
      {#if selBox && !editing}
        {#each selBoxes as i (i.id)}
          <rect class="selitem" x={i.box.x - 3 / view.zoom} y={i.box.y - 3 / view.zoom} width={i.box.w + 6 / view.zoom} height={i.box.h + 6 / view.zoom} stroke-width={1 / view.zoom} />
        {/each}
        {#if !ro && !(selBoxes.length === 1 && selBoxes[0].linear && (selBox.w < 1 || selBox.h < 1))}
          {#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as h (h)}
            {@const hs = 8 / view.zoom}
            {@const hx = h.includes('w') ? selBox.x : h.includes('e') ? selBox.x + selBox.w : selBox.x + selBox.w / 2}
            {@const hy = h.includes('n') ? selBox.y : h.includes('s') ? selBox.y + selBox.h : selBox.y + selBox.h / 2}
            <rect class="handle {h}" data-handle={h} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} stroke-width={1 / view.zoom} />
          {/each}
        {/if}
      {/if}
      {#if drag?.kind === 'marquee'}
        <rect class="marquee" x={Math.min(drag.start.x, drag.now.x)} y={Math.min(drag.start.y, drag.now.y)} width={Math.abs(drag.now.x - drag.start.x)} height={Math.abs(drag.now.y - drag.start.y)} stroke-width={1 / view.zoom} />
      {:else if drag?.kind === 'create'}
        {#if tool === 'arrow' || tool === 'line'}
          <line class="ghost" x1={drag.start.x} y1={drag.start.y} x2={drag.now.x} y2={drag.now.y} stroke-width={2 / view.zoom} />
        {:else if tool === 'ellipse'}
          <ellipse class="ghost" cx={(drag.start.x + drag.now.x) / 2} cy={(drag.start.y + drag.now.y) / 2} rx={Math.abs(drag.now.x - drag.start.x) / 2} ry={Math.abs(drag.now.y - drag.start.y) / 2} stroke-width={2 / view.zoom} />
        {:else}
          <rect class="ghost" x={Math.min(drag.start.x, drag.now.x)} y={Math.min(drag.start.y, drag.now.y)} width={Math.abs(drag.now.x - drag.start.x)} height={Math.abs(drag.now.y - drag.start.y)} stroke-width={2 / view.zoom} />
        {/if}
      {:else if drag?.kind === 'draw'}
        <polyline class="ghost" points={drag.points.map((p) => `${p.x},${p.y}`).join(' ')} stroke-width={2 / view.zoom} />
      {/if}
    </g>
  </svg>
  {#if editing}
    {@const s = toScreen({ x: editing.edit.box.x, y: editing.edit.box.y })}
    <textarea
      bind:this={textarea}
      bind:value={editing.value}
      class="textedit"
      style="left:{s.x}px; top:{s.y}px; min-width:{Math.max(60, editing.edit.box.w * view.zoom)}px; min-height:{editing.edit.box.h * view.zoom}px; font: {editing.edit.fontSize * view.zoom}px {editing.edit.font}; color:{dark ? darkColor(editing.edit.color) : editing.edit.color}; text-align:{editing.edit.align}"
      onkeydown={textKey}
      onblur={commitText}
      spellcheck="true"
      aria-label={t('Text')}
    ></textarea>
  {/if}
</div>

<style>
  .zoom {
    min-width: 42px;
    text-align: center;
  }
  .page {
    height: 26px;
    max-width: 180px;
  }
  .stylebar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border-soft);
    flex-wrap: wrap;
    font-size: var(--fs-small);
  }
  .sw {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid var(--border);
    padding: 0;
    cursor: pointer;
  }
  .sw.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .sw.none {
    background: linear-gradient(45deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%) !important;
  }
  .stylebar input[type='color'] {
    width: 24px;
    height: 20px;
    padding: 0;
    border: none;
    background: none;
  }
  .small {
    height: 24px;
    font-size: var(--fs-small);
  }
  .btn.on,
  .icon-btn.on {
    background: var(--bg-active);
    color: var(--accent-text);
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    outline: none;
    touch-action: none;
    cursor: default;
  }
  .stage.drawing {
    cursor: crosshair;
  }
  .stage.panning {
    cursor: grabbing;
  }
  .canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
  .canvas.dark :global(image) {
    filter: var(--unflip);
  }
  .overlay {
    pointer-events: none;
  }
  .selitem {
    fill: none;
    stroke: #4a90e2;
    pointer-events: none;
  }
  .handle {
    fill: #fff;
    stroke: #4a90e2;
    pointer-events: all;
  }
  .handle.nw,
  .handle.se {
    cursor: nwse-resize;
  }
  .handle.ne,
  .handle.sw {
    cursor: nesw-resize;
  }
  .handle.n,
  .handle.s {
    cursor: ns-resize;
  }
  .handle.e,
  .handle.w {
    cursor: ew-resize;
  }
  .marquee {
    fill: rgba(74, 144, 226, 0.08);
    stroke: #4a90e2;
    pointer-events: none;
  }
  .ghost {
    fill: none;
    stroke: #4a90e2;
    stroke-dasharray: 4 3;
    pointer-events: none;
  }
  .textedit {
    position: absolute;
    background: transparent;
    border: 1px dashed #4a90e2;
    outline: none;
    resize: none;
    padding: 0;
    margin: 0;
    line-height: 1.25;
    overflow: hidden;
    white-space: pre;
    field-sizing: content;
  }
</style>
