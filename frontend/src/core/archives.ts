// Archive integration that must be available before the archive module loads:
// expanding archives in the sidebar tree, context-menu actions, and the
// shared extract / create-zip flows.
import { api } from './backend';
import { ARCHIVE_EXT, PACKAGE_EXT } from './archiveExt';
import { commands } from './commands';
import { jobs } from './jobs.svelte';
import { basename, dirname, extname, join, stem } from './paths';
import { tree, type TreeItem } from './tree.svelte';
import { toastError, ui } from './ui.svelte';
import { t, tn } from './i18n';
import { workspace } from './tabs.svelte';
import { treeMenuContributions } from '../shell/treeActions';
import type { archive } from '../wailsjs/go/models';

/** archive.Result from Go (job results aren't in the generated models). */
export interface ExtractResult {
  files: number;
  dirs: number;
  links: number;
  bytes: number;
  skipped: { name: string; reason: string }[] | null;
}

export { ARCHIVE_EXT, PACKAGE_EXT };
const READ_ONLY = new Set(['rar', '7z', 'deb', 'rpm', 'iso', 'msi']);
const FORMAT_NAMES: Record<string, string> = { deb: t('Debian package'), rpm: t('RPM package'), iso: t('ISO disk image'), msi: t('Windows Installer package') };
const READ_ONLY_REASONS: Record<string, string> = {
  rar: t('RAR archives are read-only: you can browse, open and extract files, but not create or change RAR files (RAR compression is proprietary).'),
  deb: t('Debian packages are read-only: you can browse, open and extract their files, but not change them.'),
  rpm: t('RPM packages are read-only: you can browse, open and extract their files, but not change them.'),
  iso: t('ISO disk images are read-only: you can browse, open and extract their files, but not change them.'),
  msi: t('Windows Installer packages are read-only: you can browse, open and extract their files, but not change them.'),
  '7z': t('7z archives are read-only: you can browse, open and extract files, but creating or changing 7z files isn’t supported.'),
};

/** "ZIP archive", "Debian package", "JAR package"… for the status bar. */
export function formatName(format: string, path = ''): string {
  if (FORMAT_NAMES[format]) return FORMAT_NAMES[format];
  const ext = extname(path);
  if (format === 'zip' && PACKAGE_EXT.includes(ext)) return t('{format} package', { format: ext.toUpperCase() });
  return t('{format} archive', { format: format.toUpperCase() });
}

export function isArchive(p: string) {
  return ARCHIVE_EXT.includes(extname(p));
}

export function readOnlyReason(format: string): string {
  return READ_ONLY_REASONS[format] ?? '';
}

export { READ_ONLY };

const KIND_BY_EXT: Record<string, string> = { md: 'markdown', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'svg', json: 'json', yaml: 'yaml', yml: 'yaml', csv: 'csv', tsv: 'csv', docx: 'document', xlsx: 'spreadsheet' };

const listings = new Map<string, Promise<archive.Info>>();
export function listArchive(path: string, fresh = false): Promise<archive.Info> {
  let p = listings.get(path);
  if (!p || fresh) {
    p = api.ArchiveList(path);
    p.catch(() => listings.delete(path));
    listings.set(path, p);
  }
  return p;
}

/** Direct children of `dir` ("" = root) in an archive listing. */
export function childrenOf(info: archive.Info, dir: string): archive.Entry[] {
  const prefix = dir ? dir + '/' : '';
  return info.entries.filter((e) => e.name.startsWith(prefix) && e.name.length > prefix.length && !e.name.slice(prefix.length).includes('/'));
}

function toItem(archivePath: string, e: archive.Entry): TreeItem {
  const name = e.name.split('/').pop()!;
  return {
    id: `${archivePath}::${e.name}`,
    name,
    isDir: e.isDir,
    expandable: e.isDir,
    kind: e.isDir ? 'dir' : (KIND_BY_EXT[extname(name)] ?? (isArchive(name) ? 'archive' : 'text')),
    size: e.size,
    path: archivePath,
    archive: archivePath,
    entry: e.name,
  };
}

/** Ask for a folder and extract (entries empty = everything). */
export async function extractTo(archivePath: string, entries: string[] = [], dest?: string) {
  const target = dest ?? (await api.OpenFolderDialog(t('Extract to')));
  if (!target) return;
  const done = await jobs.run<ExtractResult>(t('Extracting {name}', { name: basename(archivePath) }), () => api.ArchiveExtract(archivePath, target, { entries, existing: 'rename', limits: { maxEntries: 0, maxBytes: 0, maxRatio: 0, ratioFloor: 0 } } as archive.Options));
  if (done.cancelled) return ui.toast(t('Extraction cancelled'), 'info');
  if (done.error) return toastError(done.error, t('Extraction stopped'));
  const r = done.result;
  void tree.refreshDir(target);
  if (r.skipped?.length) {
    await ui.ask({
      title: tn('Extracted {n} file, skipped {skipped}', 'Extracted {n} files, skipped {skipped}', r.files, { skipped: r.skipped.length }),
      message: t('These entries were not extracted:'),
      details: r.skipped.slice(0, 200).map((s) => `${s.name} — ${s.reason}`),
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
  } else ui.toast(tn('Extracted {n} file to {folder}', 'Extracted {n} files to {folder}', r.files, { folder: basename(target) }), 'success');
}

/** "Extract here": into <archive dir>/<archive name>/ */
export function extractHere(archivePath: string) {
  return extractTo(archivePath, [], join(dirname(archivePath), stem(archivePath)));
}

export async function createZip(items?: string[]) {
  const sel = items ?? (await api.OpenFilesDialog(t('Files to put in the ZIP'), []));
  if (!sel?.length) return;
  const def = sel.length === 1 ? `${sel[0].replace(/[\\/]+$/, '')}.zip` : join(dirname(sel[0]), `${t('Archive', {}, 'file name')}.zip`);
  const dest = await api.SaveFileDialog(t('Save ZIP as'), def, [{ name: t('{format} archive', { format: 'ZIP' }), patterns: '*.zip' }]);
  if (!dest) return;
  const target = /\.zip$/i.test(dest) ? dest : `${dest}.zip`;
  const done = await jobs.run<ExtractResult>(t('Creating {name}', { name: basename(target) }), () => api.ArchiveCreateZip(sel, target));
  if (done.error) return toastError(done.error, t('Could not create ZIP'));
  void tree.refreshDir(dirname(target));
  ui.toast(tn('Created {name} ({n} file)', 'Created {name} ({n} files)', done.result.files, { name: basename(target) }), 'success', { label: t('Open'), run: () => void workspace.openPath(target) });
}

export function registerArchiveIntegration() {
  tree.registerExpander('archive', async (item) => {
    const info = await listArchive(item.path);
    return childrenOf(info, '').map((e) => toItem(item.path, e));
  });
  tree.registerExpander('archive-dir', async (item) => {
    const info = await listArchive(item.archive!);
    return childrenOf(info, item.entry!).map((e) => toItem(item.archive!, e));
  });
  treeMenuContributions.push((item) => {
    if (item.archive) {
      return [{ label: item.isDir ? t('Extract folder to…') : t('Extract to…'), run: () => extractTo(item.archive!, [item.entry!]) }];
    }
    const items = [];
    if (!item.isDir && isArchive(item.path)) {
      items.push({ label: t('Extract here'), run: () => extractHere(item.path) }, { label: t('Extract to…'), run: () => extractTo(item.path) });
    }
    items.push({ label: t('Compress to ZIP…'), run: () => createZip([item.path]) });
    return items;
  });
  commands.register({ id: 'archive.create', title: t('Create ZIP from files…'), category: t('Tools'), run: () => createZip() });
}
