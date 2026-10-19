// Actions on tree items (open, context menu), shared by the tree, pinned and
// recents lists.
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { basename, dirname, join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { tree, type TreeItem } from '../core/tree.svelte';
import { menu, toastError, ui, type MenuItem } from '../core/ui.svelte';

export async function openTreeItem(item: TreeItem) {
  if (item.archive && item.entry !== undefined) {
    if (item.isDir) return;
    await workspace.openArchiveEntry(item.archive, item.entry);
    return;
  }
  if (item.isDir) {
    await tree.toggle(item);
    return;
  }
  await workspace.openPath(item.path);
}

/** Extra context-menu items contributed by modules (hash, extract, ...). */
export const treeMenuContributions: ((item: TreeItem) => MenuItem[])[] = [];

export async function newFileIn(dir: string) {
  const name = await ui.prompt('New file name', 'untitled.md', 'Create', true);
  if (!name) return;
  const p = join(dir, name);
  try {
    await api.CreateFile(p);
    await tree.refreshDir(dir);
    await workspace.openPath(p);
  } catch (e) {
    toastError(e, 'Could not create file');
  }
}

export async function newFolderIn(dir: string) {
  const name = await ui.prompt('New folder name', 'New folder', 'Create');
  if (!name) return;
  try {
    await api.CreateFolder(join(dir, name));
    await tree.refreshDir(dir);
  } catch (e) {
    toastError(e, 'Could not create folder');
  }
}

export async function renameItem(item: TreeItem) {
  const name = await ui.prompt('Rename', item.name, 'Rename', true);
  if (!name || name === item.name) return;
  const to = join(dirname(item.path), name);
  try {
    await api.Rename(item.path, to);
    const open = workspace.findByPath(item.path);
    if (open) open.retarget(to);
    await tree.refreshDir(dirname(item.path));
  } catch (e) {
    toastError(e, 'Rename failed');
  }
}

export function copyText(text: string, what = 'Path') {
  navigator.clipboard.writeText(text).then(
    () => ui.toast(`${what} copied`, 'success'),
    (e) => toastError(e),
  );
}

export function treeContextMenu(e: MouseEvent, item: TreeItem) {
  const items: MenuItem[] = [];
  if (item.archive) {
    if (!item.isDir) items.push({ label: 'Open', run: () => openTreeItem(item) });
  } else if (item.isDir) {
    items.push(
      { label: 'New file…', run: () => newFileIn(item.path) },
      { label: 'New folder…', run: () => newFolderIn(item.path) },
      { separator: true },
      { label: 'Find in this folder…', run: () => commands.execute('search.inFolder', item.path) },
    );
  } else {
    items.push(
      { label: 'Open', run: () => openTreeItem(item) },
      { label: settings.isPinned(item.path) ? 'Unpin' : 'Pin', run: () => settings.togglePin(item.path) },
    );
  }
  for (const c of treeMenuContributions) {
    const extra = c(item);
    if (extra.length) items.push({ separator: true }, ...extra);
  }
  if (!item.archive) {
    items.push(
      { separator: true },
      { label: 'Rename…', run: () => renameItem(item) },
      { label: 'Copy path', run: () => copyText(item.path) },
      { label: 'Copy name', run: () => copyText(basename(item.path), 'Name') },
    );
  } else if (item.entry) {
    items.push({ separator: true }, { label: 'Copy entry name', run: () => copyText(item.entry!, 'Name') });
  }
  menu.show(e, items);
}
