// Entry points for Compare that exist before its module loads: commands, the
// file tree's "Select for compare" / "Compare with …", and the tab menu.
import { api } from './backend';
import { commands } from './commands';
import { basename } from './paths';
import { workspace } from './tabs.svelte';
import { ui, type MenuItem } from './ui.svelte';
import { treeMenuContributions } from '../shell/treeActions';
import { t } from './i18n';

/** File chosen with "Select for compare" (the left side of the next compare). */
let picked: string | null = null;

export function compareFiles(a: string, b: string) {
  workspace.openTool('compare', a, { state: { b } });
}

/** Ask for the other file: an open file tab, or Browse…. */
export async function compareWith(a: string) {
  const others = workspace.tabs.filter((x) => x.filePath && x.filePath !== a);
  let b: string | null = null;
  if (others.length) {
    const id = await ui.pick(t('Compare {name} with…', { name: basename(a) }), [...others.map((x) => ({ id: x.filePath!, label: x.title, detail: x.filePath })), { id: '\u0000browse', label: t('Browse…') }]);
    if (!id) return;
    b = id === '\u0000browse' ? null : id;
  }
  if (!b) b = (await api.OpenFilesDialog(t('Compare {name} with…', { name: basename(a) }), []))?.[0] ?? null;
  if (b) compareFiles(a, b);
}

export function registerCompare() {
  commands.register(
    {
      id: 'file.compare',
      title: t('Compare files…'),
      category: t('File'),
      run: async () => {
        const r = await api.OpenFilesDialog(t('Choose two files to compare (or one, then the other)'), []);
        if (!r?.length) return;
        if (r.length >= 2) return compareFiles(r[0], r[1]);
        const b = (await api.OpenFilesDialog(t('Compare {name} with…', { name: basename(r[0]) }), []))?.[0];
        if (b) compareFiles(r[0], b);
      },
    },
    {
      id: 'file.compareWith',
      title: t('Compare this file with…'),
      category: t('File'),
      when: () => !!workspace.active?.filePath,
      run: () => void compareWith(workspace.active!.filePath!),
    },
  );
  treeMenuContributions.push((item) => {
    if (item.archive || item.isDir) return [];
    const items: MenuItem[] = [
      {
        label: t('Select for compare'),
        run: () => {
          picked = item.path;
        },
      },
    ];
    if (picked && picked !== item.path) {
      const left = picked;
      items.push({ label: t('Compare with “{name}”', { name: basename(left) }), run: () => compareFiles(left, item.path) });
    }
    return items;
  });
}
