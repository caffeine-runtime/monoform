// M1 acceptance: byte-exact round trips, large files, folder search,
// external changes, markdown preview, image paste.
import { api, readFile } from '../core/backend';
import { commands } from '../core/commands';
import { join, basename } from '../core/paths';
import { folderSearch } from '../core/search.svelte';
import { sidebar } from '../core/sidebar.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { controllers } from '../modules/text/controllers';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

function same(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

async function openText(path: string) {
  const tab = (await workspace.openPath(path))!;
  const ctl = await waitFor(() => {
    const c = controllers.get(tab.id);
    return c && !c.loading && tab.status.encoding ? c : null;
  }, `editor for ${basename(path)}`, 20000);
  return { tab, ctl };
}

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

export async function roundtrip(dir: string) {
  const files = [
    'utf8-lf.txt',
    'utf8-crlf.txt',
    'utf8-mixed.txt',
    'utf8-bom.txt',
    'utf16le.txt',
    'utf16be.txt',
    'cp1252.txt',
    'cr-only.txt',
    'empty.txt',
    'no-final-newline.go',
    'bom-in-middle.txt',
  ];
  const expected: Record<string, string> = {
    'utf8-lf.txt': 'UTF-8/LF',
    'utf8-crlf.txt': 'UTF-8/CRLF',
    'utf8-mixed.txt': 'UTF-8/Mixed',
    'utf8-bom.txt': 'UTF-8 with BOM/LF',
    'utf16le.txt': 'UTF-16 LE/CRLF',
    'utf16be.txt': 'UTF-16 BE/LF',
    'cp1252.txt': 'Windows-1252/LF',
    'cr-only.txt': 'UTF-8/CR',
  };
  for (const name of files) {
    const p = join(dir, 'enc', name);
    const before = await readFile(p);
    const { tab, ctl } = await openText(p);
    const label = `${tab.status.encoding}/${tab.status.eol}`;
    if (expected[name]) assertEq(label, expected[name], `${name} detection`);
    // 1) Save without changes.
    assert(!tab.dirty, `${name} clean after open`);
    assert(await ctl.save(), `${name} saved`);
    assert(same(before, await readFile(p)), `${name} unchanged save is byte-identical`);
    // 2) Edit, undo back, save.
    const v = ctl.view;
    v.dispatch({ changes: { from: 0, insert: 'XYZ' } });
    assert(tab.dirty, `${name} dirty after edit`);
    v.dispatch({ changes: { from: 0, to: 3, insert: '' } });
    await sleep(350);
    assert(!tab.dirty, `${name} clean again after undoing the edit`);
    await ctl.save();
    assert(same(before, await readFile(p)), `${name} edit+revert save is byte-identical`);
    log(`roundtrip ok: ${name} (${label})`);
    await workspace.close(tab, { force: true });
  }

  // Real edit keeps CRLF and encoding.
  const p = join(dir, 'enc', 'utf16le.txt');
  const { tab, ctl } = await openText(p);
  ctl.view.dispatch({ changes: { from: ctl.view.state.doc.length, insert: 'nowa linia\n' } });
  await ctl.save();
  const bytes = new Uint8Array(await readFile(p));
  const text = new TextDecoder('utf-16le', { ignoreBOM: true }).decode(bytes);
  assertEq(text, '﻿UTF-16 tekst ż\r\nnowa linia\r\n', 'edited UTF-16 file keeps BOM and CRLF');
  assert(!tab.dirty, 'clean after save');
  await closeAll();
}

export async function large(dir: string) {
  const p = join(dir, 'big.log');
  const prof: Record<string, { n: number; max: number; sum: number }> = {};
  (globalThis as any).__mfProf = (label: string, ms: number) => {
    const e = (prof[label] ??= { n: 0, max: 0, sum: 0 });
    e.n++;
    e.max = Math.max(e.max, ms);
    e.sum += ms;
  };
  // Long frames timeline.
  const gaps: string[] = [];
  let last = performance.now();
  let on = true;
  const t00 = performance.now();
  const tick = (t: number) => {
    if (t - last > 60) gaps.push(`${Math.round(last - t00)}+${Math.round(t - last)}`);
    last = t;
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  const { result, maxGap, frames } = await measureJank(async () => {
    const r = await openText(p);
    return r;
  });
  const openMs = performance.now() - t0;
  const { ctl, tab } = result;
  on = false;
  (globalThis as any).__mfProf = undefined;
  log(`load profile: ${Object.entries(prof).map(([k, v]) => `${k} n=${v.n} max=${v.max.toFixed(0)} sum=${v.sum.toFixed(0)}`).join('; ')}; long frames at ${gaps.join(', ')}`);
  const lines = ctl.view.state.doc.lines;
  log(`50 MB open: ${Math.round(openMs)} ms, ${lines} lines, longest frame gap ${Math.round(maxGap)} ms over ${frames} frames, size ${tab.size}`);
  assert(lines >= 580000, 'all lines loaded');
  // Scroll through the file and type at the end.
  const scroll = await measureJank(async () => {
    const s = ctl.view.scrollDOM;
    for (let i = 0; i < 30; i++) {
      s.scrollTop = (s.scrollHeight * i) / 30;
      await sleep(16);
    }
    ctl.view.dispatch({ selection: { anchor: ctl.view.state.doc.length }, scrollIntoView: true });
    ctl.view.dispatch({ changes: { from: ctl.view.state.doc.length, insert: 'typed at the end\n' } });
    await sleep(100);
  });
  log(`50 MB scroll+type: longest frame gap ${Math.round(scroll.maxGap)} ms`);
  const find = await measureJank(async () => {
    ctl.find();
    await sleep(200);
  });
  log(`50 MB open search panel: longest gap ${Math.round(find.maxGap)} ms`);
  const save = await measureJank(async () => {
    const t = performance.now();
    await ctl.save();
    log(`50 MB save: ${Math.round(performance.now() - t)} ms`);
  });
  log(`50 MB save: longest frame gap ${Math.round(save.maxGap)} ms`);
  const size = (await api.Stat(p)).size;
  assertEq(size, tab.size!, 'saved size reported');
  await closeAll();
  // Record but don't fail on frame gaps: software rendering in CI varies.
  (globalThis as any).__largeGaps = { open: maxGap, scroll: scroll.maxGap, save: save.maxGap };
}

export async function search(dir: string) {
  await workspace.openFolder(dir);
  commands.execute('search.inFolder');
  await waitFor(() => sidebar.mode === 'search', 'search panel');
  folderSearch.query = 'needle';
  const t0 = performance.now();
  await folderSearch.run(join(dir, 'corpus'));
  const total = folderSearch.results.reduce((n, r) => n + r.matches.length, 0);
  log(`search: ${total} matches in ${folderSearch.results.length} files, ${Math.round(performance.now() - t0)} ms`);
  assertEq(total, 20, 'match count');
  assertEq(folderSearch.summary?.scanned, 200, 'files scanned');
  // Click the first result: opens the file at the match.
  const btn = await waitFor(() => document.querySelector<HTMLButtonElement>('.search .match'), 'result rows');
  btn.click();
  const tab = await waitFor(() => (workspace.active?.title.startsWith('file') ? workspace.active : null), 'opened result');
  const ctl = await waitFor(() => controllers.get(tab.id), 'controller');
  await waitFor(() => ctl.view.state.selection.main.from !== ctl.view.state.selection.main.to, 'match selected');
  const sel = ctl.view.state.sliceDoc(ctl.view.state.selection.main.from, ctl.view.state.selection.main.to);
  assertEq(sel, 'needle', 'match selected in editor');
  assertEq(ctl.view.state.doc.lineAt(ctl.view.state.selection.main.head).number, 2, 'on line 2');
  // Regex + case.
  folderSearch.query = 'needle in file 1\\d0';
  folderSearch.regex = true;
  await folderSearch.run(join(dir, 'corpus'));
  assertEq(folderSearch.results.length, 10, 'regex results');
  folderSearch.regex = false;
  sidebar.mode = 'files';
  await closeAll();
}

export async function external(dir: string) {
  const p = join(dir, 'enc', 'utf8-lf.txt');
  const { tab, ctl } = await openText(p);
  await sleep(300);
  await api.TestWriteFile(p, 'changed by someone else\n');
  await waitFor(() => tab.external === 'changed', 'external change banner', 5000);
  assert(document.querySelector('.tabview.active .banner'), 'banner shown');
  await workspace.reloadTab(tab);
  await waitFor(() => ctl.view.state.doc.toString() === 'changed by someone else\n', 'reloaded content');
  // Our own save must not trigger the banner.
  ctl.view.dispatch({ changes: { from: 0, insert: 'mine ' } });
  await ctl.save();
  await sleep(800);
  assertEq(tab.external, null, 'own save not reported as external');
  // Restore fixture.
  await api.TestWriteFile(p, 'zażółć gęślą jaźń\nline 2\n');
  await closeAll();
}

export async function markdown(dir: string) {
  const p = join(dir, 'notes', 'index.md');
  const tab = (await workspace.openPath(p))!;
  assertEq(tab.moduleId, 'markdown', 'markdown module chosen');
  const preview = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .preview h1'), 'preview heading');
  assertEq(preview.textContent, 'Notes', 'preview renders');
  const ctl = await waitFor(() => controllers.get(tab.id), 'controller');
  // Live preview.
  ctl.view.dispatch({ changes: { from: ctl.view.state.doc.length, insert: '\n### Added live\n' } });
  await waitFor(() => document.querySelector('.tabview.active .preview h3')?.textContent === 'Added live', 'live update');
  // Paste an image.
  const png = await readFile(join(dir, 'img', 'red.png'));
  const file = new File([png], 'image.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  ctl.view.dispatch({ selection: { anchor: ctl.view.state.doc.length } });
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ctl.view.contentDOM.dispatchEvent(ev);
  await waitFor(() => /!\[pasted-[^\]]*\]\(assets\/pasted-[\w-]+\.png\)/.test(ctl.view.state.doc.toString()), 'image link inserted');
  const link = ctl.view.state.doc.toString().match(/\(assets\/(pasted-[\w-]+\.png)\)/)![1];
  const saved = await api.Stat(join(dir, 'notes', 'assets', link));
  assertEq(saved.size, png.byteLength, 'asset written to assets/');
  const img = await waitFor(() => document.querySelector<HTMLImageElement>('.tabview.active .preview img'), 'preview img');
  await waitFor(() => img.complete && img.naturalWidth === 40, 'pasted image loads in preview');
  // View modes.
  commands.execute('markdown.preview');
  await waitFor(() => document.querySelector('.tabview.active .panes[data-view=preview]'), 'preview only');
  commands.execute('markdown.source');
  await waitFor(() => !document.querySelector('.tabview.active .preview'), 'source only');
  commands.execute('markdown.split');
  // Relative link opens inside the app.
  const a = await waitFor(() => document.querySelector<HTMLAnchorElement>('.tabview.active .preview a[data-file]'), 'link');
  a.click();
  await waitFor(() => workspace.active?.title === 'other.md', 'linked note opened');
  await workspace.save(tab);
  await closeAll();
}

export async function baseline(dir: string) {
  const idle = await measureJank(() => sleep(1000));
  log(`baseline idle (welcome screen): longest gap ${Math.round(idle.maxGap)} ms, ${idle.frames} frames/s`);
  const { ctl } = await openText(join(dir, 'enc', 'utf8-lf.txt'));
  const idle2 = await measureJank(() => sleep(1000));
  log(`baseline idle (small file open): longest gap ${Math.round(idle2.maxGap)} ms, ${idle2.frames} frames/s`);
  const typing = await measureJank(async () => {
    for (let i = 0; i < 30; i++) {
      ctl.view.dispatch({ changes: { from: ctl.view.state.doc.length, insert: 'x' } });
      await sleep(16);
    }
  });
  log(`baseline typing (small file): longest gap ${Math.round(typing.maxGap)} ms`);
  await closeAll();
  const { ctl: big } = await openText(join(dir, 'big.log'));
  await sleep(500);
  const idle3 = await measureJank(() => sleep(1000));
  log(`idle with 50 MB open: longest gap ${Math.round(idle3.maxGap)} ms, ${idle3.frames} frames/s`);
  const typing2 = await measureJank(async () => {
    for (let i = 0; i < 30; i++) {
      big.view.dispatch({ changes: { from: 0, insert: 'x' } });
      await sleep(16);
    }
  });
  log(`typing in 50 MB file: longest gap ${Math.round(typing2.maxGap)} ms`);
  await closeAll();
}

export default async function all(dir: string) {
  await roundtrip(dir);
  await external(dir);
  await search(dir);
  await markdown(dir);
  await large(dir);
}
