<script lang="ts">
  import { isNarrow } from '../../core/fit';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import Lock from '@lucide/svelte/icons/lock';
  import Download from '@lucide/svelte/icons/download';
  import Ban from '@lucide/svelte/icons/ban';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import Funnel from '@lucide/svelte/icons/funnel';
  import Terminal from '@lucide/svelte/icons/terminal';
  import TableProperties from '@lucide/svelte/icons/table-properties';
  import Icon from '../../shell/Icon.svelte';
  import Table from '@lucide/svelte/icons/table';
  import { fitBar } from '../../core/fit';
  // SQLite browser and editor: schema on the left; a table's rows in the
  // spreadsheet grid (paged from Go, sort, search, WHERE filter) with edits
  // kept as pending changes until Save (one transaction) or Revert; the
  // structure of tables and views; and an SQL console.
  import { onMount } from 'svelte';
  import type { Tab } from '../../core/tabs.svelte';
  import { api } from '../../core/backend';
  import { basename, dirname, join, stem } from '../../core/paths';
  import { ui, toastError, menu } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';
  import Grid, { type GridColumn, type GridEdit } from '../data/Grid.svelte';
  import type { Range } from '../data/gridOps';
  import type SqlConsole from './SqlConsole.svelte';
  // The SQL console (CodeMirror + SQL) loads the first time it's shown.
  const consoleModule = () => import('./SqlConsole.svelte');
  import * as P from './edits';
  import { dbViews } from './views';

  type Obj = { type: string; name: string; table?: string; sql: string; columns?: { name: string; type: string; notNull: boolean; default?: string; pk: number }[]; rows: number; rowid: boolean };
  type Pane = 'data' | 'structure' | 'sql';

  let { tab }: { tab: Tab } = $props();
  const restored = (tab.restoredState as { table?: string; pane?: Pane } | undefined) ?? {};

  let id = 0;
  let objects = $state<Obj[]>([]);
  let readOnly = $state(false);
  let error = $state('');
  let loading = $state(true);
  let current = $state<string>(restored.table ?? '');
  let pane = $state<Pane>(restored.pane ?? 'data');
  let filterText = $state('');
  let where = $state('');
  let showWhere = $state(false);
  let order = $state<{ col: string; desc: boolean } | null>(null);
  let total = $state(0);
  let columns = $state<GridColumn[]>([]);
  let version = $state(0);
  let millis = $state(0);
  let pending = $state<P.Pending>(P.empty());
  let undoStack: P.Pending[] = [];
  let redoStack: P.Pending[] = [];
  let selection = $state<Range | null>(null);
  let sidebarFilter = $state('');
  let consoleRef = $state<SqlConsole>();

  const obj = $derived(objects.find((o) => o.name === current && (o.type === 'table' || o.type === 'view')) ?? null);
  const editable = $derived(!!obj && obj.type === 'table' && obj.rowid && !readOnly);
  const inserts = $derived(pending.inserts.get(current) ?? []);
  const changes = $derived(P.count(pending));
  const tables = $derived(objects.filter((o) => o.type === 'table'));
  const views = $derived(objects.filter((o) => o.type === 'view'));
  const others = $derived(objects.filter((o) => o.type === 'index' || o.type === 'trigger'));
  const shownTables = $derived(tables.filter((o) => o.name.toLowerCase().includes(sidebarFilter.toLowerCase())));
  const completion = $derived(Object.fromEntries(objects.filter((o) => o.columns).map((o) => [o.name, o.columns!.map((c) => c.name)])));

  // ---- loading ----
  // A narrow pane (split view, small window): the table list floats over the
  // grid, opened from the toolbar, and closes when a table is picked.
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  let schemaOpen = $state(false);

  async function open(ro: boolean) {
    loading = true;
    error = '';
    try {
      if (id) api.DBClose(id);
      const o = await api.DBOpen(tab.filePath!, ro);
      id = o.id;
      readOnly = o.readOnly;
      objects = (o.objects ?? []) as Obj[];
      // Start on the remembered table, else the first one with rows.
      if (!objects.some((x) => x.name === current)) current = (tables.find((t) => t.rows > 0) ?? tables[0] ?? views[0])?.name ?? '';
      if (!current) pane = 'sql';
      await selectTable(current, false);
      status();
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function refreshSchema() {
    objects = ((await api.DBSchema(id)) ?? []) as Obj[];
  }

  // ---- rows (paged from Go, cached in blocks) ----
  const BLOCK = 200;
  let blocks = new Map<number, Promise<{ rows: P.Value[][]; keys: (number | string)[] }>>();
  let gen = 0;

  function query(offset: number) {
    return { table: current, where: showWhere ? where : '', search: filterText, order: order?.col ?? '', desc: !!order?.desc, offset, limit: BLOCK };
  }

  function block(start: number) {
    let b = blocks.get(start);
    if (!b) {
      const g = gen;
      b = api.DBRows(id, query(start) as never).then((p) => {
        if (g === gen) {
          total = p.total;
          millis = p.millis;
        }
        return { rows: (p.rows ?? []) as P.Value[][], keys: (p.keys ?? []) as (number | string)[] };
      });
      b.catch(() => blocks.delete(start));
      blocks.set(start, b);
    }
    return b;
  }

  async function rowAt(i: number): Promise<{ row: P.Value[]; key: number | string | null }> {
    const start = Math.floor(i / BLOCK) * BLOCK;
    const b = await block(start);
    return { row: b.rows[i - start] ?? [], key: b.keys[i - start] ?? null };
  }

  const source = {
    rows: async (s: number, e: number) => {
      const out: string[][] = [];
      for (let i = s; i < e; i++) {
        if (i < total) {
          const { row, key } = await rowAt(i);
          out.push(
            (obj?.columns ?? []).map((c, k) => {
              const o = key !== null ? P.override(pending, current, key, c.name) : { set: false, value: null };
              return P.display(o.set ? o.value : row[k]);
            }),
          );
        } else {
          const ins = inserts[i - total] ?? {};
          out.push((obj?.columns ?? []).map((c) => (c.name in ins ? P.display(ins[c.name]) : '')));
        }
      }
      return out;
    },
  };

  /** Row marks: • changed, ✕ to be deleted, + new. */
  let marks = $state(new Map<number, string>());
  const label = (i: number) => {
    if (i >= total) return `+${i - total + 1}`;
    return `${marks.get(i) ?? ''}${i + 1}`;
  };

  async function refreshMarks() {
    const m = new Map<number, string>();
    // Marks for loaded rows only (what can be on screen).
    for (const [start, b] of blocks) {
      const { keys } = await b;
      keys.forEach((k, j) => {
        if (P.isDeleted(pending, current, k)) m.set(start + j, '✕ ');
        else if (P.isChanged(pending, current, k)) m.set(start + j, '• ');
      });
    }
    marks = m;
  }

  async function selectTable(name: string, resetView = true) {
    if (narrow) schemaOpen = false;
    current = name;
    gen++;
    blocks = new Map();
    if (resetView) {
      order = null;
      filterText = '';
      where = '';
    }
    const o = objects.find((x) => x.name === name);
    columns = (o?.columns ?? []).map((c) => ({ name: c.name + (c.pk ? ' 🔑' : ''), width: /INT/i.test(c.type) ? 90 : /REAL|FLOA|DOUB|NUM|DEC/i.test(c.type) ? 110 : /BLOB/i.test(c.type) ? 170 : 180 }));
    total = o?.rows ?? 0;
    if (name) {
      try {
        await block(0);
      } catch (e) {
        toastError(e, 'Can’t read this table');
      }
    }
    version++;
    void refreshMarks();
    status();
  }

  function reload() {
    gen++;
    blocks = new Map();
    void block(0)
      .then(() => {
        version++;
        void refreshMarks();
      })
      .catch((e) => toastError(e, 'Filter failed'));
  }

  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  function filterChanged() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(reload, 250);
  }

  function sort(col: number) {
    const name = obj?.columns?.[col]?.name;
    if (!name) return;
    order = order?.col === name ? (order.desc ? null : { col: name, desc: true }) : { col: name, desc: false };
    reload();
  }

  // ---- edits ----
  function commit(next: P.Pending) {
    undoStack.push(pending);
    redoStack = [];
    pending = next;
    tab.dirty = P.count(next) > 0;
    version++;
    void refreshMarks();
    status();
  }

  async function setValue(p: P.Pending, row: number, col: number, value: P.Value): Promise<P.Pending> {
    const c = obj?.columns?.[col];
    if (!c) return p;
    if (row >= total) return P.setInsertCell(p, current, row - total, c.name, value);
    const { key } = await rowAt(row);
    return key === null ? p : P.setCell(p, current, key, c.name, value);
  }

  async function onedit(row: number, col: number, value: string) {
    if (!editable) return;
    commit(await setValue(pending, row, col, P.parseInput(value)));
  }

  async function onapply(edit: GridEdit) {
    if (!editable) return false;
    let p = pending;
    for (const ch of edit.cells) p = await setValue(p, ch.row, ch.col, P.parseInput(ch.value));
    for (const r of edit.clear) for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) p = await setValue(p, row, col, null);
    commit(p);
    return true;
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(pending);
    pending = prev;
    tab.dirty = P.count(prev) > 0;
    version++;
    void refreshMarks();
  }
  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(pending);
    pending = next;
    tab.dirty = P.count(next) > 0;
    version++;
    void refreshMarks();
  }

  function addRow() {
    if (!editable) return;
    commit(P.addRow(pending, current));
  }

  async function deleteSelected() {
    if (!editable || !selection) return;
    const ids: (number | string)[] = [];
    const fresh: number[] = [];
    for (let r = selection.r0; r <= selection.r1; r++) {
      if (r >= total) fresh.push(r - total);
      else {
        const { key } = await rowAt(r);
        if (key !== null) ids.push(key);
      }
    }
    if (!ids.length && !fresh.length) return;
    commit(P.deleteRows(pending, current, ids, fresh));
    ui.toast(`${ids.length + fresh.length} row${ids.length + fresh.length > 1 ? 's' : ''} marked for deletion — Save to delete, Revert to keep.`, 'info');
  }

  async function setNull() {
    if (!editable || !selection) return;
    await onapply({ cells: [], clear: [selection] });
  }

  async function save(): Promise<boolean> {
    if (!changes) return true;
    try {
      await api.DBApply(id, P.toChanges(pending) as never);
    } catch (e) {
      toastError(e, 'Saving failed — nothing was changed');
      return false;
    }
    const n = changes;
    pending = P.empty();
    undoStack = [];
    redoStack = [];
    tab.dirty = false;
    await refreshSchema();
    await selectTable(current, false);
    ui.toast(`Saved ${n} change${n > 1 ? 's' : ''} to ${basename(tab.filePath ?? '')}`, 'success');
    return true;
  }

  function revert() {
    commit(P.empty());
    undoStack = [];
  }

  // ---- SQL ----
  async function runSql(script: string): Promise<P.Result[]> {
    const res = ((await api.DBExec(id, script, 1000)) ?? []) as P.Result[];
    // Anything may have changed: refresh the schema and the table.
    await refreshSchema();
    if (res.some((r) => !r.columns)) await selectTable(objects.some((o) => o.name === current) ? current : (tables[0]?.name ?? ''), false);
    return res;
  }

  function queryTable(name: string) {
    pane = 'sql';
    queueMicrotask(() => consoleRef?.setText(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 100;`));
  }

  async function exportCsv(name = current, sqlText = '') {
    let dest = await api.SaveFileDialog('Export as CSV', join(dirname(tab.filePath ?? ''), `${sqlText ? `${stem(tab.title)} query` : name}.csv`), [{ name: 'CSV', patterns: '*.csv' }]);
    if (!dest) return;
    if (!dest.toLowerCase().endsWith('.csv')) dest += '.csv';
    try {
      const n = await api.DBExportCSV(id, { ...query(0), table: name, offset: 0, limit: 0 } as never, sqlText, dest);
      ui.toast(`Exported ${n} rows to ${basename(dest)}`, 'success');
    } catch (e) {
      toastError(e, 'Export failed');
    }
  }

  function tableMenu(e: MouseEvent, o: Obj) {
    e.preventDefault();
    menu.show(e, [
      { label: 'Show rows', run: () => ((pane = 'data'), void selectTable(o.name)) },
      { label: 'Structure', run: () => ((pane = 'structure'), void selectTable(o.name)) },
      { label: 'Query in SQL console', run: () => queryTable(o.name) },
      { label: 'Export as CSV…', run: () => void exportCsv(o.name) },
    ]);
  }

  async function toggleReadOnly() {
    if (changes && !readOnly) {
      const r = await ui.ask({ title: 'Discard unsaved changes?', message: 'Switching to read-only drops the pending changes.', buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Discard', danger: true }] });
      if (r.button !== 'ok') return;
      pending = P.empty();
      tab.dirty = false;
    }
    await open(!readOnly);
  }

  function status() {
    tab.status = { ...tab.status, type: 'SQLite database', position: current ? `${current}: ${total.toLocaleString()} rows` : `${tables.length} tables`, info: changes ? `${changes} unsaved change${changes > 1 ? 's' : ''}` : readOnly ? 'read-only' : undefined };
  }

  dbViews.set(tab.id, { undo, redo, addRow, deleteSelected, setNull, run: () => consoleRef?.run(), pane: () => pane });

  onMount(() => {
    tab.handlers = { ...tab.handlers, save, reload: () => open(readOnly), getState: () => ({ table: current, pane }), onShow: status };
    void open(false);
    return () => {
      dbViews.delete(tab.id);
      clearTimeout(filterTimer);
      if (id) api.DBClose(id);
    };
  });

  (tab as unknown as { dbTest: unknown }).dbTest = {
    loading: () => loading,
    error: () => error,
    objects: () => objects,
    selectTable,
    setPane: (p: Pane) => (pane = p),
    setFilter: (t: string) => ((filterText = t), reload()),
    setWhere: (t: string) => ((showWhere = true), (where = t), reload()),
    sort,
    total: () => total,
    onedit,
    addRow,
    select: (r: Range) => (selection = r),
    deleteSelected,
    save,
    revert,
    changes: () => changes,
    console: () => consoleRef,
    source,
    readOnly: () => readOnly,
    toggleReadOnly,
  };
</script>

<div class="db" bind:clientWidth={bodyW}>
  {#if !narrow || schemaOpen}
  <aside class="schema" class:floating={narrow} class:left={narrow} aria-label="Database objects">
    <input class="input" placeholder="Filter tables" bind:value={sidebarFilter} aria-label="Filter tables" />
    <h4>Tables <span class="muted">{tables.length}</span></h4>
    {#each shownTables as o (o.name)}
      <button class="obj" class:on={o.name === current && pane !== 'sql'} title={o.sql} onclick={() => ((pane = pane === 'sql' ? 'data' : pane), void selectTable(o.name))} oncontextmenu={(e) => tableMenu(e, o)}>
        <span class="nm">▦ {o.name}</span><span class="muted">{o.rows >= 0 ? o.rows.toLocaleString() : ''}</span>
      </button>
    {/each}
    {#if views.length}
      <h4>Views <span class="muted">{views.length}</span></h4>
      {#each views as o (o.name)}
        <button class="obj" class:on={o.name === current && pane !== 'sql'} title={o.sql} onclick={() => ((pane = pane === 'sql' ? 'data' : pane), void selectTable(o.name))} oncontextmenu={(e) => tableMenu(e, o)}><span class="nm">◫ {o.name}</span></button>
      {/each}
    {/if}
    {#if others.length}
      <h4>Indexes &amp; triggers <span class="muted">{others.length}</span></h4>
      {#each others as o (o.type + o.name)}
        <div class="obj small" title={o.sql}><span class="nm">{o.type === 'index' ? '⚡' : '⚙'} {o.name}</span><span class="muted">{o.table}</span></div>
      {/each}
    {/if}
  </aside>
  {/if}

  <section class="main">
    <div class="toolbar" use:fitBar>
      {#if narrow}<button class="icon-btn" class:on={schemaOpen} title="Tables and views" onclick={() => (schemaOpen = !schemaOpen)}><Icon icon={PanelLeft} /></button>{/if}
      <div class="seg" role="tablist" aria-label="View">
        <button class="btn ghost" class:on={pane === 'data'} role="tab" aria-selected={pane === 'data'} disabled={!current} onclick={() => (pane = 'data')}><Icon icon={Table} size={14} /> Data</button>
        <button class="btn ghost" class:on={pane === 'structure'} role="tab" aria-selected={pane === 'structure'} disabled={!current} onclick={() => (pane = 'structure')}><Icon icon={TableProperties} size={14} /> Structure</button>
        <button class="btn ghost" class:on={pane === 'sql'} role="tab" aria-selected={pane === 'sql'} onclick={() => (pane = 'sql')}><Icon icon={Terminal} size={14} /> SQL</button>
      </div>
      {#if pane === 'data' && obj}
        <input class="input search" placeholder="Search rows…" bind:value={filterText} oninput={filterChanged} aria-label="Search rows" title="Find text in any column" />
        <button class="btn ghost" class:on={showWhere} title="Filter with an SQL condition (WHERE …)" onclick={() => ((showWhere = !showWhere), reload())}><Icon icon={Funnel} size={14} /> WHERE</button>
        <span class="sep"></span>
        <button class="btn ghost" disabled={!editable} title="Add a row (saved with Save)" onclick={addRow}><Icon icon={Plus} size={14} /> Row</button>
        <button class="btn ghost" disabled={!editable || !selection} title="Mark the selected rows for deletion (Delete)" onclick={deleteSelected}><Icon icon={Trash2} size={14} /> Delete rows</button>
        <button class="btn ghost" disabled={!editable || !selection} title="Set the selected cells to NULL (or type NULL)" onclick={setNull}><Icon icon={Ban} size={14} /> NULL</button>
        <button class="btn ghost" title="Export these rows as CSV" onclick={() => void exportCsv()}><Icon icon={Download} size={14} /> Export CSV…</button>
      {/if}
      <span class="spacer"></span>
      {#if changes}
        <span class="pending">{changes} unsaved change{changes > 1 ? 's' : ''}</span>
        <button class="btn ghost" title="Drop all unsaved changes" onclick={revert}>Revert</button>
        <button class="btn primary" title="Write the changes in one transaction ({formatShortcut('Mod+S')})" onclick={() => void save()}>Save</button>
      {/if}
      <button class="btn ghost" class:on={readOnly} title={readOnly ? 'Read-only: click to allow changes' : 'Click to open read-only (no changes possible)'} onclick={toggleReadOnly}><Icon icon={readOnly ? Lock : LockOpen} size={14} /> {readOnly ? 'Read-only' : 'Editable'}</button>
    </div>
    {#if pane === 'data' && showWhere && obj}
      <div class="where">
        <span class="mono">WHERE</span>
        <input class="input mono" placeholder="amount > 100 AND city = 'Warsaw'" bind:value={where} onkeydown={(e) => e.key === 'Enter' && reload()} aria-label="WHERE condition" />
        <button class="btn ghost" onclick={reload}>Apply</button>
      </div>
    {/if}
    {#if error}
      <div class="empty-state err">{error}</div>
    {:else if loading}
      <div class="empty-state"><span class="spinner"></span></div>
    {:else if pane === 'sql'}
      {#await consoleModule() then { default: Console }}
        <Console bind:this={consoleRef} tables={completion} initial={current ? `SELECT * FROM "${current}" LIMIT 100;` : ''} onrun={runSql} />
      {/await}
    {:else if pane === 'structure' && obj}
      <div class="structure">
        <table>
          <thead><tr><th>Column</th><th>Type</th><th>Not null</th><th>Default</th><th>Key</th></tr></thead>
          <tbody>
            {#each obj.columns ?? [] as c (c.name)}
              <tr><td class="mono">{c.name}</td><td class="mono">{c.type || '—'}</td><td>{c.notNull ? '✓' : ''}</td><td class="mono">{c.default ?? ''}</td><td>{c.pk ? `PK${(obj.columns ?? []).filter((x) => x.pk).length > 1 ? ` ${c.pk}` : ''}` : ''}</td></tr>
            {/each}
          </tbody>
        </table>
        {#if others.some((o) => o.table === obj.name)}
          <h4>Indexes and triggers</h4>
          {#each others.filter((o) => o.table === obj.name) as o (o.name)}<pre class="mono">{o.sql}</pre>{/each}
        {/if}
        <h4>Definition</h4>
        <pre class="mono">{obj.sql}</pre>
        {#if !obj.rowid && obj.type === 'table'}<p class="muted">This table has no rowid (WITHOUT ROWID): use the SQL console to change it.</p>{/if}
      </div>
    {:else if obj}
      <div class="grid">
        <Grid
          {source}
          rowCount={total + inserts.length}
          bind:columns
          {version}
          editable={editable}
          sortCol={order ? (obj.columns ?? []).findIndex((c) => c.name === order!.col) : -1}
          sortDir={order?.desc ? -1 : 1}
          onsort={sort}
          {onedit}
          {onapply}
          onundo={undo}
          onredo={redo}
          onselection={(r) => (selection = r)}
          rowLabel={label}
        />
      </div>
      <div class="foot muted">
        {total.toLocaleString()} row{total === 1 ? '' : 's'}{filterText || (showWhere && where) ? ' match' : ''} · {millis} ms{#if !editable && obj.type === 'view'}&nbsp;· views are read-only{/if}{#if editable}&nbsp;· type NULL for a null value; changes are written with Save{/if}
      </div>
    {:else}
      <div class="empty-state">This database has no tables yet. Create one in the SQL tab.</div>
    {/if}
  </section>
</div>

<style>
  .db {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .schema {
    width: 220px;
    flex: none;
    overflow-y: auto;
    padding: 8px;
    border-right: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
    font-size: var(--fs-small);
  }
  .schema .input {
    width: 100%;
    height: calc(26px * var(--ui-scale));
  }
  h4 {
    margin: 12px 0 4px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .obj {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .obj.small {
    cursor: default;
    color: var(--text-muted);
  }
  .obj:not(.small):hover {
    background: var(--bg-hover);
  }
  .obj.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--text-faint);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .search {
    width: 200px;
    height: calc(28px * var(--ui-scale));
  }
  .pending {
    color: var(--warning);
    font-size: var(--fs-small);
  }
  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border-soft);
  }
  .where .input {
    flex: 1;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .foot {
    padding: 4px 10px;
    font-size: var(--fs-small);
    border-top: 1px solid var(--border-soft);
  }
  .structure {
    flex: 1;
    overflow: auto;
    padding: 12px 16px;
  }
  table {
    border-collapse: collapse;
    font-size: var(--fs-small);
  }
  th,
  td {
    text-align: left;
    padding: 4px 14px 4px 0;
    border-bottom: 1px solid var(--border-soft);
  }
  th {
    color: var(--text-muted);
    font-weight: 600;
  }
  pre {
    background: var(--bg-sidebar);
    padding: 8px 10px;
    border-radius: var(--radius);
    white-space: pre-wrap;
    font-size: var(--fs-small);
  }
  .err {
    color: var(--danger);
  }
</style>
