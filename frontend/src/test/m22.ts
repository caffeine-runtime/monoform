// M22: Compare — code (line + word diff, ignore whitespace, only changes,
// next/previous), JSON (structural changes, key order ignored), CSV (rows by
// key), images (changed pixels, swipe), binary (first differing byte) and a
// 100,000-line pair for speed.
import { join } from '../core/paths';
import { compareFiles } from '../core/compare';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const hooks = (t: Tab) => (t as unknown as { compareTest?: Hooks }).compareTest;

async function open(dir: string, a: string, b: string, done: (h: Hooks) => unknown = (h) => h.result()) {
  compareFiles(join(dir, 'compare', a), join(dir, 'compare', b));
  const tab = workspace.active!;
  assertEq(tab.moduleId, 'compare', 'compare tab');
  const h = await waitFor(() => hooks(tab), 'compare view');
  await waitFor(() => (done(h) ? true : null), `${a} ↔ ${b} compared`, 20000);
  return { tab, h };
}

export default async function m22(dir: string) {
  // ---- code ----
  const t0 = performance.now();
  const code = await open(dir, 'a.ts', 'b.ts');
  log(`code compared in ${Math.round(performance.now() - t0)} ms`);
  let r = code.h.result();
  assertEq(code.h.kind(), 'text', 'text mode');
  assertEq(r.hunks.length, 4, 'four changes');
  assertEq(JSON.stringify(r.stats), JSON.stringify({ same: 66, changed: 2, removed: 1, added: 1 }), 'stats');
  code.h.go(1);
  code.h.go(1);
  assertEq(code.h.current(), 1, 'second change');
  await waitFor(() => (document.querySelector('.tabview.active .pane[data-side="1"] .row.cur .w')?.textContent === '3' ? true : null), 'changed word highlighted on the right');
  assertEq(document.querySelector('.tabview.active .pane[data-side="0"] .row.cur .w')?.textContent, '2', 'and on the left');
  code.h.set({ ignoreWs: true });
  await code.h.run();
  assertEq(code.h.result().hunks.length, 3, 'indentation ignored');
  code.h.set({ onlyChanges: true });
  await sleep(30);
  const f = code.h.folded();
  assert(f.gaps.length >= 2 && f.disp.length < 30, `unchanged lines folded (${f.disp.length} shown, ${f.gaps.length} gaps)`);
  await workspace.close(code.tab);

  // ---- JSON ----
  const js = await open(dir, 'a.json', 'b.json');
  r = js.h.result();
  assertEq(js.h.kind(), 'data', 'data mode');
  assertEq(r.changes.map((c: any) => `${c.kind}:${c.path}`).join(' '), 'changed:$.version removed:$.deps.y changed:$.tags[1] added:$.deps.z', 'structural changes');
  assertEq(r.hunks.length, 3, 'normalised side by side ignores key order and formatting');
  await workspace.close(js.tab);

  // ---- CSV ----
  const csv = await open(dir, 'a.csv', 'b.csv');
  r = csv.h.result();
  assertEq(r.rowChanges.map((c: any) => `${c.kind}:${c.key}`).join(' '), 'removed:2 changed:3 added:4', 'rows matched by id');
  assertEq(r.rowChanges[1].cells[0].name, 'city', 'changed cell named');
  csv.h.set({ view: 'changes' });
  await waitFor(() => (document.querySelectorAll('.tabview.active .changes tbody tr').length === 3 ? true : null), 'changes table');
  await workspace.close(csv.tab);

  // ---- images ----
  const img = await open(dir, 'a.png', 'b.png', (h) => h.image());
  assertEq(img.h.kind(), 'image', 'image mode');
  assertEq(img.h.image().changed, 100, '10×10 changed pixels');
  img.h.set({ imageMode: 'swipe' });
  await waitFor(() => document.querySelector('.tabview.active .handle'), 'swipe handle');
  img.h.set({ imageMode: 'diff', tol: 255 });
  await waitFor(() => (img.h.image().changed === 0 ? true : null), 'tolerance hides the difference');
  await workspace.close(img.tab);

  // ---- binary ----
  const bin = await open(dir, 'a.bin', 'b.bin');
  assertEq(bin.h.result().kind, 'binary', 'binary mode');
  assertEq(bin.h.result().firstDiff, 8192, 'first differing byte');
  await workspace.close(bin.tab);

  // ---- big ----
  let big!: { tab: Tab; h: Hooks };
  const t1 = performance.now();
  const bj = await measureJank(async () => {
    big = await open(dir, 'big-a.txt', 'big-b.txt');
  });
  log(`100,000-line compare in ${Math.round(performance.now() - t1)} ms (diff ${big.h.result().ms} ms in the worker), longest UI frame ${Math.round(bj.maxGap)} ms`);
  assertEq(big.h.result().hunks.length, 50, '50 changes');
  await workspace.close(big.tab);
  const bj2 = await measureJank(async () => {
    big = await open(dir, 'big-a.txt', 'big-b.txt');
  });
  log(`again: longest UI frame ${Math.round(bj2.maxGap)} ms`);
  const sj = await measureJank(async () => {
    for (let i = 0; i < 10; i++) {
      big.h.go(1);
      await sleep(50);
    }
  });
  log(`jumping between changes: longest UI frame ${Math.round(sj.maxGap)} ms`);
  await waitFor(() => (document.querySelector('.tabview.active .pane[data-side="1"] .row.cur')?.textContent?.includes('line changed 9') ? true : null), 'tenth change shown');
  await workspace.close(big.tab);
}
