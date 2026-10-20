// M36: a grouped app menu — ☰ shows a short list (everyday actions, then
// submenus); with an image open there is an "Image" submenu with its tools
// grouped again. Submenus open on hover and click and with the keyboard
// (→ opens, ← goes back, Esc closes); near the right edge they open to the
// left. Plain context menus (no submenus) still work.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { menu } from '../core/ui.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const menus = () => [...document.querySelectorAll<HTMLElement>('.menu')];
const itemsOf = (m: HTMLElement) => [...m.querySelectorAll<HTMLButtonElement>('.mi')];
const find = (m: HTMLElement, label: string) => itemsOf(m).find((b) => b.querySelector('span')?.textContent === label);

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

async function openAppMenu(): Promise<HTMLElement> {
  menu.close();
  await sleep(30);
  document.querySelector<HTMLButtonElement>('.sidebar button[title="Menu"]')!.click();
  return waitFor(() => menus()[0], 'app menu');
}

export default async function m36(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const note = (await workspace.openPath(join(dir, 'diagrams', 'notes.md')))!; // a split needs two tabs
  const img = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  await waitFor(() => (img as any).imageTest?.editor(), 'image editor');

  // ---- short, grouped ----
  const root = await openAppMenu();
  const top = itemsOf(root).map((b) => b.querySelector('span')!.textContent);
  log(`app menu: ${top.join(' · ')}`);
  assert(top.length <= 22, `${top.length} top-level items`);
  for (const l of ['Go to file…', 'New', 'This file', 'Image', 'Tools', 'View', 'Split view', 'Appearance', 'Settings']) assert(top.includes(l), `has ${l}`);
  assert(find(root, 'New')!.querySelector('.arrow'), 'submenus are marked');
  assert(top.indexOf('Image') < top.indexOf('Tools'), 'the open file’s menu comes before Tools');

  // ---- hover opens a submenu; picking an item runs it and closes the menu ----
  const split = find(root, 'Split view')!;
  split.dispatchEvent(new MouseEvent('mouseenter'));
  const sub = await waitFor(() => menus()[1], 'Split view submenu');
  const r0 = root.getBoundingClientRect();
  assert(sub.getBoundingClientRect().left >= r0.right - 8, 'opens beside the menu');
  find(sub, 'Two side by side')!.click();
  await waitFor(() => (workspace.split?.panes.length === 2 ? true : null), 'split by the menu item');
  assert(!menu.open && !menus().length, 'menu closed after choosing');
  workspace.setSplit(null);
  workspace.activate(img);

  // ---- keyboard: down to Image, → into it, → into Tools, Enter ----
  const r = await openAppMenu();
  await sleep(30);
  const order = itemsOf(r).map((b) => b.querySelector('span')!.textContent);
  for (let i = 0; i <= order.indexOf('Image'); i++) key(r, 'ArrowDown');
  key(r, 'ArrowRight');
  const imgMenu = await waitFor(() => menus()[1], 'Image submenu by keyboard');
  await sleep(30);
  assertEq(document.activeElement, imgMenu, 'focus moves into the submenu');
  key(imgMenu, 'ArrowDown');
  await sleep(30); // let the highlight render
  assertEq(itemsOf(imgMenu).find((b) => b.classList.contains('sel'))?.querySelector('span')?.textContent, 'Tools', 'Tools first');
  key(imgMenu, 'ArrowRight');
  const tools = await waitFor(() => menus()[2], 'Image › Tools');
  assert(find(tools, 'Brush') && find(tools, 'Text'), 'tool names without the "Tool:" prefix');
  key(tools, 'ArrowLeft');
  await waitFor(() => (menus().length === 2 ? true : null), '← closes one level');
  key(imgMenu, 'Escape');
  await waitFor(() => (menus().length === 1 ? true : null), 'Esc in a submenu goes back');
  key(r, 'Escape');
  await waitFor(() => (!menu.open ? true : null), 'Esc closes the menu');

  // Choose a tool through the menu: Image › Tools › Brush.
  const r2 = await openAppMenu();
  find(r2, 'Image')!.click();
  const im2 = await waitFor(() => menus()[1], 'Image submenu by click');
  find(im2, 'Tools')!.click();
  const t2 = await waitFor(() => menus()[2], 'Tools by click');
  find(t2, 'Brush')!.click();
  await waitFor(() => ((img as any).imageTest.tool() === 'brush' ? true : null), 'brush chosen from the menu');

  // ---- near the right edge a submenu opens to the left ----
  menu.show({ clientX: innerWidth - 120, clientY: 100 }, [{ label: 'More', items: [{ label: 'Deep item', run: () => {} }] }, { label: 'Plain', run: () => {} }]);
  const edge = await waitFor(() => menus()[0], 'edge menu');
  find(edge, 'More')!.click();
  const left = await waitFor(() => menus()[1], 'edge submenu');
  assert(left.getBoundingClientRect().right <= edge.getBoundingClientRect().left + 8, 'flipped to the left');
  assert(left.getBoundingClientRect().left >= 0, 'on screen');
  menu.close();

  // ---- a plain context menu still works ----
  let ran = false;
  menu.show({ clientX: 200, clientY: 200 }, [{ label: 'Run me', run: () => (ran = true) }]);
  const plain = await waitFor(() => menus()[0], 'plain menu');
  key(plain, 'ArrowDown');
  key(plain, 'Enter');
  await waitFor(() => (ran ? true : null), 'Enter runs the item');
  await workspace.close(img, { force: true });
  await workspace.close(note, { force: true });
}
