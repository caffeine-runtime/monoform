// Entry points for Compare that exist before its module loads: commands, the
// file tree's "Select for compare" / "Compare with …", and the tab menu.
import { api } from './backend';
import { commands } from './commands';
import { basename } from './paths';
import { workspace } from './tabs.svelte';
import { ui, type MenuItem } from './ui.svelte';
import { treeMenuContributions } from '../shell/treeActions';

/** File chosen with "Select for compare" (the left side of the next compare). */
let picked: string | null = null;

export function compareFiles(a: string, b: string) {
  workspace.openTool('compare', a, { state: { b } });
}

/** Ask for the other file: an open file tab, or Browse…. */
export async function compareWith(a: string) {
  const others = workspace.tabs.filter((t) => t.filePath && t.filePath !== a);
  let b: string | null = null;
  if (others.length) {
    const id = await ui.pick(`Compare ${basename(a)} with…`, [...others.map((t) => ({ id: t.filePath!, label: t.title, detail: t.filePath })), { id: '\u0000browse', label: 'Browse…' }]);
    if (!id) return;
    b = id === '\u0000browse' ? null : id;
  }
  if (!b) b = (await api.OpenFilesDialog(`Compare ${basename(a)} with…`, []))?.[0] ?? null;
  if (b) compareFiles(a, b);
}

export function registerCompare() {
  commands.register(
    {
      id: 'file.compare',
      title: 'Compare files…',
      category: 'File',
      run: async () => {
        const r = await api.OpenFilesDialog('Choose two files to compare (or one, then the other)', []);
        if (!r?.length) return;
        if (r.length >= 2) return compareFiles(r[0], r[1]);
        const b = (await api.OpenFilesDialog(`Compare ${basename(r[0])} with…`, []))?.[0];
        if (b) compareFiles(r[0], b);
      },
    },
    {
      id: 'file.compareWith',
      title: 'Compare this file with…',
      category: 'File',
      when: () => !!workspace.active?.filePath,
      run: () => void compareWith(workspace.active!.filePath!),
    },
  );
  treeMenuContributions.push((item) => {
    if (item.archive || item.isDir) return [];
    const items: MenuItem[] = [
      {
        label: 'Select for compare',
        run: () => {
          picked = item.path;
        },
      },
    ];
    if (picked && picked !== item.path) {
      const left = picked;
      items.push({ label: `Compare with “${basename(left)}”`, run: () => compareFiles(left, item.path) });
    }
    return items;
  });
}
