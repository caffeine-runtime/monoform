// Opens a set of files and waits, for screenshots. Arg: "<folder>|<file1>,<file2>|<command ids>"
import { commands } from '../core/commands';
import { workspace } from '../core/tabs.svelte';
import { folderSearch } from '../core/search.svelte';
import { sleep } from './harness';

export default async function show(arg: string) {
  const [folder, files, cmds, query] = arg.split('|');
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
  await sleep(Number(new URLSearchParams(location.search).get('wait') ?? 4000));
}
