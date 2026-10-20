// M23: more data formats and logs — XML and TOML in the data tree (and "as
// JSON"), JSON Lines and arrays of records as a table, log files with level
// counts, filter (text, regex, levels), next error and follow (appended bytes
// only).
import { api, readFile, saveFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const data = (t: Tab) => (t as unknown as { dataTest?: Hooks }).dataTest;
const logs = (t: Tab) => (t as unknown as { logTest?: Hooks }).logTest;

async function openData(path: string) {
  const tab = (await workspace.openPath(path))!;
  assertEq(tab.moduleId, 'data', `${path} opens in the data view`);
  const h = await waitFor(() => data(tab), 'data hooks');
  await waitFor(() => (h.root() || h.error() ? true : null), `${path} parsed`);
  return { tab, h };
}

export default async function m23(dir: string) {
  // ---- XML ----
  const x = await openData(join(dir, 'data', 'catalog.xml'));
  assertEq(x.h.error(), null, 'XML valid');
  const xs = await x.h.client.stringify(0);
  assertEq(xs.text, '{"catalog":{"@lang":"en","book":[{"@id":"1","title":"Tom & Jerry","price":"9.5"},{"@id":"2","title":"<b>Bold</b>","price":"12"}]}}', 'XML as JSON');
  await waitFor(() => (document.querySelector('.tabview.active .status.good')?.textContent?.includes('Valid XML') ? true : null), 'shows Valid XML');
  // Break it: the error points at the line.
  const v = x.h.ctl().view;
  v.dispatch({ changes: { from: v.state.doc.toString().indexOf('</price></book>'), to: v.state.doc.toString().indexOf('</price></book>') + 8, insert: '' } });
  await x.h.reparse();
  assert(x.h.error()?.message.includes('Expected </price>') && x.h.error().line === 4, `XML error located (${JSON.stringify(x.h.error())})`);
  await workspace.close(x.tab, { force: true });

  // ---- TOML ----
  const t = await openData(join(dir, 'data', 'config.toml'));
  assertEq((await t.h.client.stringify(0)).text, '{"title":"Hold It All","server":{"port":8080,"hosts":["a","b"],"started":"2026-10-20T12:00:00.000Z"},"users":[{"name":"ann"},{"name":"bob"}]}', 'TOML as JSON');
  t.h.setView('json');
  await waitFor(() => (document.querySelector('.tabview.active .jsonhost .cm-content')?.textContent?.includes('"port": 8080') ? true : null), 'As JSON view');
  await workspace.close(t.tab, { force: true });

  // ---- JSON Lines + table ----
  const t0 = performance.now();
  const j = await openData(join(dir, 'data', 'events.jsonl'));
  log(`5,000-line JSONL parsed in ${Math.round(performance.now() - t0)} ms`);
  assertEq(j.h.root().size, 5000, 'one record per line');
  await waitFor(() => (document.querySelector('.tabview.active .status.good')?.textContent?.includes('5,000 records') ? true : null), 'record count shown');
  const rows = (await j.h.client.rows(0, 2)).rows;
  assertEq(JSON.stringify(rows), JSON.stringify([['0', 'open', '0', '{"n":0}'], ['1', 'save', '7', '']]), 'table rows (columns id, kind, ms, extra)');
  j.h.setView('table');
  await waitFor(() => (document.querySelectorAll('.tabview.active .pane.grid .td').length > 20 ? true : null), 'table rendered');
  await workspace.close(j.tab, { force: true });
  const p = await openData(join(dir, 'data', 'people.json'));
  assertEq(JSON.stringify((await p.h.client.rows(299, 300)).rows), '[["P299","69","Paris"]]', 'JSON array of objects as a table');
  await workspace.close(p.tab, { force: true });

  // ---- logs ----
  const path = join(dir, 'logs', 'app.log');
  const tab = (await workspace.openPath(path))!;
  assertEq(tab.moduleId, 'log', '.log opens in the log view');
  const h = await waitFor(() => logs(tab), 'log hooks');
  await waitFor(() => (h.lines() > 3000 && !h.scanning() ? true : null), 'levels counted');
  const c = h.counts();
  assertEq(`${c[1]} ${c[2]} ${c[3]} ${c[4]} ${c[5]}`, '1 500 500 1500 500', 'fatal/error/warn/info/debug counts');
  await waitFor(() => document.querySelector('.tabview.active .cm-log-error .cm-log-lv-error'), 'error line coloured');
  await h.setQuery('svc-3');
  assertEq(h.matches().length, 750, 'text filter');
  await h.setQuery('event 1\\d\\d done', true);
  assertEq(h.matches().length, 100, 'regex filter');
  await h.setQuery('');
  await h.setShown({ info: false, debug: false, warn: false });
  // Errors and their stack-trace lines (inherited level), plus the fatal line.
  assertEq(h.matches().length, 1 + 500 * 3, 'level filter keeps stack traces with their error');
  await h.setShown({ info: true, debug: true, warn: true });
  h.nextError();
  const first = h.line();
  assert(first > 1, `next error jumps (line ${first})`);
  h.nextError();
  assert(h.line() > first, 'and again');
  // Follow: append to the file; only the new bytes are read.
  h.setFollow(true);
  const before = h.lines();
  const orig = new TextDecoder().decode(await readFile(path));
  const fj = await measureJank(async () => {
    await saveFile(path, orig + '2026-10-20T14:00:00Z ERROR [svc-9] appended line ż\n');
    await waitFor(() => (h.lines() === before + 1 ? true : null), 'appended line shown', 8000);
  });
  log(`follow: new line shown, longest UI frame ${Math.round(fj.maxGap)} ms`);
  await waitFor(() => (h.counts()[2] === 501 ? true : null), 'new error counted');
  assert(!h.dirty(), 'following does not mark the file edited');
  const st = await api.Stat(path);
  assertEq(tab.size, st.size, 'size tracked');
  h.setFollow(false);
  await sleep(50);
  await workspace.close(tab, { force: true });
}
