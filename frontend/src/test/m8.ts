// M8: settings page, recents management (X buttons, clear, turn off) and
// creating new files of each kind.
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { newFileOfKind } from '../core/newfile';
import { basename, join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

async function answerPick(id: string) {
  const p = await waitFor(() => ui.picker, 'picker');
  assert(p.items.some((i) => i.id === id), `picker "${p.title}" offers ${id}`);
  p.resolve(id);
  ui.picker = null;
  await sleep(20);
}

async function answerPrompt(value?: string) {
  const d = await waitFor(() => ui.dialog, 'dialog');
  d.resolve({ button: 'ok', value: value ?? (d as any).input?.value ?? (d as any).value });
  await sleep(20);
}

export default async function m8(dir: string) {
  const D = join(dir, 'newfiles');
  await api.CreateFolder(D).catch(() => {});
  await workspace.openFolder(D);
  settings.setRecentsOff(false);
  settings.clearRecents();

  // New files of every kind land in the open folder and open in their module.
  const expect: [string, string, string][] = [
    ['markdown', 'Untitled.md', 'markdown'],
    ['docx', 'Untitled.docx', 'doc'],
    ['xlsx', 'Untitled.xlsx', 'sheet'],
    ['csv', 'Untitled.csv', 'csv'],
    ['svg', 'Untitled.svg', ''],
    ['html', 'Untitled.html', ''],
    ['json', 'Untitled.json', 'data'],
    ['text', 'Untitled.txt', 'text'],
  ];
  // The start page has one tile per kind; the first file is made by clicking it.
  const tiles = await waitFor(() => {
    const t = document.querySelectorAll<HTMLButtonElement>('.welcome .kind');
    return t.length ? t : null;
  }, 'new-file tiles on the start page');
  assertEq([...tiles].map((t) => t.dataset.kind).join(','), 'markdown,docx,xlsx,csv,image,svg,html,json,text', 'a tile per kind');
  const welcome = document.querySelector('.welcome')!;
  assert(!welcome.textContent?.includes('Hold It All'), 'no app name on the start page');
  assert(welcome.querySelector('.drop') && /Open file/.test(welcome.querySelector('.drop')!.textContent ?? '') && /Open folder/.test(welcome.querySelector('.drop')!.textContent ?? ''), 'drop area with open buttons');
  for (const t of tiles) assert(t.scrollWidth <= t.clientWidth + 1, `tile "${t.textContent?.trim()}" fits its text`);
  let first = true;
  for (const [kind, name, mod] of expect) {
    let p: Promise<string | null>;
    if (first) {
      let done!: (v: string | null) => void;
      p = new Promise((r) => (done = r));
      document.querySelector<HTMLButtonElement>(`.welcome .kind[data-kind="${kind}"]`)!.click();
      void waitFor(() => (workspace.active?.title === name ? true : null), 'tile-created file').then(() => done(join(D, name)));
      first = false;
    } else p = newFileOfKind(undefined, kind);
    const d = await waitFor(() => ui.dialog, `name prompt for ${kind}`);
    assertEq((d as any).input?.value ?? (d as any).value, name, `default name for ${kind}`);
    await answerPrompt(name);
    const path = await p;
    assertEq(path, join(D, name), `created ${kind}`);
    if (mod) await waitFor(() => (workspace.active?.moduleId === mod ? true : null), `${name} opens in ${mod}`);
  }
  // A second Markdown note gets the next free name; typing a name without extension adds it.
  const p2 = newFileOfKind(undefined, 'markdown');
  const d2 = await waitFor(() => ui.dialog, 'second md prompt');
  assertEq((d2 as any).input?.value ?? (d2 as any).value, 'Untitled 2.md', 'next free name');
  await answerPrompt('Meeting notes');
  assertEq(await p2, join(D, 'Meeting notes.md'), 'extension added');
  // Images: size preset + background.
  const p3 = newFileOfKind(undefined, 'image');
  await answerPick('1280x720');
  await answerPick('white');
  await answerPrompt('Canvas.png');
  assertEq(await p3, join(D, 'Canvas.png'), 'image created');
  await waitFor(() => (workspace.active?.moduleId === 'image' ? true : null), 'image opens in editor');
  // Through the type picker (Mod+Alt+N command).
  commands.execute('file.newOf');
  await answerPick('docx');
  await answerPrompt('Report.docx');
  await waitFor(() => (workspace.active?.title === 'Report.docx' ? true : null), 'picker-created docx opened');
  const exists = await api.Exists([join(D, 'Report.docx'), join(D, 'Untitled.xlsx')]);
  assert(exists.every(Boolean), 'files on disk');

  // Recents: every opened file was recorded; X removes one.
  await sleep(100);
  assert(settings.value.recents.includes(join(D, 'Canvas.png')), 'recents recorded');
  const before = settings.value.recents.length;
  const row = await waitFor(() => [...document.querySelectorAll<HTMLElement>('.sidebar section.list .row')].find((r) => r.textContent?.includes('Untitled.md')), 'recent row in sidebar');
  row.querySelector<HTMLButtonElement>('.rm')!.click();
  await sleep(50);
  assert(!settings.value.recents.includes(join(D, 'Untitled.md')), 'X removed the recent');
  assertEq(settings.value.recents.length, before - 1, 'only one removed');

  // Settings page (Mod+,): theme switch, recents list, clear, turn off.
  commands.execute('app.settings');
  await waitFor(() => (workspace.active?.moduleId === 'settings' && document.querySelector('.wrap h2')?.textContent === 'Settings' ? true : null), 'settings page');
  const themeBtn = [...document.querySelectorAll<HTMLButtonElement>('.seg button')].find((b) => b.textContent === 'Light')!;
  themeBtn.click();
  await waitFor(() => (document.documentElement.dataset.theme === 'light' ? true : null), 'light theme');
  [...document.querySelectorAll<HTMLButtonElement>('.seg button')].find((b) => b.textContent === 'Dark')!.click();
  const listed = document.querySelectorAll('.recents li').length;
  assertEq(listed, settings.value.recents.length, 'settings lists every recent');
  document.querySelector<HTMLButtonElement>('.recents li .icon-btn')!.click();
  await sleep(30);
  assertEq(document.querySelectorAll('.recents li').length, listed - 1, 'X in settings removes');
  const clear = [...document.querySelectorAll<HTMLButtonElement>('.buttons .btn')].find((b) => b.textContent?.startsWith('Clear recent files'))!;
  clear.click();
  const confirm = await waitFor(() => ui.dialog, 'clear confirmation');
  confirm.resolve({ button: 'ok' });
  await sleep(30);
  assertEq(settings.value.recents.length, 0, 'recents cleared');
  const remember = [...document.querySelectorAll<HTMLLabelElement>('label.row.check')].find((l) => l.textContent?.includes('Remember recently'))!;
  remember.querySelector('input')!.click();
  await sleep(30);
  assert(settings.value.recentsOff && settings.value.recentFolders.length === 0, 'turned off, folders forgotten');
  await workspace.openPath(join(D, 'Meeting notes.md'));
  await sleep(50);
  assertEq(settings.value.recents.length, 0, 'nothing recorded while off');
  settings.setRecentsOff(false);
  await settings.flush();
  log(`created ${expect.length + 3} files; recents X/clear/off verified (${basename(D)})`);
}
