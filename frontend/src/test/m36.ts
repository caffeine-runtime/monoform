// M36: a grouped app menu — ☰ shows a short list (everyday actions, then
// submenus); families of options are one row each (the theme as a three-way
// toggle, interface size as a slider, split layouts as buttons) and on/off
// options are checked items; with an image open there is an "Image" submenu
// with its tools grouped again. Submenus open on hover and click and with the keyboard
// (→ opens, ← goes back, Esc closes); near the right edge they open to the
// left. Plain context menus (no submenus) still work.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { menu } from '../core/ui.svelte';
import { settings } from '../core/settings.svelte';
import { theme } from '../core/theme.svelte';
import { UI_SCALES } from '../core/appCommands';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const menus = () => [...document.querySelectorAll<HTMLElement>('.menu')];
const itemsOf = (m: HTMLElement) => [...m.querySelectorAll<HTMLButtonElement>('.mi')];
const find = (m: HTMLElement, label: string) => itemsOf(m).find((b) => b.querySelector('.lb')?.textContent === label);

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
  const top = itemsOf(root).map((b) => b.querySelector('.lb')!.textContent);
  log(`app menu: ${top.join(' · ')}`);
  assert(top.length <= 22, `${top.length} top-level items`);
  for (const l of ['Go to file…', 'New', 'This file', 'Image', 'Tools', 'View', 'Settings']) assert(top.includes(l), `has ${l}`);
  assert(find(root, 'New')!.querySelector('.arrow'), 'submenus are marked');
  assert(top.indexOf('Image') < top.indexOf('Tools'), 'the open file’s menu comes before Tools');

  // ---- one row per family of options ----
  const themeRow = root.querySelector<HTMLElement>('[data-control="theme"]');
  assert(themeRow && themeRow.querySelectorAll('button').length === 3, 'the theme is one three-way toggle');
  const themeBefore = settings.value.theme;
  [...themeRow.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Dark')!.click();
  await waitFor(() => (settings.value.theme === 'dark' ? true : null), 'theme set from the menu');
  assert(menu.open, 'the menu stays open while adjusting');
  const slider = root.querySelector<HTMLInputElement>('[data-control="uiScale"] input[type="range"]')!;
  slider.value = String(UI_SCALES.indexOf(1.25));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);
  assert(settings.value.uiScale !== 1.25, 'not applied while dragging (the menu would rescale under the pointer)');
  assert(root.querySelector('[data-control="uiScale"]')!.textContent!.includes('125%'), 'the value shows while dragging');
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => (settings.value.uiScale === 1.25 ? true : null), 'interface size from the slider, on release');
  slider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitFor(() => (settings.value.uiScale === 1 ? true : null), 'double-click resets it');
  theme.set(themeBefore as typeof settings.value.theme & ("system" | "dark" | "light"));
  assert(root.querySelector('[data-control="fontSize"] input[type="range"]'), 'text size slider');

  // ---- hover opens a submenu; on/off options are checked items; split layouts are buttons ----
  const view = find(root, 'View')!;
  view.dispatchEvent(new MouseEvent('mouseenter'));
  const sub = await waitFor(() => menus()[1], 'View submenu');
  const r0 = root.getBoundingClientRect();
  assert(sub.getBoundingClientRect().left >= r0.right - 8, 'opens beside the menu');
  const sidebarItem = find(sub, 'Sidebar')!;
  assertEq(sidebarItem.getAttribute('aria-checked'), String(settings.value.sidebarVisible), 'Sidebar shows its state');
  assert(sidebarItem.querySelector('.check')?.textContent === '✓', 'with a check mark');
  sub.querySelector<HTMLButtonElement>('[data-control="split"] button[title="Two side by side"]')!.click();
  await waitFor(() => (workspace.split?.panes.length === 2 ? true : null), 'split from the menu');
  await waitFor(() => (sub.querySelector('[data-control="split"] button[title="Two side by side"]')?.classList.contains('on') ? true : null), 'the layout is marked');
  menu.close();
  workspace.setSplit(null);
  workspace.activate(img);

  // ---- keyboard: down to Image, → into it, → into Tools, Enter ----
  const r = await openAppMenu();
  await sleep(30);
  const order = itemsOf(r).map((b) => b.querySelector('.lb')!.textContent);
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
