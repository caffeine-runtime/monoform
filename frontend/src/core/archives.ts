// Archive integration that must be available before the archive module loads:
// expanding archives in the sidebar tree, context-menu actions, and the
// shared extract / create-zip flows.
import { api } from './backend';
import { commands } from './commands';
import { jobs } from './jobs.svelte';
import { basename, dirname, extname, join, stem } from './paths';
import { tree, type TreeItem } from './tree.svelte';
import { toastError, ui } from './ui.svelte';
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

export const ARCHIVE_EXT = ['zip', 'tar', 'gz', 'tgz', 'tar.gz', 'tar.bz2', 'tbz2', 'tar.xz', 'txz', 'tar.zst', 'bz2', 'xz', 'zst', '7z', 'rar'];
const READ_ONLY = new Set(['rar', '7z']);

export function isArchive(p: string) {
  return ARCHIVE_EXT.includes(extname(p));
}

export function readOnlyReason(format: string): string {
  if (format === 'rar') return 'RAR archives are read-only: you can browse, open and extract files, but not create or change RAR files (RAR compression is proprietary).';
  if (format === '7z') return '7z archives are read-only: you can browse, open and extract files, but creating or changing 7z files isn’t supported.';
  return '';
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
  const target = dest ?? (await api.OpenFolderDialog('Extract to'));
  if (!target) return;
  const done = await jobs.run<ExtractResult>(`Extracting ${basename(archivePath)}`, () => api.ArchiveExtract(archivePath, target, { entries, existing: 'rename', limits: { maxEntries: 0, maxBytes: 0, maxRatio: 0, ratioFloor: 0 } } as archive.Options));
  if (done.cancelled) return ui.toast('Extraction cancelled', 'info');
  if (done.error) return toastError(done.error, 'Extraction stopped');
  const r = done.result;
  void tree.refreshDir(target);
  if (r.skipped?.length) {
    await ui.ask({
      title: `Extracted ${r.files} file${r.files === 1 ? '' : 's'}, skipped ${r.skipped.length}`,
      message: 'These entries were not extracted:',
      details: r.skipped.slice(0, 200).map((s) => `${s.name} — ${s.reason}`),
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
  } else ui.toast(`Extracted ${r.files} file${r.files === 1 ? '' : 's'} to ${basename(target)}`, 'success');
}

/** "Extract here": into <archive dir>/<archive name>/ */
export function extractHere(archivePath: string) {
  return extractTo(archivePath, [], join(dirname(archivePath), stem(archivePath)));
}

export async function createZip(items?: string[]) {
  const sel = items ?? (await api.OpenFilesDialog('Files to put in the ZIP', []));
  if (!sel?.length) return;
  const def = sel.length === 1 ? `${sel[0].replace(/[\\/]+$/, '')}.zip` : join(dirname(sel[0]), 'Archive.zip');
  const dest = await api.SaveFileDialog('Save ZIP as', def, [{ name: 'ZIP archive', patterns: '*.zip' }]);
  if (!dest) return;
  const target = /\.zip$/i.test(dest) ? dest : `${dest}.zip`;
  const done = await jobs.run<ExtractResult>(`Creating ${basename(target)}`, () => api.ArchiveCreateZip(sel, target));
  if (done.error) return toastError(done.error, 'Could not create ZIP');
  void tree.refreshDir(dirname(target));
  ui.toast(`Created ${basename(target)} (${done.result.files} files)`, 'success', { label: 'Open', run: () => void workspace.openPath(target) });
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
      return [{ label: item.isDir ? 'Extract folder to…' : 'Extract to…', run: () => extractTo(item.archive!, [item.entry!]) }];
    }
    const items = [];
    if (!item.isDir && isArchive(item.path)) {
      items.push({ label: 'Extract here', run: () => extractHere(item.path) }, { label: 'Extract to…', run: () => extractTo(item.path) });
    }
    items.push({ label: 'Compress to ZIP…', run: () => createZip([item.path]) });
    return items;
  });
  commands.register({ id: 'archive.create', title: 'Create ZIP from files…', category: 'Tools', run: () => createZip() });
}
