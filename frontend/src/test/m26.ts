// M26: packages and disk images browsed like archives — a .deb (control
// fields, inner file opened), an .rpm (header fields, symlink), an .iso
// (Rock Ridge/Joliet long names, extracted), an .msi (Property table, paths
// from its Directory table, a file from the embedded MSZIP cabinet extracted)
// and zip-based .jar/.apk packages.
import { api, readFile } from '../core/backend';
import { jobs } from '../core/jobs.svelte';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, waitFor } from './harness';

const ah = (t: Tab) => (t as unknown as { archiveTest?: Record<string, any> }).archiveTest;
const opts = (entries: string[]) => ({ entries, existing: 'overwrite', limits: { maxEntries: 0, maxBytes: 0, maxRatio: 0, ratioFloor: 0 } }) as any;

async function openPkg(dir: string, name: string, format: string) {
  const tab = (await workspace.openPath(join(dir, 'packages', name)))!;
  assertEq(tab.moduleId, 'archive', `${name} opens in the archive view`);
  const h = await waitFor(() => (ah(tab)?.info() ? ah(tab) : null), `${name} listed`);
  assertEq(h.info().format, format, `${name} format`);
  return { tab, h, info: h.info() };
}

const metaShown = (k: string) => [...document.querySelectorAll('.tabview.active .meta dt')].some((e) => e.textContent === k);

async function extract(dir: string, name: string, entries: string[]) {
  const dest = join(dir, 'packages', 'out', name);
  const done = await jobs.run<any>('extract', () => api.ArchiveExtract(join(dir, 'packages', name), dest, opts(entries)));
  return { dest, result: done.result };
}

export default async function m26(dir: string) {
  // ---- .deb ----
  const deb = await openPkg(dir, 'mf-test.deb', 'deb');
  assertEq(deb.info.meta.Package, 'mf-test', 'deb package name');
  assertEq(deb.info.meta.Version, '1.2.3', 'deb version');
  await waitFor(() => (metaShown('Package') && metaShown('Version') ? true : null), 'package fields shown');
  await waitFor(() => document.querySelector('.tabview.active .banner')?.textContent?.includes('read-only'), 'read-only banner');
  assertEq(deb.tab.status?.type, 'Debian package', 'status names the format');
  const inner = await workspace.openArchiveEntry(join(dir, 'packages', 'mf-test.deb'), 'data/usr/share/mf/hello.txt');
  assert(inner.readOnly, 'inner file read-only');
  await waitFor(() => document.querySelector('.tabview.active .cm-content')?.textContent?.includes('hello from deb'), 'file inside the package opened');
  await workspace.close(inner, { force: true });
  await workspace.close(deb.tab, { force: true });

  // ---- .rpm ----
  const rpm = await openPkg(dir, 'mf-test.rpm', 'rpm');
  assertEq(`${rpm.info.meta.Package} ${rpm.info.meta.Version} ${rpm.info.meta.Architecture}`, 'mf-test 2.0.1 noarch', 'rpm header');
  const link = rpm.info.entries.find((e: any) => e.name === 'usr/share/mf/link.txt');
  assertEq(link?.link, 'hello.txt', 'symlink target');
  await workspace.close(rpm.tab, { force: true });

  // ---- .iso ----
  const iso = await openPkg(dir, 'mf-test.iso', 'iso');
  assertEq(iso.info.meta.Volume, 'MF_TEST', 'volume label');
  const long = 'docs/a long folder name/Read Me (long name).txt';
  assert(iso.info.entries.some((e: any) => e.name === long), 'long file names');
  iso.h.go('docs/a long folder name');
  await waitFor(() => [...document.querySelectorAll('.tabview.active .list .nm')].some((e) => e.textContent === 'Read Me (long name).txt'), 'folder browsed');
  const x = await extract(dir, 'mf-test.iso', []);
  assert(x.result.files >= 2, `extracted ${x.result.files} files`);
  assertEq(new TextDecoder().decode(await readFile(join(x.dest, long))), 'hello from iso\n', 'extracted file');
  await workspace.close(iso.tab, { force: true });

  // ---- .msi ----
  const msi = await openPkg(dir, 'mf-test.msi', 'msi');
  assertEq(`${msi.info.meta.Package} ${msi.info.meta.Version} ${msi.info.meta.Manufacturer}`, 'Mf Test 1.2.3 Monoform', 'MSI properties');
  assertEq(msi.tab.status?.type, 'Windows Installer package', 'msi status');
  msi.h.go('Program Files/MfTest/docs');
  await waitFor(() => [...document.querySelectorAll('.tabview.active .list .nm')].some((e) => e.textContent === 'LongReadmeFile.txt'), 'MSI folders from its Directory table');
  const m = await extract(dir, 'mf-test.msi', ['Program Files/MfTest/docs/LongReadmeFile.txt']);
  assertEq(m.result.files, 1, 'one file extracted');
  assertEq((await api.Stat(join(m.dest, 'LongReadmeFile.txt'))).size, 114425, 'cabinet file decompressed in full');
  await workspace.close(msi.tab, { force: true });

  // ---- zip-based packages ----
  for (const [name, file] of [
    ['app.jar', 'META-INF/MANIFEST.MF'],
    ['app.apk', 'AndroidManifest.xml'],
  ]) {
    const p = await openPkg(dir, name, 'zip');
    assert(p.info.entries.some((e: any) => e.name === file), `${name} lists ${file}`);
    assertEq(p.tab.status?.type, `${name.split('.')[1].toUpperCase()} package`, `${name} status`);
    await workspace.close(p.tab, { force: true });
  }
}
