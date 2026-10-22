<script lang="ts" module>
  import type { CellChange, Range } from './gridOps';
  export interface GridColumn {
    name: string;
    width: number;
  }
  export interface GridSource {
    /** Fetch rows [start, end) of the current view (displayed values). */
    rows(start: number, end: number): Promise<string[][]>;
    /** Raw inputs (formulas) of a block; defaults to the displayed values. */
    inputs?(r0: number, r1: number, c0: number, c1: number): Promise<string[][]>;
  }
  /** A batch of edits: cells to set and ranges to clear. */
  export interface GridEdit {
    cells: CellChange[];
    clear: Range[];
  }
  // What the last copy/cut put on the clipboard, so a paste of the same text
  // can keep formulas and turn a cut into a move (like Excel).
  let lastClip: { text: string; raw: string[][]; origin: Range; cut: boolean; grid: number } | null = null;
  let gridSeq = 0;
</script>

<script lang="ts">
  import { settings } from '../../core/settings.svelte';
  // Virtualized, keyboard-driven table with spreadsheet behaviour: range
  // selection (mouse, Shift+keys, row/column headers), copy/cut/paste as
  // tab-separated text, clear, undo, drag-to-move, fill handle with series,
  // and AutoComplete while typing. Rows are fetched in blocks from the source
  // (a worker or Go) so only what's on screen lives on the main thread; very
  // tall tables use a scaled scrollbar because browsers cap element heights.
  import { tick } from 'svelte';
  import { ui } from '../../core/ui.svelte';
  import { fillSeries, norm, parseTSV, rangeCells, rangeCols, rangeRows, shiftFormula, toTSV, inRange } from './gridOps';
  import { t } from '../../core/i18n';

  let {
    source,
    rowCount,
    columns = $bindable(),
    version = 0,
    editable = false,
    formulas = false,
    sortCol = -1,
    sortDir = 1,
    rowLabel = (i: number) => String(i + 1),
    onsort,
    onedit,
    onapply,
    onundo,
    onredo,
    oncomplete,
    onselection,
    oncursor,
    onheaderedit,
    oncontext,
  }: {
    source: GridSource;
    rowCount: number;
    columns: GridColumn[];
    version?: number;
    editable?: boolean;
    /** Cells may hold formulas: copying/filling shifts their relative references. */
    formulas?: boolean;
    sortCol?: number;
    sortDir?: number;
    rowLabel?: (i: number) => string;
    onsort?: (col: number) => void;
    onedit?: (row: number, col: number, value: string) => Promise<void> | void;
    onapply?: (edit: GridEdit, label: string) => Promise<boolean | void> | boolean | void;
    onundo?: () => Promise<{ row: number; col: number } | void> | void;
    onredo?: () => Promise<{ row: number; col: number } | void> | void;
    oncomplete?: (col: number, typed: string) => Promise<string | null>;
    onselection?: (sel: Range) => void;
    oncursor?: (row: number, col: number) => void;
    onheaderedit?: (col: number) => void;
    oncontext?: (e: MouseEvent, row: number, col: number) => void;
  } = $props();

  const id = ++gridSeq;
  const NUMERIC = /^\s*[-+]?(\d{1,3}([ ,]\d{3})*|\d+)([.,]\d+)?([eE][-+]?\d+)?\s*%?\s*$/;
  // Row height follows the interface scale; CSS reads it from --row.
  const ROW = $derived(Math.round(28 * (settings.value.uiScale || 1)));
  const HEAD = $derived(Math.round(32 * (settings.value.uiScale || 1)));
  const BLOCK = 200;
  const MAX_PX = 8_000_000;
  const MAX_EDIT_CELLS = 1_000_000;
  const MAX_COPY_CELLS = 2_000_000;
  const NUM_W = $derived(Math.max(48, String(rowCount).length * 8 + 22));

  let scroller = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewH = $state(400);
  let viewW = $state(800);
  let cache = $state(new Map<number, string[][]>());
  let pending = new Set<number>();
  let cur = $state({ row: 0, col: 0 }); // active cell
  let anchor = $state({ row: 0, col: 0 }); // other corner of the selection
  let cutRange = $state<Range | null>(null);
  let ghost = $state<{ range: Range; kind: 'move' | 'fill' } | null>(null);
  let editing = $state<{ row: number; col: number; value: string } | null>(null);
  let editInput = $state<HTMLInputElement>();
  let cacheVersion = -1;
  let busy = false;

  const sel = $derived(norm(anchor, cur));
  const totalH = $derived(rowCount * ROW);
  const scaled = $derived(totalH > MAX_PX);
  const spacerH = $derived(scaled ? MAX_PX : totalH);
  const bodyH = $derived(Math.max(0, viewH - HEAD));
  const visibleCount = $derived(Math.ceil(bodyH / ROW) + 1);
  // Virtual scroll position in "real" row pixels. Rows sit at r * ROW inside
  // one container moved by a single transform, so scrolling only moves that
  // container and adds/removes a few rows.
  const virtualTop = $derived.by(() => {
    if (!scaled) return scrollTop;
    const maxScroll = Math.max(1, spacerH - bodyH);
    return (Math.min(scrollTop, maxScroll) / maxScroll) * Math.max(0, totalH - bodyH);
  });
  const first = $derived(Math.max(0, Math.floor(virtualTop / ROW)));
  const last = $derived(Math.min(rowCount - 1, first + visibleCount));
  const totalW = $derived(NUM_W + columns.reduce((a, c) => a + c.width, 0));
  const visibleRows = $derived(Array.from({ length: Math.max(0, Math.min(visibleCount, rowCount - first)) }, (_, i) => first + i));
  const lefts = $derived.by(() => {
    const out = [NUM_W];
    for (const c of columns) out.push(out[out.length - 1] + c.width);
    return out;
  });

  $effect(() => {
    // Source changed (sort, filter, edit): drop cached blocks.
    if (version !== cacheVersion) {
      cacheVersion = version;
      cache = new Map();
      pending.clear();
    }
    const a = Math.floor(first / BLOCK);
    const b = Math.floor((first + visibleCount) / BLOCK);
    for (let k = a; k <= b; k++) load(k, version);
  });

  $effect(() => {
    onselection?.(sel);
  });

  function load(block: number, v: number) {
    if (cache.has(block) || pending.has(block) || block * BLOCK >= rowCount) return;
    pending.add(block);
    source
      .rows(block * BLOCK, Math.min(rowCount, (block + 1) * BLOCK))
      .then((r) => {
        if (v !== cacheVersion) return;
        const next = new Map(cache);
        next.set(block, r);
        // Keep memory bounded.
        if (next.size > 60) next.delete(next.keys().next().value!);
        cache = next;
      })
      .finally(() => pending.delete(block));
  }

  function cell(row: number, col: number): string | undefined {
    const b = cache.get(Math.floor(row / BLOCK));
    if (!b) return undefined;
    return b[row % BLOCK]?.[col] ?? '';
  }

  function rowTop(row: number): number {
    return HEAD + row * ROW - virtualTop;
  }

  /** Scroll so `row` is visible. */
  function reveal(row: number) {
    if (!scroller) return;
    if (!scaled) {
      const top = row * ROW;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + ROW > scroller.scrollTop + bodyH) scroller.scrollTop = top + ROW - bodyH;
    } else if (row < first || row >= first + visibleCount - 1) {
      const maxScroll = Math.max(1, spacerH - bodyH);
      const target = row < first ? row : row - visibleCount + 2;
      scroller.scrollTop = (Math.max(0, target) / Math.max(1, rowCount - visibleCount + 1)) * maxScroll;
    }
    scrollTop = scroller.scrollTop;
  }

  function revealCol(col: number) {
    if (!scroller) return;
    const x = lefts[col] ?? NUM_W;
    const w = columns[col]?.width ?? 0;
    if (x - NUM_W < scroller.scrollLeft) scroller.scrollLeft = x - NUM_W;
    else if (x + w > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = x + w - scroller.clientWidth;
    scrollLeft = scroller.scrollLeft;
  }

  const clampRow = (r: number) => Math.max(0, Math.min(rowCount - 1, r));
  const clampCol = (c: number) => Math.max(0, Math.min(columns.length - 1, c));

  /** Move the active cell; with `extend` the anchor stays (Shift). */
  export function moveTo(row: number, col: number, extend = false) {
    cur = { row: clampRow(row), col: clampCol(col) };
    if (!extend) anchor = { ...cur };
    reveal(cur.row);
    revealCol(cur.col);
    oncursor?.(cur.row, cur.col);
  }

  /** Select a range; the active cell is its top-left unless given. */
  export function select(r: Range, active?: { row: number; col: number }, show = true) {
    const a = active ?? { row: r.r0, col: r.c0 };
    cur = { row: clampRow(a.row), col: clampCol(a.col) };
    anchor = { row: clampRow(a.row === r.r0 ? r.r1 : r.r0), col: clampCol(a.col === r.c0 ? r.c1 : r.c0) };
    if (show) {
      reveal(cur.row);
      revealCol(cur.col);
    }
    oncursor?.(cur.row, cur.col);
  }

  export function focus() {
    scroller?.focus();
  }

  export function cursor() {
    return { ...cur };
  }

  export function selection(): Range {
    return { ...sel };
  }

  // ---------- data access ----------

  /** Values of a block: displayed, or raw inputs (formulas) when `raw`. */
  async function block(r: Range, raw = false): Promise<string[][]> {
    if (raw && source.inputs) return source.inputs(r.r0, r.r1, r.c0, r.c1);
    const out: string[][] = [];
    for (let s = r.r0; s <= r.r1; s += 5000) {
      const rows = await source.rows(s, Math.min(r.r1 + 1, s + 5000));
      for (const row of rows) out.push(Array.from({ length: rangeCols(r) }, (_, k) => row[r.c0 + k] ?? ''));
    }
    // Rows past the end read as empty.
    while (out.length < rangeRows(r)) out.push(Array(rangeCols(r)).fill(''));
    return out;
  }

  async function apply(edit: GridEdit, label: string, after?: Range) {
    if (!editable || !onapply) return false;
    const n = edit.cells.length + edit.clear.reduce((a, r) => a + rangeCells(r), 0);
    if (edit.cells.length > MAX_EDIT_CELLS) {
      ui.toast(t('That’s {n} cells — too many to change at once. Select fewer.', { n }), 'warning');
      return false;
    }
    busy = true;
    try {
      const ok = (await onapply(edit, label)) !== false;
      if (ok && after) select(after, undefined, false);
      return ok;
    } finally {
      busy = false;
    }
  }

  // ---------- editing ----------

  async function startEdit(initial?: string) {
    if (!editable || rowCount === 0) return;
    anchor = { ...cur };
    let v = initial;
    if (v === undefined) {
      v = cell(cur.row, cur.col) ?? '';
      if (formulas && source.inputs) v = (await source.inputs(cur.row, cur.row, cur.col, cur.col))[0]?.[0] ?? v;
    }
    editing = { row: cur.row, col: cur.col, value: v };
    await tick();
    editInput?.focus();
    if (initial === undefined) editInput?.select();
    else editInput?.setSelectionRange(v.length, v.length);
    if (initial !== undefined) void complete();
  }

  async function commit(move: 'down' | 'right' | 'none' = 'none') {
    const e = editing;
    if (!e) return;
    editing = null;
    if (e.value !== (cell(e.row, e.col) ?? '')) await onedit?.(e.row, e.col, e.value);
    if (move === 'down') moveTo(e.row + 1, e.col);
    else if (move === 'right') moveTo(e.row, e.col + 1);
    scroller?.focus();
  }

  /** Excel-style AutoComplete: propose the rest of a matching entry, selected. */
  async function complete() {
    const e = editing;
    const input = editInput;
    if (!e || !input || !oncomplete) return;
    const typed = input.value;
    if (input.selectionStart !== typed.length || typed.startsWith('=')) return;
    const match = await oncomplete(e.col, typed).catch(() => null);
    if (!match || editing !== e || input.value !== typed || !match.toLowerCase().startsWith(typed.toLowerCase())) return;
    const value = typed + match.slice(typed.length);
    e.value = value;
    input.value = value;
    input.setSelectionRange(typed.length, value.length);
  }

  function editInputEvent(ev: Event) {
    const ie = ev as InputEvent;
    if (ie.inputType === 'insertText' || ie.inputType === 'insertCompositionText') void complete();
  }

  function editKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commit('down');
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      void commit('right');
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      editing = null;
      scroller?.focus();
    }
    ev.stopPropagation();
  }

  // ---------- clipboard ----------

  function writeClipboard(text: Promise<string>) {
    // Start the write inside the key gesture (WebKit), with the text arriving later.
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        void navigator.clipboard
          .write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })])
          .catch(() => text.then((t) => navigator.clipboard.writeText(t)).catch(() => {}));
        return;
      }
    } catch {
      /* fall through */
    }
    void text.then((t) => navigator.clipboard?.writeText(t)).catch(() => {});
  }

  /** Copy (or cut) the selection; returns the tab-separated text. */
  export function copy(cut = false): Promise<string> {
    const r = { ...sel };
    if (rangeCells(r) > MAX_COPY_CELLS) {
      ui.toast(t('That selection is too large to copy. Select fewer cells.'), 'warning');
      return Promise.resolve('');
    }
    const text = (async () => {
      const shown = await block(r);
      const raw = formulas && source.inputs ? await block(r, true) : shown;
      const t = toTSV(shown);
      lastClip = { text: t, raw, origin: r, cut: cut && editable, grid: id };
      return t;
    })();
    cutRange = cut && editable ? r : null;
    writeClipboard(text);
    return text;
  }

  let pastedAt = 0;
  async function readAndPaste() {
    try {
      const t = await navigator.clipboard.readText();
      if (Date.now() - pastedAt > 1000) await pasteText(t);
    } catch {
      /* the paste event handles it, or there's nothing to paste */
    }
  }

  function onPasteEvent(e: ClipboardEvent) {
    if (editing) return;
    const t = e.clipboardData?.getData('text/plain');
    if (t === undefined) return;
    e.preventDefault();
    pastedAt = Date.now();
    void pasteText(t);
  }

  /** Paste tab-separated text at the selection, like Excel. */
  export async function pasteText(text: string) {
    if (!editable || busy) return;
    const clip = lastClip && lastClip.text === text ? lastClip : null;
    const values = clip ? clip.raw : parseTSV(text);
    if (!values.length) return;
    const h = values.length;
    const w = Math.max(...values.map((r) => r.length));
    // One cell fills the selection; a block tiles it when the sizes divide
    // evenly; otherwise it lands at the active corner with its own size.
    let target: Range;
    if ((h === 1 && w === 1) || (rangeRows(sel) % h === 0 && rangeCols(sel) % w === 0 && rangeCells(sel) > 1)) target = { ...sel };
    else target = { r0: sel.r0, c0: sel.c0, r1: sel.r0 + h - 1, c1: sel.c0 + w - 1 };
    if (target.c1 >= columns.length) {
      target.c1 = columns.length - 1;
      ui.toast(t('Some pasted columns didn’t fit and were left out.'), 'info');
    }
    const move = !!clip && clip.cut && clip.grid === id;
    const cells: { row: number; col: number; value: string }[] = [];
    for (let r = target.r0; r <= target.r1; r++) {
      for (let c = target.c0; c <= target.c1; c++) {
        const i = (r - target.r0) % h;
        const j = (c - target.c0) % w;
        let v = values[i]?.[j] ?? '';
        if (clip && formulas && !move) {
          // Shift relative references by how far this copy lands from its origin.
          v = shiftFormula(v, r - i - clip.origin.r0, c - j - clip.origin.c0);
        }
        cells.push({ row: r, col: c, value: v });
      }
    }
    const clear: Range[] = [];
    if (move) {
      // Cut + paste = move: empty the origin cells the paste didn't cover.
      for (let r = clip!.origin.r0; r <= clip!.origin.r1; r++)
        for (let c = clip!.origin.c0; c <= clip!.origin.c1; c++)
          if (!inRange(target, r, c)) clear.push({ r0: r, c0: c, r1: r, c1: c });
      lastClip = null;
      cutRange = null;
    }
    await apply({ cells, clear: mergeCells(clear) }, move ? 'Move' : 'Paste', target);
  }

  /** Join single-cell clear ranges into row runs to keep messages small. */
  function mergeCells(rs: Range[]): Range[] {
    const out: Range[] = [];
    for (const r of rs) {
      const p = out[out.length - 1];
      if (p && p.r0 === r.r0 && p.r1 === r.r1 && p.c1 + 1 === r.c0) p.c1 = r.c1;
      else out.push({ ...r });
    }
    return out;
  }

  export async function clearSelection() {
    await apply({ cells: [], clear: [{ ...sel }] }, 'Clear', { ...sel });
  }

  // ---------- fill ----------

  /** Fill from the selection into `to` (which contains it and extends it in one direction). */
  export async function fillTo(to: Range, series = true) {
    const src = { ...sel };
    let dir: 'down' | 'up' | 'right' | 'left';
    if (to.r1 > src.r1) dir = 'down';
    else if (to.r0 < src.r0) dir = 'up';
    else if (to.c1 > src.c1) dir = 'right';
    else if (to.c0 < src.c0) dir = 'left';
    else return;
    const raw = await block(src, true);
    const vertical = dir === 'down' || dir === 'up';
    const n = vertical ? rangeRows(src) : rangeCols(src);
    const count = vertical ? rangeRows(to) - n : rangeCols(to) - n;
    const lines = vertical ? rangeCols(src) : rangeRows(src);
    const cells: { row: number; col: number; value: string }[] = [];
    for (let l = 0; l < lines; l++) {
      let vals = vertical ? raw.map((r) => r[l]) : raw[l];
      const back = dir === 'up' || dir === 'left';
      if (back) vals = [...vals].reverse();
      const hasFormula = formulas && vals.some((v) => v.startsWith('='));
      const out = hasFormula || !series ? [] : fillSeries(vals, count);
      for (let t = 0; t < count; t++) {
        let v = out[t];
        const s = t % n;
        if (v === undefined) {
          // Copy the pattern; formulas move with the distance from their source cell.
          const d = (n + t - s) * (back ? -1 : 1);
          v = formulas ? shiftFormula(vals[s], vertical ? d : 0, vertical ? 0 : d) : vals[s];
        }
        const k = back ? -(t + 1) : n + t; // offset from the selection's first row/column
        const row = vertical ? src.r0 + k : src.r0 + l;
        const col = vertical ? src.c0 + l : src.c0 + k;
        cells.push({ row, col, value: v });
      }
    }
    await apply({ cells, clear: [] }, 'Fill', to);
  }

  /** Ctrl+D / Ctrl+R: copy the first row (or column) of the selection over the rest. */
  async function fillDownRight(down: boolean) {
    const s = { ...sel };
    if (down ? s.r1 === s.r0 : s.c1 === s.c0) {
      // One row/column selected: copy from the one above/left, like Excel.
      if (down ? s.r0 === 0 : s.c0 === 0) return;
      const from = down ? { ...s, r0: s.r0 - 1, r1: s.r0 - 1 } : { ...s, c0: s.c0 - 1, c1: s.c0 - 1 };
      const keep = { ...s };
      select(from, undefined, false);
      await fillTo(down ? { ...from, r1: keep.r1 } : { ...from, c1: keep.c1 }, false);
      select(keep, undefined, false);
      return;
    }
    const head = down ? { ...s, r1: s.r0 } : { ...s, c1: s.c0 };
    select(head, undefined, false);
    await fillTo(s, false);
  }

  // ---------- move ----------

  /** Move (or copy) the selection by whole cells. */
  export async function moveSelection(dRow: number, dCol: number, copyCells = false) {
    const src = { ...sel };
    const to: Range = { r0: src.r0 + dRow, r1: src.r1 + dRow, c0: src.c0 + dCol, c1: src.c1 + dCol };
    if ((dRow === 0 && dCol === 0) || to.r0 < 0 || to.c0 < 0 || to.c1 >= columns.length) return;
    const raw = await block(src, true);
    const existing = await block(to);
    const overwrites = existing.some((r, i) => r.some((v, j) => v !== '' && (copyCells || !inRange(src, to.r0 + i, to.c0 + j))));
    if (overwrites && !(await ui.confirm(t('Replace the cells there?'), t('The destination already has data.'), t('Replace')))) return;
    const cells: { row: number; col: number; value: string }[] = [];
    raw.forEach((r, i) =>
      r.forEach((v, j) => cells.push({ row: to.r0 + i, col: to.c0 + j, value: copyCells && formulas ? shiftFormula(v, dRow, dCol) : v })),
    );
    const clear: Range[] = [];
    if (!copyCells) {
      for (let r = src.r0; r <= src.r1; r++) for (let c = src.c0; c <= src.c1; c++) if (!inRange(to, r, c)) clear.push({ r0: r, c0: c, r1: r, c1: c });
    }
    await apply({ cells, clear: mergeCells(clear) }, copyCells ? 'Copy' : 'Move', to);
  }

  // ---------- keyboard ----------

  async function undoRedo(redo: boolean) {
    const at = await (redo ? onredo : onundo)?.();
    if (at) moveTo(at.row, at.col);
  }

  function key(ev: KeyboardEvent) {
    if (editing) return;
    const page = Math.max(1, visibleCount - 2);
    const mod = ev.ctrlKey || ev.metaKey;
    const shift = ev.shiftKey;
    let { row, col } = cur;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (mod && !ev.altKey) {
      switch (k) {
        case 'a':
          ev.preventDefault();
          select({ r0: 0, c0: 0, r1: rowCount - 1, c1: columns.length - 1 }, { row: cur.row, col: cur.col }, false);
          return;
        case 'c':
        case 'x':
          ev.preventDefault();
          void copy(k === 'x');
          return;
        case 'v':
          // The paste event usually brings the text; read it directly too.
          void readAndPaste();
          return;
        case 'z':
          ev.preventDefault();
          void undoRedo(shift);
          return;
        case 'y':
          ev.preventDefault();
          void undoRedo(true);
          return;
        case 'd':
        case 'r':
          if (!editable) return;
          ev.preventDefault();
          void fillDownRight(k === 'd');
          return;
        case ' ':
          ev.preventDefault();
          select({ r0: 0, c0: sel.c0, r1: rowCount - 1, c1: sel.c1 }, { row: cur.row, col: cur.col }, false);
          return;
      }
    }
    switch (ev.key) {
      case 'ArrowDown':
        row = mod ? rowCount - 1 : row + 1;
        break;
      case 'ArrowUp':
        row = mod ? 0 : row - 1;
        break;
      case 'ArrowRight':
        col = mod ? columns.length - 1 : col + 1;
        break;
      case 'ArrowLeft':
        col = mod ? 0 : col - 1;
        break;
      case 'PageDown':
        row += page;
        break;
      case 'PageUp':
        row -= page;
        break;
      case 'Home':
        if (mod) row = 0;
        col = 0;
        break;
      case 'End':
        if (mod) row = rowCount - 1;
        col = columns.length - 1;
        break;
      case 'Tab':
        ev.preventDefault();
        moveTo(row, col + (shift ? -1 : 1));
        return;
      case 'Enter':
      case 'F2':
        ev.preventDefault();
        void startEdit();
        return;
      case 'Escape':
        if (cutRange) {
          cutRange = null;
          lastClip = null;
        } else anchor = { ...cur };
        return;
      case ' ':
        if (shift) {
          ev.preventDefault();
          select({ r0: sel.r0, c0: 0, r1: sel.r1, c1: columns.length - 1 }, { row: cur.row, col: cur.col }, false);
          return;
        }
        if (editable) {
          ev.preventDefault();
          void startEdit(' ');
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (editable && !mod) {
          ev.preventDefault();
          if (rangeCells(sel) === 1) void onedit?.(cur.row, cur.col, '');
          else void clearSelection();
        }
        return;
      default:
        if (editable && ev.key.length === 1 && !mod && !ev.altKey) {
          ev.preventDefault();
          void startEdit(ev.key);
        }
        return;
    }
    ev.preventDefault();
    moveTo(row, col, shift);
  }

  // ---------- pointer ----------

  // Column resizing.
  let resizing: { col: number; x: number; w: number } | null = null;
  function resizeStart(e: PointerEvent, col: number) {
    e.stopPropagation();
    resizing = { col, x: e.clientX, w: columns[col].width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function resizeMove(e: PointerEvent) {
    if (!resizing) return;
    columns[resizing.col].width = Math.max(40, resizing.w + e.clientX - resizing.x);
  }
  function resizeEnd() {
    resizing = null;
  }

  /** The cell under a pointer (rows/cols may be past the edges: clamped by callers). */
  function cellAt(clientX: number, clientY: number): { row: number; col: number; rowHeader: boolean } {
    const r = scroller!.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top - HEAD + virtualTop;
    const row = Math.floor(y / ROW);
    const cx = x + scroller!.scrollLeft;
    let col = columns.length - 1;
    for (let c = 0; c < columns.length; c++) {
      if (cx < lefts[c + 1]) {
        col = c;
        break;
      }
    }
    if (cx < NUM_W) col = 0;
    return { row, col, rowHeader: x < NUM_W };
  }

  function capture(pointerId: number) {
    try {
      scroller?.setPointerCapture(pointerId);
    } catch {
      /* synthetic events (tests) have no active pointer */
    }
  }

  type Drag = { kind: 'select' | 'rows' | 'cols' | 'move' | 'fill'; start: { row: number; col: number }; copy?: boolean };
  let drag: Drag | null = null;
  let lastPointer = { x: 0, y: 0 };
  let autoScroll = 0;
  let hoverCursor = $state('');

  /** Where the pointer is relative to the selection: on its border, its fill handle, or neither. */
  function selectionPart(clientX: number, clientY: number): 'border' | 'handle' | null {
    if (!editable || !scroller) return null;
    const r = scroller.getBoundingClientRect();
    const x = clientX - r.left + scroller.scrollLeft;
    const y = clientY - r.top - HEAD + virtualTop;
    const L = lefts[sel.c0];
    const R = lefts[sel.c1 + 1];
    const T = sel.r0 * ROW;
    const B = (sel.r1 + 1) * ROW;
    if (Math.abs(x - R) <= 5 && Math.abs(y - B) <= 5) return 'handle';
    const near = 4;
    const insideX = x >= L - near && x <= R + near;
    const insideY = y >= T - near && y <= B + near;
    if (!insideX || !insideY) return null;
    if (Math.abs(x - L) <= near || Math.abs(x - R) <= near || Math.abs(y - T) <= near || Math.abs(y - B) <= near) return 'border';
    return null;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !scroller || resizing) return;
    if ((e.target as HTMLElement).closest('.editor')) return;
    // Clicks on the scrollbars aren't cell clicks.
    const box = scroller.getBoundingClientRect();
    if (e.clientX >= box.left + scroller.clientWidth || e.clientY >= box.top + scroller.clientHeight) return;
    if (editing) void commit();
    const c = cellAt(e.clientX, e.clientY);
    const part = selectionPart(e.clientX, e.clientY);
    capture(e.pointerId);
    scroller.focus();
    lastPointer = { x: e.clientX, y: e.clientY };
    if (part === 'handle') {
      drag = { kind: 'fill', start: { row: sel.r1, col: sel.c1 } };
      e.preventDefault();
      return;
    }
    if (part === 'border') {
      drag = { kind: 'move', start: { row: clampRow(c.row), col: clampCol(c.col) }, copy: e.ctrlKey || e.metaKey || e.altKey };
      e.preventDefault();
      return;
    }
    if (c.rowHeader) {
      const row = clampRow(c.row);
      if (e.shiftKey) select({ r0: Math.min(anchor.row, row), c0: 0, r1: Math.max(anchor.row, row), c1: columns.length - 1 }, { row: anchor.row, col: 0 }, false);
      else select({ r0: row, c0: 0, r1: row, c1: columns.length - 1 }, { row, col: 0 }, false);
      drag = { kind: 'rows', start: { row: e.shiftKey ? anchor.row : row, col: 0 } };
      return;
    }
    const row = clampRow(c.row);
    const col = clampCol(c.col);
    if (e.shiftKey) moveTo(row, col, true);
    else moveTo(row, col);
    drag = { kind: 'select', start: { row: anchor.row, col: anchor.col } };
  }

  function onDblClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.td') && !e.shiftKey) void startEdit();
  }

  function colHeaderDown(e: PointerEvent, col: number) {
    if (e.button !== 0 || resizing) return;
    if ((e.target as HTMLElement).closest('.rz, .sortbtn')) return;
    if (editing) void commit();
    scroller?.focus();
    capture(e.pointerId);
    const from = e.shiftKey ? anchor.col : col;
    select({ r0: 0, c0: Math.min(from, col), r1: rowCount - 1, c1: Math.max(from, col) }, { row: 0, col: from }, false);
    drag = { kind: 'cols', start: { row: 0, col: from } };
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  function dragTo(clientX: number, clientY: number) {
    if (!drag) return;
    const c = cellAt(clientX, clientY);
    const row = clampRow(c.row);
    const col = clampCol(c.col);
    switch (drag.kind) {
      case 'select':
        cur = { row, col };
        anchor = drag.start;
        oncursor?.(row, col);
        break;
      case 'rows':
        select({ r0: Math.min(drag.start.row, row), c0: 0, r1: Math.max(drag.start.row, row), c1: columns.length - 1 }, { row: drag.start.row, col: 0 }, false);
        break;
      case 'cols':
        select({ r0: 0, c0: Math.min(drag.start.col, col), r1: rowCount - 1, c1: Math.max(drag.start.col, col) }, { row: 0, col: drag.start.col }, false);
        break;
      case 'move': {
        const dr = Math.max(-sel.r0, row - drag.start.row);
        const dc = Math.max(-sel.c0, Math.min(columns.length - 1 - sel.c1, col - drag.start.col));
        ghost = { kind: 'move', range: { r0: sel.r0 + dr, r1: sel.r1 + dr, c0: sel.c0 + dc, c1: sel.c1 + dc } };
        break;
      }
      case 'fill': {
        // Extend in the direction the pointer went furthest from the selection.
        const down = row - sel.r1;
        const up = sel.r0 - row;
        const right = col - sel.c1;
        const left = sel.c0 - col;
        const best = Math.max(down, up, right, left);
        let r: Range = { ...sel };
        if (best > 0) {
          if (best === down) r = { ...sel, r1: row };
          else if (best === up) r = { ...sel, r0: row };
          else if (best === right) r = { ...sel, c1: col };
          else r = { ...sel, c0: col };
        }
        ghost = { kind: 'fill', range: r };
        break;
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (resizing) return;
    if (!drag) {
      const part = selectionPart(e.clientX, e.clientY);
      hoverCursor = part === 'handle' ? 'crosshair' : part === 'border' ? 'move' : '';
      return;
    }
    dragTo(e.clientX, e.clientY);
    // Scroll while dragging near or past an edge.
    if (!autoScroll) autoScroll = requestAnimationFrame(scrollStep);
  }

  function scrollStep() {
    autoScroll = 0;
    if (!drag || !scroller) return;
    const r = scroller.getBoundingClientRect();
    const { x, y } = lastPointer;
    let dy = 0;
    let dx = 0;
    if (y > r.bottom - 16) dy = Math.min(60, y - (r.bottom - 16));
    else if (y < r.top + HEAD + 8 && drag.kind !== 'cols') dy = -Math.min(60, r.top + HEAD + 8 - y);
    if (x > r.right - 16) dx = Math.min(60, x - (r.right - 16));
    else if (x < r.left + NUM_W && drag.kind !== 'rows') dx = -Math.min(60, r.left + NUM_W - x);
    if (!dx && !dy) return;
    scroller.scrollTop += dy;
    scroller.scrollLeft += dx;
    scrollTop = scroller.scrollTop;
    scrollLeft = scroller.scrollLeft;
    dragTo(x, y);
    autoScroll = requestAnimationFrame(scrollStep);
  }

  async function onPointerUp() {
    const d = drag;
    drag = null;
    cancelAnimationFrame(autoScroll);
    autoScroll = 0;
    const g = ghost;
    ghost = null;
    if (!d || !g) return;
    if (d.kind === 'move') await moveSelection(g.range.r0 - sel.r0, g.range.c0 - sel.c0, d.copy);
    else if (d.kind === 'fill') await fillTo(g.range);
  }

  function onContext(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.head')) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c.rowHeader) return;
    const row = clampRow(c.row);
    const col = clampCol(c.col);
    if (!inRange(sel, row, col)) moveTo(row, col);
    oncontext?.(e, row, col);
  }

  function colLeft(col: number) {
    return lefts[col] ?? NUM_W;
  }

  // Overlay rectangles, clipped to the rows on screen (ranges can span millions of rows).
  function rect(r: Range) {
    const top = Math.max(r.r0, first - 1);
    const bottom = Math.min(r.r1, last + 1);
    if (bottom < top) return null;
    return {
      top: top * ROW,
      height: (bottom - top + 1) * ROW,
      left: colLeft(r.c0),
      width: colLeft(r.c1 + 1) - colLeft(r.c0),
      openTop: top > r.r0,
      openBottom: bottom < r.r1,
    };
  }
  const selRect = $derived(rect(sel));
  const cutRect = $derived(cutRange ? rect(cutRange) : null);
  const ghostRect = $derived(ghost ? rect(ghost.range) : null);
  const handleVisible = $derived(editable && !!onapply && sel.r1 <= last + 1 && sel.r1 >= first - 1);

  /** Tooltip of a column header: what clicking it does. */
  function headerTitle(name: string): string {
    const sort = !!onsort;
    const rename = !!(editable && onheaderedit);
    if (sort && rename) return t('{name} — click to select the column, ▾ to sort, double-click to rename', { name });
    if (sort) return t('{name} — click to select the column, ▾ to sort', { name });
    if (rename) return t('{name} — click to select the column, double-click to rename', { name });
    return t('{name} — click to select the column', { name });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="grid"
  bind:this={scroller}
  style:--row="{ROW}px"
  style:--head="{HEAD}px"
  bind:clientHeight={viewH}
  bind:clientWidth={viewW}
  style:cursor={hoverCursor || null}
  onscroll={() => ((scrollTop = scroller!.scrollTop), (scrollLeft = scroller!.scrollLeft))}
  tabindex="0"
  role="grid"
  aria-rowcount={rowCount}
  aria-multiselectable="true"
  onkeydown={key}
  onpaste={onPasteEvent}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={onContext}
  ondblclick={onDblClick}
>
  <div class="layer" style:height="{viewH}px" style:width="{totalW}px">
    <div class="head" style:height="{HEAD}px">
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="num corner"
        style:width="{NUM_W}px"
        title={t('Select all')}
        onpointerdown={(e) => {
          e.stopPropagation();
          select({ r0: 0, c0: 0, r1: rowCount - 1, c1: columns.length - 1 }, undefined, false);
          scroller?.focus();
        }}
      ></div>
      {#each columns as c, i (i)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
        <div
          class="th"
          class:selcol={i >= sel.c0 && i <= sel.c1}
          class:fullcol={sel.r0 === 0 && sel.r1 === rowCount - 1 && i >= sel.c0 && i <= sel.c1}
          style:width="{c.width}px"
          role="columnheader"
          title={headerTitle(c.name)}
          onpointerdown={(e) => {
            e.stopPropagation();
            colHeaderDown(e, i);
          }}
          ondblclick={() => onheaderedit?.(i)}
        >
          <span class="tn">{c.name}</span>
          {#if onsort}
            <button
              class="sortbtn"
              class:on={sortCol === i}
              title={t('Sort by {column}', { column: c.name })}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                onsort?.(i);
              }}>{sortCol === i ? (sortDir > 0 ? '▲' : '▼') : '▾'}</button
            >
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="rz" onpointerdown={(e) => resizeStart(e, i)} onpointermove={resizeMove} onpointerup={resizeEnd} onclick={(e) => e.stopPropagation()}></span>
        </div>
      {/each}
    </div>
    <div class="rows" style:transform="translate3d(0, {HEAD - virtualTop}px, 0)">
      {#each visibleRows as r (r)}
        <div class="tr" class:cur-row={r === cur.row} style:top="{r * ROW}px" role="row">
          <div class="num" class:selrow={r >= sel.r0 && r <= sel.r1} class:fullrow={sel.c0 === 0 && sel.c1 === columns.length - 1 && r >= sel.r0 && r <= sel.r1} style:width="{NUM_W}px">{rowLabel(r)}</div>
          {#each columns as c, i (i)}
            {@const v = cell(r, i)}
            <div
              class="td"
              class:cur={r === cur.row && i === cur.col}
              class:loading={v === undefined}
              class:numeric={!!v && NUMERIC.test(v)}
              style:width="{c.width}px"
              role="gridcell"
              aria-selected={r >= sel.r0 && r <= sel.r1 && i >= sel.c0 && i <= sel.c1}
              title={v && v.length > 40 ? v : undefined}
            >
              {v ?? ''}
            </div>
          {/each}
        </div>
      {/each}
      {#if selRect && rangeCells(sel) > 1}
        <div class="selrect" class:open-top={selRect.openTop} class:open-bottom={selRect.openBottom} style:top="{selRect.top}px" style:left="{selRect.left}px" style:width="{selRect.width}px" style:height="{selRect.height}px"></div>
      {/if}
      {#if cutRect}
        <div class="cutrect" style:top="{cutRect.top}px" style:left="{cutRect.left}px" style:width="{cutRect.width}px" style:height="{cutRect.height}px"></div>
      {/if}
      {#if ghostRect}
        <div class="ghost" class:fill={ghost?.kind === 'fill'} style:top="{ghostRect.top}px" style:left="{ghostRect.left}px" style:width="{ghostRect.width}px" style:height="{ghostRect.height}px"></div>
      {/if}
      {#if handleVisible}
        <div class="handle" title={t('Drag to fill')} style:top="{(sel.r1 + 1) * ROW - 4}px" style:left="{colLeft(sel.c1 + 1) - 4}px"></div>
      {/if}
    </div>
    {#if editing}
      <input
        class="editor"
        bind:this={editInput}
        bind:value={editing.value}
        oninput={editInputEvent}
        onkeydown={editKey}
        onblur={() => commit()}
        style:top="{rowTop(editing.row)}px"
        style:left="{colLeft(editing.col)}px"
        style:width="{Math.max(columns[editing.col].width, 160)}px"
      />
    {/if}
  </div>
  <div style:height="{Math.max(0, spacerH + HEAD - viewH)}px"></div>
</div>

<style>
  .grid {
    position: relative;
    overflow: auto;
    height: 100%;
    outline: none;
    font-size: calc(12.5px * var(--ui-scale));
    font-variant-numeric: tabular-nums;
    user-select: none;
    -webkit-user-select: none;
  }
  .layer {
    position: sticky;
    top: 0;
    overflow: hidden;
  }
  .head {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    z-index: 4;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
  }
  .th {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 10px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    cursor: s-resize;
    border-right: 1px solid var(--border-soft);
    flex: none;
  }
  .th:hover {
    background: var(--bg-hover);
  }
  .th.selcol {
    background: var(--bg-hover);
    color: var(--accent-text);
  }
  .th.fullcol {
    background: var(--accent-soft);
  }
  .tn {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .sortbtn {
    border: none;
    background: transparent;
    color: var(--text-faint);
    font-size: calc(10px * var(--ui-scale));
    padding: 2px 3px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0;
  }
  .th:hover .sortbtn,
  .sortbtn.on {
    opacity: 1;
  }
  .sortbtn.on {
    color: var(--accent-text);
  }
  .sortbtn:hover {
    background: var(--bg-active, var(--bg-hover));
  }
  .rz {
    position: absolute;
    right: -3px;
    top: 0;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }
  .rows {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
  .tr {
    position: absolute;
    left: 0;
    height: var(--row);
    display: flex;
    border-bottom: 1px solid var(--border-soft);
  }
  .tr.cur-row .num {
    color: var(--text);
  }
  .num {
    flex: none;
    padding: 0 8px;
    text-align: right;
    color: var(--text-faint);
    background: var(--bg-sidebar);
    line-height: var(--row);
    position: sticky;
    left: 0;
    z-index: 2;
    border-right: 1px solid var(--border-soft);
    cursor: e-resize;
  }
  .num.selrow {
    background: var(--bg-hover);
    color: var(--accent-text);
  }
  .num.fullrow {
    background: var(--accent-soft);
  }
  .corner {
    line-height: var(--head);
    cursor: pointer;
  }
  .td {
    flex: none;
    padding: 0 10px;
    line-height: 27px;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    border-right: 1px solid var(--border-soft);
    cursor: cell;
  }
  .td.numeric {
    text-align: right;
  }
  .td.loading {
    color: transparent;
  }
  .td.cur {
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: 2px;
    position: relative;
    z-index: 1;
    background: var(--bg);
  }
  .selrect {
    position: absolute;
    pointer-events: none;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1.5px solid var(--accent);
    z-index: 1;
  }
  .selrect.open-top {
    border-top: none;
  }
  .selrect.open-bottom {
    border-bottom: none;
  }
  .cutrect {
    position: absolute;
    pointer-events: none;
    border: 2px dashed var(--accent);
    z-index: 1;
    animation: ants 0.6s linear infinite;
  }
  @keyframes ants {
    to {
      opacity: 0.55;
    }
  }
  .ghost {
    position: absolute;
    pointer-events: none;
    border: 2px solid var(--text-muted);
    z-index: 2;
  }
  .ghost.fill {
    border-style: dashed;
  }
  .handle {
    position: absolute;
    width: 8px;
    height: 8px;
    background: var(--accent);
    border: 1.5px solid var(--bg);
    border-radius: 1px;
    z-index: 3;
    cursor: crosshair;
  }
  .editor {
    position: absolute;
    height: var(--row);
    z-index: 3;
    padding: 0 9px;
    border: 2px solid var(--accent);
    border-radius: 3px;
    background: var(--bg-input);
    outline: none;
    font: inherit;
    box-shadow: var(--shadow);
    user-select: text;
    -webkit-user-select: text;
  }
</style>
