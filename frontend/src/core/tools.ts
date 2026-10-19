// Tool entry points that exist before their module loads.
import { api } from './backend';
import { commands } from './commands';
import { extname } from './paths';
import { workspace } from './tabs.svelte';
import { treeMenuContributions } from '../shell/treeActions';
import type { MenuItem } from './ui.svelte';

const CHECKSUM_EXT = ['sha256', 'sha1', 'md5', 'sha512', 'b3', 'sha256sum', 'md5sum', 'sha1sum', 'sha512sum'];

export function registerTools() {
  commands.register(
    {
      id: 'tools.hash',
      title: 'Compute file hash…',
      category: 'Tools',
      shortcut: 'Mod+Alt+H',
      run: (arg) => {
        const p = typeof arg === 'string' ? arg : workspace.active?.filePath;
        workspace.openTool('hash', p);
      },
    },
    {
      id: 'tools.verify',
      title: 'Verify checksum file…',
      category: 'Tools',
      run: async () => {
        const r = await api.OpenFilesDialog('Choose a checksum file (.sha256, .md5, SHA256SUMS…)', [{ name: 'Checksum files', patterns: '*.sha256;*.sha1;*.md5;*.sha512;*.b3;*SUMS;*.txt' }]);
        if (r?.[0]) await workspace.openPath(r[0], { moduleId: 'checksum' });
      },
    },
  );
  treeMenuContributions.push((item) => {
    if (item.archive || item.isDir) return [];
    const items: MenuItem[] = [{ label: 'Compute hash…', run: () => void workspace.openTool('hash', item.path) }];
    if (CHECKSUM_EXT.includes(extname(item.path)) || /sums$/i.test(item.name)) items.push({ label: 'Verify checksums', run: () => void workspace.openPath(item.path, { moduleId: 'checksum' }) });
    return items;
  });
}
