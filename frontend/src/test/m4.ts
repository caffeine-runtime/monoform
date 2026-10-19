// M4 acceptance: invalid JSON shows the right line/column; 1M-row CSV
// scrolls smoothly and sorts; YAML tree/JSON; CSV edits and byte-exact saves.
import { readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const dataHooks = (t: Tab) => (t as any).dataTest;
const csvHooks = (t: Tab) => (t as any).csvTest;

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

function same(a: ArrayBuffer, b: ArrayBuffer) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.every((v, i) => v === y[i]);
}

export default async function m4(dir: string) {
  // --- invalid JSON ---
  const bad = (await workspace.openPath(join(dir, 'data', 'invalid.json')))!;
  assertEq(bad.moduleId, 'data', 'data module');
  const err = await waitFor(() => dataHooks(bad)?.error(), 'parse error');
  log(`invalid.json: line ${err.line}, column ${err.col}: ${err.message}`);
  assertEq(`${err.line}:${err.col}`, '4:6', 'error position matches Python json');
  const shown = await waitFor(() => document.querySelector('.tabview.active .status.bad')?.textContent, 'error shown in toolbar');
  assert(shown!.includes('Line 4, column 6'), 'toolbar shows line/column');
  (document.querySelector('.tabview.active .status.bad') as HTMLElement).click();
  const ctl = dataHooks(bad).ctl();
  await waitFor(() => !document.querySelector('.tabview.active .raw.hidden'), 'raw view shown');
  const head = ctl.view.state.selection.main.head;
  const line = ctl.view.state.doc.lineAt(head);
  assertEq(`${line.number}:${head - line.from + 1}`, '4:6', 'cursor placed at the error');
  // Fix it and the tree appears.
  ctl.view.dispatch({ changes: { from: line.from + 5, insert: ']' } }); // `  "c"` -> `  "c"]`... produces other error; replace properly below
  ctl.view.dispatch({ changes: { from: 0, to: ctl.view.state.doc.length, insert: '{"a": 1, "b": [1, 2], "c": "fixed"}' } });
  await waitFor(() => dataHooks(bad).root() && !dataHooks(bad).error(), 'valid after fix');
  await closeAll();

  // --- valid JSON: tree, copy path, format/minify, save ---
  const js = (await workspace.openPath(join(dir, 'data', 'sample.json')))!;
  const h = await waitFor(() => (dataHooks(js)?.root() ? dataHooks(js) : null), 'json root');
  await waitFor(() => document.querySelectorAll('.tabview.active .tree .row').length >= 6, 'top-level rows');
  await h.tree().expandAll();
  await waitFor(() => [...document.querySelectorAll('.tabview.active .tree .row .k')].some((e) => e.textContent === 'x key'), 'deep node visible');
  const deep = [...document.querySelectorAll<HTMLElement>('.tabview.active .tree .row')].find((r) => r.querySelector('.k')?.textContent === 'x key')!;
  deep.click();
  await sleep(30);
  assertEq(JSON.stringify(h.selected()), '["nested","deep","list",2,"x key"]', 'selected path');
  assert(document.querySelector('.tabview.active .toolbar')!.textContent!.includes('$.nested.deep.list[2]["x key"]'), 'path shown');
  await h.reformat(0);
  await waitFor(() => !h.ctl().view.state.doc.toString().includes('\n'), 'minified');
  await h.reformat(2);
  await waitFor(() => h.ctl().view.state.doc.toString().startsWith('{\n  "name"'), 'pretty');
  assert(await workspace.save(js), 'saved json');
  const saved = new TextDecoder().decode(await readFile(join(dir, 'data', 'sample.json')));
  assert(JSON.parse(saved).nested.deep.list[2]['x key'] === true, 'saved json valid');
  await closeAll();

  // --- YAML ---
  const y = (await workspace.openPath(join(dir, 'data', 'sample.yaml')))!;
  const yh = await waitFor(() => (dataHooks(y)?.root() ? dataHooks(y) : null), 'yaml root');
  assertEq(yh.root().size, 3, 'yaml keys');
  yh.setView('json');
  try {
    await waitFor(() => document.querySelector('.tabview.active .jsonhost .cm-content')?.textContent?.includes('"ports"'), 'yaml as JSON', 4000);
  } catch (e) {
    const host = document.querySelector('.tabview.active .jsonhost');
    log(`jsonhost: ${host ? host.innerHTML.slice(0, 300) : 'missing'}; err=${JSON.stringify(yh.error())}; str=${JSON.stringify(await yh.client.stringify(2)).slice(0, 200)}`);
    throw e;
  }
  await closeAll();
  const by = (await workspace.openPath(join(dir, 'data', 'invalid.yaml')))!;
  const ye = await waitFor(() => dataHooks(by)?.error(), 'yaml error');
  log(`invalid.yaml: line ${ye.line}, column ${ye.col}: ${ye.message}`);
  assertEq(ye.line, 4, 'yaml error line');
  await closeAll();

  // --- small CSV: detection, byte-exact unchanged save, edit ---
  const semiPath = join(dir, 'data', 'semi.csv');
  const original = await readFile(semiPath);
  const sc = (await workspace.openPath(semiPath))!;
  assertEq(sc.moduleId, 'csv', 'csv module');
  const sh = await waitFor(() => (csvHooks(sc)?.info() ? csvHooks(sc) : null), 'csv loaded');
  const si = sh.info();
  assertEq(`${si.delimiter}|${si.header}|${si.rows}|${si.columns.join(',')}|${si.eol}`, ';|true|3|name,city,amount|CRLF', 'semicolon CSV detected');
  const r0 = await sh.rows(0, 3);
  assertEq(JSON.stringify(r0[1]), JSON.stringify(['Ann', 'Paris\r\nFrance', '7']), 'quoted newline field');
  assert(await sh.save(), 'saved unchanged');
  assert(same(original, await readFile(semiPath)), 'unchanged CSV save is byte-identical');
  await sh.edit(2, 2, '250');
  assert(sc.dirty, 'dirty after edit');
  assert(await sh.save(), 'saved edit');
  const after = new TextDecoder().decode(await readFile(semiPath));
  assertEq(after, 'name;city;amount\r\n"Kowalski; Jan";Kraków;12,50\r\nAnn;"Paris\r\nFrance";7\r\nBob;Rome;250\r\n', 'only the edited cell changed');
  assert(!sc.dirty, 'clean after save');
  await closeAll();

  // --- 1M rows ---
  const t0 = performance.now();
  const load = await measureJank(async () => {
    const tab = (await workspace.openPath(join(dir, 'data', 'million.csv')))!;
    const hh = await waitFor(() => (csvHooks(tab)?.info() ? csvHooks(tab) : null), '1M csv loaded', 60000);
    return { tab, hh };
  });
  const { tab: big, hh } = load.result;
  log(`1M CSV: loaded ${hh.info().rows.toLocaleString()} rows in ${Math.round(performance.now() - t0)} ms, longest frame ${Math.round(load.maxGap)} ms`);
  assertEq(hh.info().rows, 1_000_000, 'row count');
  const scroller = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .grid'), 'grid');
  const gaps: string[] = [];
  let lastT = performance.now();
  let on = true;
  const t00 = performance.now();
  const tick = (t: number) => {
    if (t - lastT > 50) gaps.push(`${Math.round(lastT - t00)}+${Math.round(t - lastT)}`);
    lastT = t;
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const scroll = await measureJank(async () => {
    for (let i = 0; i <= 60; i++) {
      scroller.scrollTop = (scroller.scrollHeight * i) / 60;
      scroller.dispatchEvent(new Event('scroll'));
      await sleep(16);
    }
    // Small, wheel-like steps too.
    for (let i = 0; i < 60; i++) {
      scroller.scrollTop -= 120;
      scroller.dispatchEvent(new Event('scroll'));
      await sleep(16);
    }
  });
  await waitFor(() => !document.querySelector('.tabview.active .td.loading'), 'rows filled after scrolling');
  on = false;
  log(`1M CSV scroll: longest frame ${Math.round(scroll.maxGap)} ms over ${scroll.frames} frames; long frames ${gaps.join(', ')}`);
  const lastRows = await hh.rows(999_999, 1_000_000);
  assertEq(lastRows[0][0], '1000000', 'last row reachable');
  const ts = performance.now();
  const sorted = await measureJank(() => hh.sort(3, -1));
  log(`1M CSV sort by amount (desc): ${Math.round(performance.now() - ts)} ms, longest frame ${Math.round(sorted.maxGap)} ms`);
  const top = await hh.rows(0, 3);
  assertEq(top[0][3], '999.99', 'numeric sort descending');
  assert(Number(top[1][3]) <= Number(top[0][3]), 'sorted order');
  const tf = performance.now();
  await hh.filter('Tallinn');
  log(`1M CSV filter: ${hh.info().rows.toLocaleString()} rows in ${Math.round(performance.now() - tf)} ms`);
  assertEq(hh.info().rows, 125_000, 'filter count');
  await hh.filter('');
  assertEq(hh.info().rows, 1_000_000, 'filter cleared');
  await workspace.close(big, { force: true });
}
