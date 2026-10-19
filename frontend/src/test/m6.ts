// M6: known vectors through the UI, expected-hash comparison, checksum file
// verification, multi-GB progress cadence and cancel.
import { join } from '../core/paths';
import { commands } from '../core/commands';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';
import { on } from '../core/backend';

const hh = (t: Tab) => (t as any).hashTest;

export default async function m6(dir: string) {
  const H = join(dir, 'hash');
  // Tool on "abc" with every algorithm.
  commands.execute('tools.hash', join(H, 'abc.txt'));
  const tab = await waitFor(() => (workspace.active?.moduleId === 'hash' && hh(workspace.active) ? workspace.active : null), 'hash tool');
  const h = hh(tab);
  h.setAlgos(['md5', 'sha1', 'sha256', 'sha512', 'blake3']);
  await h.run();
  const r = await waitFor(() => (Object.keys(h.results()).length === 5 ? h.results() : null), 'all digests');
  assertEq(r.md5, '900150983cd24fb0d6963f7d28e17f72', 'md5("abc")');
  assertEq(r.sha1, 'a9993e364706816aba3e25717850c26c9cd0d89d', 'sha1("abc")');
  assertEq(r.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256("abc")');
  assertEq(r.sha512.slice(0, 16), 'ddaf35a193617aba', 'sha512("abc")');
  assertEq(r.blake3, '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85', 'blake3("abc")');
  h.setExpected('  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD  abc.txt');
  await waitFor(() => h.verdict().kind === 'match', 'match verdict');
  assert(document.querySelector('.tabview.active .verdict.good'), 'match shown');
  h.setExpected('0'.repeat(64));
  await waitFor(() => h.verdict().kind === 'mismatch', 'mismatch verdict');
  assert(document.querySelector('.tabview.active .verdict.bad'), 'mismatch shown');
  // Only SHA-256 selected, then an MD5 is pasted: MD5 is computed automatically.
  h.setAlgos(['sha256']);
  h.setFile(join(H, 'abc.txt'));
  await waitFor(() => !h.running() && h.results().sha256, 'sha256 only');
  h.setExpected('900150983cd24fb0d6963f7d28e17f72');
  await waitFor(() => h.verdict().kind === 'match' && h.verdict().algo === 'md5', 'md5 computed on demand');
  await workspace.close(tab, { force: true });

  // Checksum file.
  const sums = (await workspace.openPath(join(H, 'SHA256SUMS')))!;
  assertEq(sums.moduleId, 'checksum', 'checksum module');
  const s = await waitFor(() => hh(sums)?.summary(), 'verified');
  assertEq(`${s.ok}/${s.bad}/${s.missing}`, '2/1/1', 'ok/mismatch/missing');
  await sleep(50);
  assertEq(document.querySelectorAll('.vlist .vrow').length, 4, 'all verify rows rendered (incl. duplicate name)');
  const md5 = (await workspace.openPath(join(H, 'files.md5')))!;
  const s2 = await waitFor(() => hh(md5)?.summary(), 'md5 verified');
  assertEq(s2.ok, 1, 'md5 file ok');
  await workspace.close(sums, { force: true });
  await workspace.close(md5, { force: true });

  // 3 GiB: progress at least every 250 ms, UI responsive, cancel works.
  const stamps: number[] = [];
  const off = on<{ kind: string }>('job:progress', (p) => {
    if (p.kind === 'hash') stamps.push(performance.now());
  });
  commands.execute('tools.hash', join(H, 'big.bin'));
  const bt = await waitFor(() => (workspace.active?.moduleId === 'hash' && hh(workspace.active) ? workspace.active : null), 'hash tool (big)');
  const bh = hh(bt);
  const jank = await measureJank(async () => {
    await waitFor(() => bh.running() && bh.progress()?.done > 0, 'big hash running', 5000);
    await sleep(2500);
  });
  const p = bh.progress();
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  const maxGap = Math.max(...gaps);
  log(`3 GiB hash: ${stamps.length} progress events in 2.5 s, max interval ${Math.round(maxGap)} ms, ${Math.round(p.done / 2 ** 20)} MiB done, longest UI frame ${Math.round(jank.maxGap)} ms`);
  assert(stamps.length >= 8 && maxGap <= 250, 'progress at least every 250 ms');
  // Cancel from the status bar.
  const cancel = await waitFor(() => document.querySelector<HTMLButtonElement>('.status .job .icon-btn'), 'status-bar cancel button');
  cancel.click();
  await waitFor(() => !bh.running(), 'cancelled', 5000);
  assert(!bh.results().sha256, 'no result after cancel');
  off();
  await workspace.close(bt, { force: true });
}
