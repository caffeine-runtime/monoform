// M19: SQLite database browser/editor — schema, paged rows (100k), sort,
// search, WHERE filter, pending edits saved in one transaction, insert and
// delete, revert, SQL console, CSV export, read-only mode.
import { api, readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const hooks = (t: Tab) => (t as unknown as { dbTest?: Hooks }).dbTest;

export default async function m19(dir: string) {
  const path = join(dir, 'db', 'shop.db');
  const t0 = performance.now();
  let tab!: Tab;
  const oj = await measureJank(async () => {
    tab = (await workspace.openPath(path))!;
    await waitFor(() => (hooks(tab) && !hooks(tab)!.loading() ? true : null), 'database opened', 10000);
  });
  const h = hooks(tab)!;
  log(`opened in ${Math.round(performance.now() - t0)} ms, longest UI frame ${Math.round(oj.maxGap)} ms`);
  assertEq(tab.moduleId, 'database', 'SQLite file opens in the database module');
  assertEq(h.error(), '', 'no error');
  const objs = h.objects().map((o: any) => `${o.type}:${o.name}`).join(',');
  assertEq(objs, 'table:audit,table:customers,table:events,table:orders,table:settings,view:big_spenders,index:idx_orders_customer,trigger:t_customers', 'schema');
  const rows = async (s: number, e: number) => (await h.source.rows(s, e)) as string[][];

  // ---- rows, sort, search, WHERE ----
  await h.selectTable('customers');
  assertEq(h.total(), 1000, 'customers rows');
  await waitFor(() => (document.querySelectorAll('.tabview.active .grid .td').length > 20 ? true : null), 'grid rendered');
  assertEq((await rows(0, 1))[0].join('|'), '1|Customer 0001|Berlin|37.0', 'first row');
  h.sort(1); // name ascending
  h.sort(1); // descending
  await sleep(150);
  assertEq((await rows(0, 1))[0][1], 'Customer 1000', 'sorted by name, descending');
  h.setFilter('0042');
  await waitFor(() => (h.total() === 1 ? true : null), 'search narrows to one row');
  h.setFilter('');
  h.setWhere("city = 'Warsaw' AND balance > 900");
  await waitFor(() => (h.total() > 0 && h.total() < 200 ? true : null), 'WHERE filter applied');
  log(`WHERE city = 'Warsaw' AND balance > 900 → ${h.total()} rows`);
  h.setWhere('');

  // ---- 100k rows: paging deep into the table ----
  const pj = await measureJank(async () => {
    await h.selectTable('events');
    assertEq(h.total(), 100000, 'events rows');
    const deep = await rows(76543, 76544);
    assertEq(deep[0][0], '76544', 'row 76,544 fetched by page');
  });
  log(`100k-row table page fetch longest UI frame ${Math.round(pj.maxGap)} ms`);

  // ---- edits: change, add, delete → one Save ----
  await h.selectTable('customers');
  await h.onedit(0, 1, 'Renamed One');
  await h.onedit(1, 2, 'NULL');
  assertEq(h.changes(), 2, 'two pending changes');
  assert(tab.dirty, 'tab dirty');
  assertEq((await rows(0, 2)).map((r) => r[1] + '/' + r[2]).join(','), 'Renamed One/Berlin,Customer 0002/NULL', 'grid shows pending values');
  h.addRow();
  await h.onedit(1000, 1, 'Brand New');
  // Customers 501–1000 have no orders, so they can be deleted (foreign keys are on).
  h.select({ r0: 900, c0: 0, r1: 901, c1: 0 });
  await h.deleteSelected();
  assertEq(h.changes(), 5, 'edit, NULL, new row (+cell), two deletions');
  assert(await h.save(), `saved (${ui.toasts.map((t) => t.message).join(' | ')})`);
  assert(!tab.dirty && h.changes() === 0, 'clean after save');
  // Verify through a fresh connection.
  const o = await api.DBOpen(path, true);
  const r = await api.DBExec(o.id, "SELECT name, city FROM customers WHERE id IN (1, 2); SELECT count(*) FROM customers; SELECT count(*) FROM customers WHERE name = 'Brand New'; SELECT count(*) FROM audit", 10);
  api.DBClose(o.id);
  assertEq(JSON.stringify(r[0].rows), '[["Renamed One","Berlin"],["Customer 0002",null]]', 'edits written');
  assertEq(r[1].rows![0][0], 999, 'one added, two deleted');
  assertEq(r[2].rows![0][0], 1, 'new row written');
  assertEq(r[3].rows![0][0], 2, 'trigger ran for the updates');

  // ---- a failing save keeps the changes (customer 1 has orders) ----
  h.select({ r0: 0, c0: 0, r1: 0, c1: 0 });
  await h.deleteSelected();
  assert(!(await h.save()), 'deleting a referenced row is refused');
  assert(ui.toasts.some((t) => /FOREIGN KEY/i.test(t.message)), 'the database error is shown');
  assertEq(h.changes(), 1, 'the change is still pending');
  h.revert();

  // ---- revert ----
  await h.onedit(0, 1, 'Not kept');
  h.revert();
  assertEq(h.changes(), 0, 'revert drops pending changes');
  assertEq((await rows(0, 1))[0][1], 'Renamed One', 'original value back');

  // ---- SQL console ----
  h.setPane('sql');
  const con = await waitFor(() => h.console(), 'SQL console');
  con.setText("SELECT city, count(*) AS n FROM customers GROUP BY city ORDER BY n DESC;\nUPDATE settings SET v = 'PLN' WHERE k = 'currency';\nSELECT v FROM settings");
  const sj = await measureJank(async () => {
    await con.run();
  });
  const shown = con.shownResult();
  assertEq(JSON.stringify(shown.rows), '[["PLN"]]', 'last SELECT shown');
  await waitFor(() => (document.querySelector('.tabview.active .console .msg')?.textContent?.includes('1 row') ? true : null), 'result message');
  log(`SQL run longest UI frame ${Math.round(sj.maxGap)} ms`);
  con.setText('SELECT * FROM nowhere');
  await con.run();
  assert(con.shownResult().error?.includes('no such table'), 'SQL error shown');

  // ---- CSV export ----
  const out = join(dir, 'db', 'customers.csv');
  const n = await api.DBExportCSV(o.id, { table: 'customers', offset: 0, limit: 0 } as never, '', out).catch(() => -1);
  assert(n === -1, 'closed handle refused');
  h.setPane('data');
  await h.selectTable('customers');
  h.setFilter('Warsaw');
  await waitFor(() => (h.total() > 0 && h.total() < 1000 ? true : null), 'filtered for export');
  const ro = await api.DBOpen(path, true);
  const exported = await api.DBExportCSV(ro.id, { table: 'customers', search: 'Warsaw', offset: 0, limit: 0 } as never, '', out);
  api.DBClose(ro.id);
  const text = new TextDecoder().decode(await readFile(out));
  assert(text.startsWith('id,name,city,balance\n') && exported === h.total(), `exported ${exported} filtered rows`);

  // ---- read-only ----
  await h.toggleReadOnly();
  await waitFor(() => (h.readOnly() ? true : null), 'read-only');
  await h.onedit(0, 1, 'blocked');
  assertEq(h.changes(), 0, 'read-only ignores edits');
  await workspace.close(tab, { force: true });
}
