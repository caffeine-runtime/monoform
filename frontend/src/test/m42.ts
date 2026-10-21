// M42: the path bar and side panels. The open file's full path shows above
// it; a folder in the path opens a small browser of that folder (the file
// marked, siblings to open, ".." up, subfolders to go into, typing filters),
// with "Open as folder" and "Show in Explorer". View › Show / hide side panels
// (and the tab bar button) hides an editor's panels and brings them back; the
// path bar can be hidden too.
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const pop = () => document.querySelector<HTMLElement>('.folderpop');
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.folderpop .fp-item:not(.up)')).map((b) => b.textContent!.trim());
const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.folderpop .fp-item')).find((b) => b.textContent!.trim() === name);

export default async function m42(dir: string) {
  const file = join(dir, 'hash', 'abc.txt');
  const t = (await workspace.openPath(file))!;
  const bar = await waitFor(() => document.querySelector<HTMLElement>('.pathbar'), 'path bar');
  const crumbs = Array.from(bar.querySelectorAll<HTMLElement>('.crumb'));
  assert(bar.textContent!.includes('abc.txt'), 'file name in the path');
  assertEq(crumbs.at(-1)!.textContent, 'hash', 'its folder is the last crumb');
  assertEq(crumbs.at(-1)!.title, join(dir, 'hash'), 'crumb knows its full path');
  log(`path bar: ${bar.textContent!.replace(/\s+/g, ' ').trim()}`);

  // The folder browser.
  const jank = await measureJank(async () => {
    crumbs.at(-1)!.click();
    await waitFor(() => rows().includes('SHA256SUMS') || null, 'folder listed');
  });
  log(`folder browser opened, longest UI frame ${Math.round(jank.maxGap)} ms`);
  assert(document.querySelector('.folderpop .fp-item.current')?.textContent?.includes('abc.txt'), 'the open file is marked');
  assertEq(rows().join(','), 'abc.txt,big.bin,empty.txt,files.md5,SHA256SUMS', 'files sorted by name');
  // Typing filters.
  const input = pop()!.querySelector<HTMLInputElement>('.fp-filter')!;
  input.value = 'md5';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => (rows().length === 1 ? true : null), 'filtered to one');
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  // Opening a sibling.
  (await waitFor(() => row('SHA256SUMS'), 'filter cleared')).click();
  const sums = await waitFor(() => (workspace.active?.path === join(dir, 'hash', 'SHA256SUMS') ? workspace.active : null), 'sibling opened');
  assert(!pop(), 'browser closed after opening');
  // Up a level, into another folder.
  document.querySelectorAll<HTMLElement>('.pathbar .crumb')[document.querySelectorAll('.pathbar .crumb').length - 1].click();
  await waitFor(() => (rows().length ? true : null), 'browser again');
  document.querySelector<HTMLElement>('.folderpop .fp-item.up')!.click();
  await waitFor(() => (row('diagrams') && row('hash') ? true : null), 'parent folder listed');
  assert(document.querySelector('.folderpop .fp-item.current')?.textContent?.includes('hash'), 'the folder we came from is marked');
  row('diagrams')!.click();
  await waitFor(() => (row('notes.md') ? true : null), 'went into a subfolder');
  // Show in the system file manager / open as the sidebar folder.
  Array.from(pop()!.querySelectorAll<HTMLButtonElement>('.fp-actions .btn')).find((b) => b.textContent!.includes('Show in'))!.click();
  await waitFor(async () => ((await api.TestLastShown()) === join(dir, 'diagrams') ? true : null), 'shown in the file manager');
  Array.from(pop()!.querySelectorAll<HTMLButtonElement>('.fp-actions .btn')).find((b) => b.textContent!.includes('Open as folder'))!.click();
  await waitFor(() => (workspace.folder === join(dir, 'diagrams') ? true : null), 'opened as the sidebar folder');
  assert(!pop(), 'browser closed');
  // Escape closes it.
  document.querySelector<HTMLElement>('.pathbar .crumb')!.click();
  await waitFor(() => pop(), 'browser at the root');
  pop()!.querySelector<HTMLInputElement>('.fp-filter')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => (!pop() ? true : null), 'Escape closes');

  // Hiding the path bar.
  commands.execute('view.togglePathBar');
  await waitFor(() => (!document.querySelector('.pathbar') ? true : null), 'path bar hidden');
  commands.execute('view.togglePathBar');
  await waitFor(() => document.querySelector('.pathbar'), 'path bar back');

  // Side panels: an image editor's panel goes and comes back.
  const img = (await workspace.openPath(join(dir, 'img', 'red.png')))!;
  const panel = await waitFor(() => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${img.id}"] aside[data-sidepanel]`), 'image side panel');
  assert(panel.offsetWidth > 0, 'panel shown');
  const btn = await waitFor(() => document.querySelector<HTMLButtonElement>('.tabbar .panels'), 'tab bar panels button');
  btn.click();
  await waitFor(() => (panel.offsetWidth === 0 && settings.value.panelsHidden ? true : null), 'panel hidden');
  await sleep(50);
  assert(document.querySelector<HTMLElement>(`.tabview[data-tab-id="${img.id}"] .stage, .tabview[data-tab-id="${img.id}"] canvas`), 'image still shown');
  commands.execute('view.togglePanels');
  await waitFor(() => (panel.offsetWidth > 0 && !settings.value.panelsHidden ? true : null), 'panel back');
  // Text has no side panels: no button.
  workspace.activate(t);
  await waitFor(() => (!document.querySelector('.tabbar .panels') ? true : null), 'no panels button for text');

  for (const x of [img, sums, t]) await workspace.close(x, { force: true });
  workspace.closeFolder();
}
