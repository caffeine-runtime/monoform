// Opens a set of files and waits, for screenshots.
// Arg: "<folder>|<file1>,<file2>|<command ids>|<folder search>|<palette query>|<wait ms>"
import { commands } from '../core/commands';
import { workspace } from '../core/tabs.svelte';
import { folderSearch } from '../core/search.svelte';
import { sleep } from './harness';
import { ui } from '../core/ui.svelte';

export default async function show(arg: string) {
  const [folder, files, cmds, query, palette, wait] = arg.split('|');
  if (folder) await workspace.openFolder(folder);
  for (const f of (files ?? '').split(',').filter(Boolean)) await workspace.openPath(f);
  await sleep(600);
  for (const c of (cmds ?? '').split(',').filter(Boolean)) {
    commands.execute(c);
    await sleep(200);
  }
  if (query) {
    folderSearch.query = query;
    await folderSearch.run(folder);
  }
  if (palette) ui.openPalette(palette);
  await sleep(Number(wait || 4000));
}
