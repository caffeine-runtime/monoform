// M0 acceptance: palette lists commands, themes switch, session restores.
import { commands } from '../core/commands';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { theme } from '../core/theme.svelte';
import { tree } from '../core/tree.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';
import { basename, join } from '../core/paths';

export async function setup(dir: string) {
  // Palette opens with Ctrl+K and lists commands.
  press('Ctrl+K', window);
  await waitFor(() => document.querySelector('.palette'), 'palette');
  const items = document.querySelectorAll('.palette .item');
  log(`palette shows ${items.length} entries, ${commands.available().length} commands available`);
  assert(items.length >= 12 && items.length === commands.available().length, 'palette lists all available commands');
  const input = document.querySelector<HTMLInputElement>('.palette .q')!;
  input.value = 'toggle theme';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);
  const first = document.querySelector('.palette .item.sel .label')?.textContent ?? '';
  assert(first.includes('Toggle dark / light theme'), `fuzzy top hit is theme toggle (got "${first}")`);
  press('Escape', input);
  await waitFor(() => !document.querySelector('.palette'), 'palette closed');

  // Themes switch.
  theme.set('light');
  await sleep(30);
  assertEq(document.documentElement.dataset.theme, 'light', 'light theme applied');
  const lightBg = getComputedStyle(document.body).backgroundColor;
  press('Ctrl+Alt+T', window);
  await sleep(50);
  assertEq(document.documentElement.dataset.theme, 'dark', 'toggle switches to dark');
  const darkBg = getComputedStyle(document.body).backgroundColor;
  assert(lightBg !== darkBg, 'body background changes with theme');
  log(`backgrounds light=${lightBg} dark=${darkBg}`);

  // Open a folder and three files; leave the second active.
  await workspace.openFolder(dir);
  await waitFor(() => tree.children.get(dir)?.length, 'folder listing');
  await workspace.openPath(join(dir, 'a.txt'));
  await workspace.openPath(join(dir, 'b.md'));
  await workspace.openPath(join(dir, 'c.txt'));
  workspace.activate(workspace.tabs[1]);
  assertEq(workspace.tabs.length, 3, 'three tabs open');
  assertEq(settings.value.recents[0], join(dir, 'c.txt'), 'recents updated');
  settings.togglePin(join(dir, 'a.txt'));
  await sleep(700); // session save debounce
}

export async function restore(dir: string) {
  await waitFor(() => workspace.tabs.length === 3, 'restored tabs', 3000);
  assertEq(workspace.tabs.map((t) => basename(t.path ?? '')).join(','), 'a.txt,b.md,c.txt', 'tab order');
  assertEq(workspace.active?.title, 'b.md', 'active tab restored');
  assertEq(workspace.folder, dir, 'folder restored');
  assertEq(document.documentElement.dataset.theme, 'dark', 'theme persisted');
  assert(settings.isPinned(join(dir, 'a.txt')), 'pinned persisted');
  // Inactive tabs are not loaded until shown.
  assert(!workspace.tabs[0].mounted, 'inactive tab content is lazy');
  await waitFor(() => document.querySelector('.tabview.active'), 'active view mounted');
  assert(ui.toasts.every((t) => t.kind !== 'error'), 'no error toasts');
}
