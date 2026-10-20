<script lang="ts">
  // .xlsx / .xlsm / .xls: cells are read and written by Go (excelize), the
  // grid only fetches what's on screen.
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Info from '@lucide/svelte/icons/info';
  import Grid, { type GridColumn, type GridEdit } from '../data/Grid.svelte';
  import { addStats, emptyStats, formatStats, rangeCells, rangeRows, type Range } from '../data/gridOps';
  import { toNumber } from '../data/csv';
  import { formatShortcut } from '../../core/keys';
  import { api } from '../../core/backend';
  import { basename } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { menu, toastError, ui } from '../../core/ui.svelte';
  import { officeControllers } from './controllers';
  import type { office } from '../../wailsjs/go/models';

  let { tab }: { tab: Tab } = $props();

  let book = $state<office.BookInfo | null>(null);
  let sheet = $state('');
  let columns = $state<GridColumn[]>([]);
  let version = $state(0);
  let error = $state('');
  let grid = $state<Grid>();
  let cursor = $state({ row: 0, col: 0 });
  let formula = $state('');
  let formulaEl = $state<HTMLInputElement>();
  let saveAsTarget = $state('');
  const EXTRA_ROWS = 100;
  const EXTRA_COLS = 8;

  const info = $derived(book?.sheets.find((s) => s.name === sheet));
  const rowCount = $derived((info?.rows ?? 0) + EXTRA_ROWS);

  function colName(i: number): string {
    let s = '';
    i++;
    while (i > 0) {
      const r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function setColumns() {
    const n = Math.max(12, (info?.cols ?? 0) + EXTRA_COLS);
    columns = Array.from({ length: n }, (_, i) => ({ name: colName(i), width: columns[i]?.width ?? 110 }));
  }

  const source = {
    rows: (s: number, e: number) => api.SheetRows(book!.id, sheet, s, e, columns.length),
    inputs: (r0: number, r1: number, c0: number, c1: number) => api.SheetInputs(book!.id, sheet, r0, r1, c0, c1),
  };

  // Undo in cell terms: each step keeps what it wrote and what was there before.
  interface Step {
    sheet: string;
    forward: GridEdit;
    back: office.CellEdit[];
  }
  let undoStack: Step[] = [];
  let redoStack: Step[] = [];
  let selStats = '';

  async function open() {
    error = '';
    try {
      if (book) void api.SheetClose(book.id);
      const path = tab.filePath ?? '';
      if (!path) throw new Error('Spreadsheets inside archives open read-only after extracting them.');
      book = await api.SheetOpen(path);
      saveAsTarget = book.saveAs;
      sheet = book.sheets.find((s) => s.name === (tab.restoredState as { sheet?: string })?.sheet)?.name ?? book.sheets[0]?.name ?? '';
      setColumns();
      version++;
      tab.dirty = false;
      await updateCursor(0, 0);
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    }
  }

  async function refreshBook() {
    // Row/column counts change as cells outside the data area are filled.
    const fresh = book!.sheets.map((s) => ({ ...s }));
    book = { ...book!, sheets: fresh } as office.BookInfo;
  }

  async function updateCursor(row: number, col: number) {
    cursor = { row, col };
    if (!book) return;
    try {
      const c = await api.SheetCell(book.id, sheet, row, col);
      formula = c.input;
    } catch {
      formula = '';
    }
    updateStatus();
  }

  function updateStatus() {
    if (!book) return;
    tab.status = { ...tab.status, type: book.format.toUpperCase(), position: selStats || `${colName(cursor.col)}${cursor.row + 1}`, info: `${sheet} · ${info?.rows ?? 0} rows` };
  }

  /** Write a batch (Go recalculates once) and record it for undo. */
  async function write(e: GridEdit, record = true): Promise<boolean> {
    if (!book) return false;
    try {
      const back = await api.SheetSetCells(book.id, sheet, e.cells as office.CellEdit[], e.clear as office.CellRange[]);
      if (record && back.length) {
        undoStack.push({ sheet, forward: e, back });
        if (undoStack.length > 200) undoStack.shift();
        redoStack = [];
      }
      await grown(e.cells);
      tab.dirty = true;
      version++;
      await updateCursor(cursor.row, cursor.col);
      return true;
    } catch (err) {
      toastError(err, 'Could not change the cells');
      return false;
    }
  }

  /** Cells written outside the used area extend the sheet. */
  async function grown(cells: { row: number; col: number; value: string }[]) {
    if (!info || !cells.length) return;
    let r = info.rows;
    let c = info.cols;
    for (const x of cells) {
      if (x.value === '') continue;
      r = Math.max(r, x.row + 1);
      c = Math.max(c, x.col + 1);
    }
    if (r !== info.rows || c !== info.cols) {
      info.rows = r;
      info.cols = c;
      await refreshBook();
      setColumns();
    }
  }

  async function edit(row: number, col: number, value: string) {
    await write({ cells: [{ row, col, value }], clear: [] });
  }

  async function undoRedo(redo: boolean) {
    const st = (redo ? redoStack : undoStack).pop();
    if (!st || !book) return;
    if (st.sheet !== sheet) await switchSheet(st.sheet);
    await write(redo ? st.forward : { cells: st.back, clear: [] }, false);
    (redo ? undoStack : redoStack).push(st);
    const first = redo ? st.forward.cells[0] ?? { row: st.forward.clear[0]?.r0 ?? 0, col: st.forward.clear[0]?.c0 ?? 0 } : st.back[0];
    return first ? { row: first.row, col: first.col } : undefined;
  }

  // Excel-style "Average · Count · Sum" for multi-cell selections.
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  let statsSeq = 0;
  function onSelection(r: Range) {
    clearTimeout(statsTimer);
    if (rangeCells(r) <= 1 || !book) {
      if (selStats) {
        selStats = '';
        updateStatus();
      }
      return;
    }
    const seq = ++statsSeq;
    statsTimer = setTimeout(async () => {
      // Only the used area holds values.
      const r1 = Math.min(r.r1, (info?.rows ?? 0) - 1);
      const s = emptyStats();
      if (r1 >= r.r0 && rangeRows({ ...r, r1 }) * (r.c1 - r.c0 + 1) <= 500_000) {
        const rows = await api.SheetRows(book!.id, sheet, r.r0, r1 + 1, r.c1 + 1);
        for (const row of rows) for (let c = r.c0; c <= r.c1; c++) addStats(s, row[c] ?? '', toNumber);
      }
      if (seq !== statsSeq) return;
      selStats = formatStats(s);
      updateStatus();
    }, 120);
  }

  async function commitFormula() {
    await edit(cursor.row, cursor.col, formula);
    grid?.moveTo(cursor.row + 1, cursor.col);
    grid?.focus();
  }

  async function switchSheet(name: string) {
    sheet = name;
    setColumns();
    version++;
    workspace.touch();
    await tick();
    grid?.moveTo(0, 0);
  }

  async function addSheet() {
    if (!book) return;
    const name = await ui.prompt('New sheet name', `Sheet${book.sheets.length + 1}`, 'Add');
    if (!name) return;
    try {
      await api.SheetAddSheet(book.id, name);
      book = { ...book, sheets: [...book.sheets, { name, rows: 0, cols: 0 }] } as office.BookInfo;
      tab.dirty = true;
      await switchSheet(name);
    } catch (e) {
      toastError(e);
    }
  }

  async function renameSheet(name: string) {
    if (!book) return;
    const to = await ui.prompt('Rename sheet', name, 'Rename');
    if (!to || to === name) return;
    try {
      await api.SheetRenameSheet(book.id, name, to);
      book = { ...book, sheets: book.sheets.map((s) => (s.name === name ? { ...s, name: to } : s)) } as office.BookInfo;
      if (sheet === name) sheet = to;
      tab.dirty = true;
    } catch (e) {
      toastError(e);
    }
  }

  async function insertRow() {
    if (!book || !info) return;
    await api.SheetInsertRow(book.id, sheet, cursor.row);
    info.rows++;
    undoStack = [];
    redoStack = [];
    tab.dirty = true;
    version++;
  }

  /** Delete the selected rows (or the current one). */
  async function deleteRow() {
    if (!book || !info) return;
    const s = grid?.selection() ?? { r0: cursor.row, r1: cursor.row, c0: 0, c1: 0 };
    const last = Math.min(s.r1, info.rows - 1);
    for (let r = last; r >= s.r0; r--) await api.SheetDeleteRow(book.id, sheet, r);
    info.rows = Math.max(0, info.rows - Math.max(0, last - s.r0 + 1));
    undoStack = [];
    redoStack = [];
    tab.dirty = true;
    version++;
  }

  async function save(): Promise<boolean> {
    if (!book) return false;
    if (saveAsTarget) {
      const ok = await ui.confirm('Save as .xlsx?', `Legacy .xls files can't be written. Your edits will be saved to ${basename(saveAsTarget)} next to the original, which stays unchanged.`, 'Save .xlsx');
      if (!ok) return false;
      return writeTo(saveAsTarget, true);
    }
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeTo(tab.filePath, false);
  }

  async function saveAs(): Promise<boolean> {
    if (!book) return false;
    const def = saveAsTarget || tab.filePath || tab.title;
    const p = await api.SaveFileDialog('Save workbook as', def, [{ name: 'Excel workbook', patterns: '*.xlsx' }]);
    if (!p) return false;
    return writeTo(/\.xls[xm]$/i.test(p) ? p : `${p}.xlsx`, true);
  }

  async function writeTo(path: string, retarget: boolean): Promise<boolean> {
    await api.SheetSave(book!.id, path);
    tab.dirty = false;
    if (retarget && path !== tab.filePath) {
      tab.retarget(path);
      saveAsTarget = '';
      book = { ...book!, format: 'xlsx', saveAs: '', note: '' } as office.BookInfo;
    }
    const e = await api.Stat(path);
    tab.size = e.size;
    return true;
  }

  function cellMenu(e: MouseEvent) {
    const s = grid?.selection();
    const n = s ? rangeRows(s) : 1;
    const ro = tab.readOnly;
    menu.show(e, [
      { label: 'Cut', shortcut: formatShortcut('Mod+X'), run: () => void grid?.copy(true), disabled: ro },
      { label: 'Copy', shortcut: formatShortcut('Mod+C'), run: () => void grid?.copy() },
      { label: 'Paste', shortcut: formatShortcut('Mod+V'), run: async () => grid?.pasteText(await navigator.clipboard.readText()), disabled: ro },
      { label: 'Clear contents', shortcut: 'Del', run: () => void grid?.clearSelection(), disabled: ro },
      { separator: true },
      { label: 'Insert row above', run: insertRow, disabled: ro },
      { label: n > 1 ? `Delete ${n} rows` : 'Delete row', run: deleteRow, disabled: ro },
    ]);
  }

  officeControllers.set(tab.id, { insertRow, deleteRow });
  (tab as unknown as { sheetTest: unknown }).sheetTest = { book: () => book, edit, rows: (s: number, e: number) => source.rows(s, e), cell: (r: number, c: number) => api.SheetCell(book!.id, sheet, r, c), switchSheet, save, writeTo, grid: () => grid, undoRedo, stats: () => selStats };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      reload: open,
      onShow: () => updateCursor(cursor.row, cursor.col),
      getState: () => ({ sheet }),
      focus: () => grid?.focus(),
    };
    void open();
    return () => {
      officeControllers.delete(tab.id);
      if (book) void api.SheetClose(book.id);
    };
  });
</script>

{#if book?.note}
  <div class="banner"><Icon icon={Info} /><span class="grow">{book.note}</span></div>
{/if}
<div class="formula">
  <span class="ref">{colName(cursor.col)}{cursor.row + 1}</span>
  <span class="fx">fx</span>
  <input
    class="input"
    bind:this={formulaEl}
    bind:value={formula}
    readonly={tab.readOnly}
    spellcheck="false"
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitFormula();
      } else if (e.key === 'Escape') {
        void updateCursor(cursor.row, cursor.col);
        grid?.focus();
      }
    }}
  />
</div>
<div class="body">
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if book && sheet}
    {#key sheet}
      <Grid
        bind:this={grid}
        {source}
        {rowCount}
        bind:columns
        {version}
        editable={!tab.readOnly}
        formulas
        onedit={edit}
        onapply={(e) => write(e)}
        onundo={() => undoRedo(false)}
        onredo={() => undoRedo(true)}
        oncomplete={async (col, typed) => (book ? (await api.SheetComplete(book.id, sheet, col, typed)) || null : null)}
        onselection={onSelection}
        oncursor={(r, c) => updateCursor(r, c)}
        oncontext={cellMenu}
      />
    {/key}
  {:else}
    <div class="empty-state"><span class="spinner"></span></div>
  {/if}
</div>
{#if book}
  <div class="sheets" role="tablist">
    {#each book.sheets as s (s.name)}
      <button class="sheet" class:on={s.name === sheet} role="tab" aria-selected={s.name === sheet} onclick={() => switchSheet(s.name)} ondblclick={() => !tab.readOnly && renameSheet(s.name)}>{s.name}</button>
    {/each}
    {#if !tab.readOnly}<button class="icon-btn add" title="Add sheet" onclick={addSheet}><Icon icon={Plus} size={14} /></button>{/if}
  </div>
{/if}

<style>
  .formula {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
  }
  .ref {
    min-width: 64px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--text-muted);
  }
  .fx {
    font-family: var(--font-serif);
    font-style: italic;
    color: var(--text-faint);
  }
  .formula .input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: calc(12.5px * var(--ui-scale));
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .sheets {
    display: flex;
    gap: 2px;
    padding: 4px 8px;
    background: var(--bg-sidebar);
    border-top: 1px solid var(--border-soft);
    overflow-x: auto;
  }
  .sheet {
    border: none;
    background: transparent;
    padding: 4px 14px;
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .sheet:hover {
    background: var(--bg-hover);
  }
  .sheet.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .add {
    width: 24px;
    height: 24px;
  }
</style>
