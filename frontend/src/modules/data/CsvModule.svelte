<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Search from '@lucide/svelte/icons/search';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import FileText from '@lucide/svelte/icons/file-text';
  import Grid, { type GridColumn } from './Grid.svelte';
  import { CsvClient, type CsvInfo } from './csvClient';
  import { api, sessionToken } from '../../core/backend';
  import { extname } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { menu, toastError, ui } from '../../core/ui.svelte';
  import { csvControllers } from './controllers';

  let { tab }: { tab: Tab } = $props();

  const client = new CsvClient();
  let info = $state<CsvInfo | null>(null);
  let columns = $state<GridColumn[]>([]);
  let version = $state(0);
  let filter = $state('');
  let busy = $state('');
  let error = $state('');
  let grid = $state<Grid>();
  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  const DELIMS: [string, string][] = [
    [',', 'Comma'],
    [';', 'Semicolon'],
    ['\t', 'Tab'],
    ['|', 'Pipe'],
  ];

  client.onProgress = (phase, done, total) => {
    busy = total ? `${phase}… ${Math.round((done / total) * 100)}%` : `${phase}…`;
  };

  const source = { rows: async (s: number, e: number) => (await client.call<{ rows: string[][] }>({ type: 'rows', start: s, end: e })).rows };

  function apply(i: CsvInfo, resetColumns = false) {
    const widthsChanged = resetColumns || i.columns.length !== columns.length;
    info = i;
    tab.dirty = i.dirty;
    if (widthsChanged) void sizeColumns(i);
    else columns = i.columns.map((name, k) => ({ name, width: columns[k]?.width ?? 140 }));
    version++;
    status();
  }

  async function sizeColumns(i: CsvInfo) {
    // Width from the header and a sample of rows.
    const sample = i.rows ? (await client.call<{ rows: string[][] }>({ type: 'rows', start: 0, end: Math.min(i.rows, 200) })).rows : [];
    columns = i.columns.map((name, k) => {
      let w = name.length;
      for (const r of sample) w = Math.max(w, Math.min(60, (r[k] ?? '').length));
      return { name, width: Math.max(70, Math.min(420, w * 7.5 + 28)) };
    });
  }

  function status(row?: number, col?: number) {
    if (!info) return;
    tab.status = {
      ...tab.status,
      type: info.delimiter === '\t' ? 'TSV' : 'CSV',
      position: row !== undefined ? `Row ${row + 1}, ${columns[col!]?.name ?? ''}` : undefined,
      info: `${info.rows.toLocaleString()}${info.rows !== info.totalRows ? ` of ${info.totalRows.toLocaleString()}` : ''} rows · ${info.columns.length} columns`,
      encoding: info.encoding.toUpperCase(),
      eol: info.eol,
    };
  }

  async function load() {
    error = '';
    busy = 'Reading…';
    try {
      const r = await client.call<{ info: CsvInfo }>({ type: 'load', url: new URL(tab.url(), location.href).href, ext: extname(tab.name) });
      apply(r.info, true);
    } catch (e) {
      error = String((e as Error).message ?? e);
    } finally {
      busy = '';
    }
  }

  async function run(msg: Record<string, unknown>, label = 'Working…') {
    const t = setTimeout(() => (busy = label), 300);
    try {
      const r = await client.call<{ info: CsvInfo; row?: number }>(msg);
      apply(r.info);
      return r;
    } catch (e) {
      toastError(e);
    } finally {
      clearTimeout(t);
      busy = '';
    }
  }

  function sort(col: number) {
    if (!info) return;
    const [c, d] = info.sortCol !== col ? [col, 1] : info.sortDir === 1 ? [col, -1] : [-1, 1];
    void run({ type: 'sort', col: c, dir: d }, 'Sorting…');
  }

  function onFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => void run({ type: 'filter', query: filter }, 'Filtering…'), 200);
  }

  async function edit(row: number, col: number, value: string) {
    if (tab.readOnly) return ui.toast('This file is read-only here. Use Save as to edit a copy.', 'info');
    await run({ type: 'edit', row, col, value });
  }

  async function renameColumn(col: number) {
    if (!info?.header || tab.readOnly) return;
    const v = await ui.prompt('Column name', info.columns[col], 'Rename');
    if (v !== null) await run({ type: 'renameColumn', col, value: v });
  }

  async function addRow() {
    const r = await run({ type: 'insertRow' });
    if (r?.row !== undefined && r.row >= 0) grid?.moveTo(r.row, 0);
  }

  async function deleteRow() {
    const c = grid?.cursor();
    if (!c || !info?.rows) return;
    await run({ type: 'deleteRows', rows: [c.row] });
    grid?.moveTo(c.row, c.col);
  }

  async function save(): Promise<boolean> {
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeTo(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    const p = await api.SaveFileDialog('Save as', tab.filePath ?? tab.title, [{ name: 'CSV / TSV', patterns: '*.csv;*.tsv;*.txt' }]);
    if (!p) return false;
    const ok = await writeTo(p);
    if (ok) tab.retarget(p);
    return ok;
  }

  async function writeTo(path: string): Promise<boolean> {
    const view = { sortCol: info?.sortCol ?? -1, sortDir: info?.sortDir ?? 1, filter, delimiter: info?.delimiter };
    busy = 'Saving…';
    try {
      const r = await client.call<{ entry: { size: number } }>({ type: 'save', path, token: sessionToken() });
      tab.size = r.entry.size;
      // Re-read what was written so row spans are exact, then restore the view.
      const re = await client.call<{ info: CsvInfo }>({ type: 'reload', url: new URL(`/__hia/file?${new URLSearchParams({ t: sessionToken(), path })}`, location.href).href, ext: extname(path), delimiter: view.delimiter });
      apply(re.info);
      if (view.filter) await run({ type: 'filter', query: view.filter });
      if (view.sortCol >= 0) await run({ type: 'sort', col: view.sortCol, dir: view.sortDir });
      return true;
    } finally {
      busy = '';
    }
  }

  async function setHeader(h: boolean) {
    await run({ type: 'setHeader', header: h });
    if (info) await sizeColumns(info);
  }

  async function setDelimiter(d: string) {
    if (info?.dirty && !(await ui.confirm('Discard edits?', 'Changing the delimiter re-reads the rows.', 'Change', true))) return;
    const r = await run({ type: 'setDelimiter', delimiter: d });
    if (r?.info) await sizeColumns(r.info);
  }

  function cellMenu(e: MouseEvent, row: number, col: number) {
    menu.show(e, [
      { label: 'Copy cell', run: async () => navigator.clipboard.writeText((await source.rows(row, row + 1))[0]?.[col] ?? '') },
      { label: 'Copy row (tab-separated)', run: async () => navigator.clipboard.writeText(((await source.rows(row, row + 1))[0] ?? []).join('\t')) },
      { separator: true },
      { label: 'Insert row at end', run: addRow, disabled: tab.readOnly },
      { label: 'Delete row', run: deleteRow, disabled: tab.readOnly },
      { separator: true },
      { label: `Sort by “${columns[col]?.name}”`, run: () => sort(col) },
    ]);
  }

  csvControllers.set(tab.id, {
    addRow,
    deleteRow,
    focusFilter: () => document.querySelector<HTMLInputElement>(`[data-tab-filter="${tab.id}"]`)?.focus(),
  });

  // Hooks for self-tests.
  (tab as unknown as { csvTest: unknown }).csvTest = { info: () => info, client, edit, sort: (c: number, d: 1 | -1) => run({ type: 'sort', col: c, dir: d }), filter: (q: string) => run({ type: 'filter', query: q }), rows: source.rows, grid: () => grid, save };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      find: () => document.querySelector<HTMLInputElement>(`[data-tab-filter="${tab.id}"]`)?.focus(),
      reload: load,
      onShow: () => status(),
      focus: () => grid?.focus(),
    };
    void load();
    return () => {
      csvControllers.delete(tab.id);
      client.destroy();
    };
  });
</script>

<div class="toolbar">
  <div class="filter">
    <Icon icon={Search} size={14} />
    <input class="input" data-tab-filter={tab.id} placeholder="Filter rows" bind:value={filter} oninput={onFilter} onkeydown={(e) => e.key === 'Escape' && ((filter = ''), onFilter())} />
  </div>
  <span class="sep"></span>
  <label class="chk"><input type="checkbox" checked={info?.header ?? true} onchange={(e) => setHeader((e.currentTarget as HTMLInputElement).checked)} /> Header row</label>
  <select class="input sel" value={info?.delimiter ?? ','} onchange={(e) => setDelimiter((e.currentTarget as HTMLSelectElement).value)} aria-label="Delimiter">
    {#each DELIMS as [d, label] (d)}<option value={d}>{label}</option>{/each}
  </select>
  {#if !tab.readOnly}
    <span class="sep"></span>
    <button class="icon-btn" title="Add row" onclick={addRow}><Icon icon={Plus} /></button>
    <button class="icon-btn" title="Delete current row" onclick={deleteRow}><Icon icon={Trash} /></button>
  {/if}
  <span class="spacer"></span>
  {#if busy}<span class="label"><span class="spinner inline"></span> {busy}</span>{/if}
  {#if info}<span class="label">{info.rows.toLocaleString()} rows</span>{/if}
  <button class="icon-btn" title="Open as text" onclick={() => ((tab.moduleId = 'text'), workspace.touch())}><Icon icon={FileText} /></button>
</div>

<div class="body">
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if info}
    <Grid
      bind:this={grid}
      {source}
      rowCount={info.rows}
      bind:columns
      {version}
      editable={!tab.readOnly}
      sortCol={info.sortCol}
      sortDir={info.sortDir}
      onsort={sort}
      onedit={edit}
      onheaderedit={renameColumn}
      oncursor={(r, c) => status(r, c)}
      oncontext={cellMenu}
    />
  {:else}
    <div class="empty-state"><span class="spinner"></span>{busy}</div>
  {/if}
</div>

<style>
  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .filter .input {
    width: 220px;
    height: 28px;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    margin-right: 6px;
    white-space: nowrap;
  }
  .chk input {
    accent-color: var(--accent);
  }
  .sel {
    height: 28px;
    padding: 0 6px;
  }
  .spinner.inline {
    display: inline-block;
    width: 11px;
    height: 11px;
    border-width: 1.5px;
    vertical-align: -1px;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
</style>
