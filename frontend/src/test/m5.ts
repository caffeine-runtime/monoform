// M5: browse archives, open inner files, extract (with zip-slip protection),
// create a ZIP. Created files are checked by scripts/verify-archives.sh.
import { api } from '../core/backend';
import { jobs } from '../core/jobs.svelte';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { tree } from '../core/tree.svelte';
import { assert, assertEq, log, waitFor } from './harness';

const ah = (t: Tab) => (t as any).archiveTest;

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

async function exists(p: string) {
  try {
    await api.Stat(p);
    return true;
  } catch {
    return false;
  }
}

export default async function m5(dir: string) {
  const A = join(dir, 'archives');
  // Browse a zip and open inner files read-only in their own modules.
  const z = (await workspace.openPath(join(A, 'sample.zip')))!;
  assertEq(z.moduleId, 'archive', 'archive module');
  const h = await waitFor(() => (ah(z)?.info() ? ah(z) : null), 'zip listed');
  assertEq(h.info().format, 'zip', 'format');
  await waitFor(() => document.querySelectorAll('.tabview.active .list .row:not(.head)').length === 3, 'root rows (docs, img, top.txt)');
  h.go('docs');
  await waitFor(() => [...document.querySelectorAll('.tabview.active .list .nm')].some((e) => e.textContent === 'readme.md'), 'docs folder');
  const md = await workspace.openArchiveEntry(join(A, 'sample.zip'), 'docs/readme.md');
  assert(md.readOnly, 'inner file is read-only');
  assertEq(md.moduleId, 'markdown', 'opened in markdown module');
  await waitFor(() => document.querySelector('.tabview.active .preview h1')?.textContent === 'Inside a zip', 'inner markdown rendered');
  const img = await workspace.openArchiveEntry(join(A, 'sample.zip'), 'img/red.png');
  assertEq(img.moduleId, 'image', 'image module');
  await waitFor(() => (img as any).imageTest?.editor()?.width === 40, 'inner image decoded');
  await closeAll();

  // Sidebar tree expands archives like folders.
  await workspace.openFolder(A);
  await waitFor(() => tree.children.get(A)?.length, 'folder listed');
  const zipItem = tree.item(join(A, 'sample.zip'))!;
  assert(zipItem.expandable, 'zip is expandable in the tree');
  await tree.toggle(zipItem, true);
  const kids = await waitFor(() => tree.children.get(zipItem.id), 'zip children in tree');
  assertEq(kids.map((k) => k.name).join(','), 'docs,img,top.txt', 'tree shows archive root');
  const docs = kids.find((k) => k.name === 'docs')!;
  await tree.toggle(docs, true);
  await waitFor(() => tree.children.get(docs.id)?.some((k) => k.name === 'deep'), 'nested archive folder in tree');

  // Extract all formats.
  for (const name of ['sample.zip', 'sample.tar.gz', 'sample.7z', 'sample.rar']) {
    const dest = join(A, 'out', name.replace(/\W/g, '_'));
    const done = await jobs.run<any>('extract', () => api.ArchiveExtract(join(A, name), dest, { entries: [], existing: 'overwrite', limits: { maxEntries: 0, maxBytes: 0, maxRatio: 0, ratioFloor: 0 } } as any));
    assert(!done.error, `${name}: ${done.error}`);
    log(`${name}: extracted ${done.result.files} files`);
    assert(done.result.files >= 2, `${name} files`);
  }
  assert(await exists(join(A, 'out', 'sample_zip', 'docs', 'deep', 'data.csv')), 'zip nested file');
  assert(await exists(join(A, 'out', 'sample_7z', 'docs', 'readme.txt')), '7z file');
  assert(await exists(join(A, 'out', 'sample_rar', 'music', 'list.txt')), 'rar file');

  // RAR and 7z show the read-only explanation (not a disabled button).
  const r = (await workspace.openPath(join(A, 'sample.rar')))!;
  await waitFor(() => document.querySelector('.tabview.active .banner')?.textContent?.includes('RAR compression is proprietary'), 'rar read-only note');
  await workspace.close(r, { force: true });

  // Zip slip.
  const slipDest = join(A, 'out', 'slip');
  const s = await jobs.run<any>('extract', () => api.ArchiveExtract(join(A, 'slip.zip'), slipDest, { entries: [], existing: 'overwrite', limits: { maxEntries: 0, maxBytes: 0, maxRatio: 0, ratioFloor: 0 } } as any));
  assert(!s.error, `slip: ${s.error}`);
  log(`slip.zip: ${s.result.files} extracted, skipped: ${s.result.skipped.map((k: any) => `${k.name} (${k.reason})`).join('; ')}`);
  assertEq(s.result.files, 1, 'only the safe file');
  assert(!(await exists(join(A, 'out', 'escaped.txt'))) && !(await exists(join(A, 'escaped.txt'))), 'nothing escaped');

  // Create a ZIP from a folder and a file.
  const created = join(A, 'out', 'created.zip');
  const c = await jobs.run<any>('zip', () => api.ArchiveCreateZip([join(A, 'out', 'sample_zip', 'docs'), join(A, 'out', 'sample_zip', 'top.txt')], created));
  assert(!c.error, `create: ${c.error}`);
  const info = await api.ArchiveList(created);
  assertEq(info.entries.filter((e) => !e.isDir).map((e) => e.name).join(','), 'docs/deep/data.csv,docs/readme.md,top.txt', 'created zip contents');
  assert(info.writable, 'zip is writable format');
}
