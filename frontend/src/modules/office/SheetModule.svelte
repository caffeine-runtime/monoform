<script lang="ts">
  // .xlsx / .xlsm / .xls: cells are read and written by Go (excelize), the
  // grid only fetches what's on screen.
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Info from '@lucide/svelte/icons/info';
  import Grid, { type GridColumn } from '../data/Grid.svelte';
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

  const source = { rows: (s: number, e: number) => api.SheetRows(book!.id, sheet, s, e, columns.length) };

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
    tab.status = { ...tab.status, type: book.format.toUpperCase(), position: `${colName(col)}${row + 1}`, info: `${sheet} · ${info?.rows ?? 0} rows` };
  }

  async function edit(row: number, col: number, value: string) {
    if (!book) return;
    try {
      await api.SheetSet(book.id, sheet, row, col, value);
      if (info && (row >= info.rows || col >= info.cols)) {
        info.rows = Math.max(info.rows, row + 1);
        info.cols = Math.max(info.cols, col + 1);
        await refreshBook();
        setColumns();
      }
      tab.dirty = true;
      version++;
      if (row === cursor.row && col === cursor.col) await updateCursor(row, col);
    } catch (e) {
      toastError(e, 'Could not set the cell');
    }
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
    tab.dirty = true;
    version++;
  }

  async function deleteRow() {
    if (!book || !info) return;
    await api.SheetDeleteRow(book.id, sheet, cursor.row);
    info.rows = Math.max(0, info.rows - 1);
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
    menu.show(e, [
      { label: 'Insert row above', run: insertRow, disabled: tab.readOnly },
      { label: 'Delete row', run: deleteRow, disabled: tab.readOnly },
      { separator: true },
      { label: 'Copy cell', run: async () => navigator.clipboard.writeText((await source.rows(cursor.row, cursor.row + 1))[0]?.[cursor.col] ?? '') },
    ]);
  }

  officeControllers.set(tab.id, { insertRow, deleteRow });
  (tab as unknown as { sheetTest: unknown }).sheetTest = { book: () => book, edit, rows: (s: number, e: number) => source.rows(s, e), cell: (r: number, c: number) => api.SheetCell(book!.id, sheet, r, c), switchSheet, save, writeTo };

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
      <Grid bind:this={grid} {source} {rowCount} bind:columns {version} editable={!tab.readOnly} onedit={edit} oncursor={(r, c) => updateCursor(r, c)} oncontext={cellMenu} />
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
    font-size: 12.5px;
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
