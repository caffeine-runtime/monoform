// M89: the sidebar's three widths and resizable side panels. Dragging the
// sidebar's edge narrows it, then makes it a strip of icons (the mark, Files,
// Find, Open folder, pinned and recent files with their labels beside them,
// Settings and the menu), then hides it; the mark expands the strip again and
// Ctrl+Shift+B toggles it. A Markdown note's side panel is as wide as it's
// dragged (remembered, arrow keys, double-click for the usual width), and
// dragged away it hides the side panels. In the note's source, the marks of
// bold, italic, headings, code and lists each have their colour.
import { EditorView } from '@codemirror/view';
import { commands } from '../core/commands';
import { settings } from '../core/settings.svelte';
import { sidebar } from '../core/sidebar.svelte';
import { workspace } from '../core/tabs.svelte';
import { basename } from '../core/paths';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const scale = () => settings.value.uiScale || 1;
const pointer = (el: Element, type: string, x: number) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 300, pointerId: 1 }));

/** Drag `grip` from where it is through `xs`, letting go at the last. */
async function drag(grip: Element, xs: number[]) {
  const r = grip.getBoundingClientRect();
  pointer(grip, 'pointerdown', r.left + r.width / 2);
  for (const x of xs) {
    pointer(grip, 'pointermove', x);
    await sleep(40);
  }
  pointer(grip, 'pointerup', xs[xs.length - 1]);
}
const width = () => $('.sidebar')?.getBoundingClientRect().width ?? 0;
const settle = (want: number, what: string) => waitFor(() => (Math.abs(width() - want) <= 2 ? true : null), `${what} (${width()} vs ${want})`, 3000);

async function sidebarWidths(dir: string) {
  settings.update((s) => {
    s.sidebarVisible = true;
    s.sidebarCompact = false;
    s.sidebarWidth = 260;
    s.pinned = [`${dir}/notes/index.md`];
  });
  await waitFor(() => $('.sidebar .head'), 'the full sidebar');
  const grip = $('.sidebar .resizer')!;

  await drag(grip, [320, 300]);
  await settle(300, 'follows the drag');
  assertEq(settings.value.sidebarWidth, 300, 'width remembered');
  assert(!settings.value.sidebarCompact, 'still full');

  // Narrower than it can be: the strip.
  await drag(grip, [200, 150, 100]);
  const rail = Math.round(52 * scale());
  await settle(rail, 'the icon strip');
  assert(settings.value.sidebarCompact && settings.value.sidebarVisible, 'compact, still shown');
  await waitFor(() => (!$('.sidebar .head') ? true : null), 'the full header gone');
  const names = [...document.querySelectorAll<HTMLElement>('.sidebar .rail [aria-label]')].map((b) => b.getAttribute('aria-label'));
  for (const n of ['Expand sidebar', 'Files', 'Find in folder', 'Open folder', 'index.md', 'Settings', 'Menu']) assert(names.includes(n), `${n} in the strip (${names.join(', ')})`);
  assertEq(settings.value.sidebarWidth, 300, 'the full width kept for later');
  log(`strip ${width()} px: ${names.join(', ')}`);

  // Labels beside the icons, gliding from one to the next.
  const files = $<HTMLButtonElement>('.sidebar .rbtn[aria-label="Files"]')!;
  files.dispatchEvent(new PointerEvent('pointerenter'));
  const tip = await waitFor(() => $('.sidebar .rtip'), 'a label beside Files', 2000);
  assert(tip.textContent?.startsWith('Files'), `label says ${tip.textContent}`);
  assert(tip.getBoundingClientRect().left > files.getBoundingClientRect().right, 'to the right of the icon');
  files.dispatchEvent(new PointerEvent('pointerleave'));
  const find = $<HTMLButtonElement>('.sidebar .rbtn[aria-label="Find in folder"]')!;
  find.dispatchEvent(new PointerEvent('pointerenter'));
  await sleep(20);
  assert($('.sidebar .rtip')?.textContent?.startsWith('Find in folder'), 'the next label at once');
  find.dispatchEvent(new PointerEvent('pointerleave'));
  await waitFor(() => (!$('.sidebar .rtip') ? true : null), 'label gone');

  // A file from the strip opens, and is marked as the open one.
  $<HTMLButtonElement>('.sidebar .rbtn[aria-label="index.md"]')!.click();
  await waitFor(() => (workspace.active?.filePath?.endsWith('index.md') ? true : null), 'the pinned note opened');
  await waitFor(() => $('.sidebar .rbtn.on[aria-label="index.md"]'), 'marked as open');

  // The mark expands it; Ctrl+Shift+B makes it a strip again and back.
  $<HTMLButtonElement>('.sidebar .logo')!.click();
  await settle(300, 'expanded to the width it had');
  assert(!settings.value.sidebarCompact && $('.sidebar .head'), 'full again');
  commands.execute('view.compactSidebar');
  await settle(rail, 'Ctrl+Shift+B: the strip');
  // Find in folder from the strip opens the search, at full width.
  find.isConnected ? find.click() : $<HTMLButtonElement>('.sidebar .rbtn[aria-label="Find in folder"]')!.click();
  await settle(300, 'Find expands it');
  assertEq(sidebar.mode, 'search', 'with the search');
  sidebar.mode = 'files';

  // Further than the strip: hidden; Ctrl+B brings it back as it was.
  await drag($('.sidebar .resizer')!, [100, 40, 10]);
  await waitFor(() => (!$('.sidebar') ? true : null), 'hidden');
  assert(!settings.value.sidebarVisible && !settings.value.sidebarCompact, 'hidden, full when it comes back');
  assert($('.tabbar .toggle'), 'the tab bar offers it back');
  commands.execute('view.toggleSidebar');
  await waitFor(() => $('.sidebar .head'), 'back');
  await settle(300, 'at its width');
  log('sidebar: full ↔ strip ↔ hidden by dragging, the mark, Ctrl+Shift+B and Ctrl+B');
}

async function sidePanel(dir: string) {
  for (const tab of [...workspace.tabs]) await workspace.close(tab, { force: true });
  settings.update((s) => {
    s.panelWidths = {};
    s.panelsHidden = false;
  });
  const note = (await workspace.openPath(`${dir}/notes/index.md`))!;
  const pane = () => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${note.id}"]`);
  log(`window ${window.innerWidth}×${window.innerHeight}`);
  // Open unless it was closed in an earlier run (remembered in the webview's storage).
  await sleep(300);
  if (!pane()?.querySelector('.notepanel')) pane()?.querySelector<HTMLButtonElement>('button[title="Outline, backlinks and links"]')?.click();
  const panel = await waitFor(() => pane()?.querySelector<HTMLElement>('.notepanel'), 'the note panel');
  const grip = await waitFor(() => panel.querySelector<HTMLElement>('.mf-panel-grip'), 'its grip');
  const w = () => panel.getBoundingClientRect().width;
  const usual = w();
  assert(Math.abs(usual - 260) <= 2, `the usual width (${usual})`);
  const g = grip.getBoundingClientRect();
  assert(Math.abs(g.left + g.width / 2 - panel.getBoundingClientRect().left) <= 2 && g.height >= panel.clientHeight - 1, 'the grip is on its inner edge, full height');

  // Wider by 120 px: the edge follows the pointer (the panel is on the right).
  const left = panel.getBoundingClientRect().left;
  await drag(grip, [left - 60, left - 120]);
  await waitFor(() => (Math.abs(w() - (usual + 120)) <= 2 ? true : null), `wider (${w()})`);
  const kept = settings.value.panelWidths.markdown;
  assert(Math.abs(kept - (usual + 120) / scale()) <= 2, `remembered at scale 1 (${kept})`);

  // Another note opens with the panel as wide.
  const other = (await workspace.openPath(`${dir}/notes/sub/other.md`))!;
  const otherPanel = await waitFor(() => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${other.id}"] .notepanel`), "the other note's panel");
  await waitFor(() => (Math.abs(otherPanel.getBoundingClientRect().width - (usual + 120)) <= 2 ? true : null), 'as wide in another note');
  await workspace.close(other, { force: true });
  workspace.activate(note);
  await sleep(100);

  // Keys: left widens a right-hand panel; double-click: the usual width again.
  grip.focus();
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await waitFor(() => (Math.abs(w() - (usual + 136)) <= 2 ? true : null), `ArrowLeft widens (${w()})`);
  grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitFor(() => (Math.abs(w() - usual) <= 2 ? true : null), `double-click: usual width (${w()})`);
  assert(!('markdown' in settings.value.panelWidths), 'nothing remembered');

  // Dragged away: the side panels hide, and come back as wide as before.
  const at = panel.getBoundingClientRect().left;
  await drag(grip, [at + 60, at + 200]);
  await waitFor(() => (settings.value.panelsHidden ? true : null), 'side panels hidden');
  await waitFor(() => (pane()?.querySelector('.notepanel')?.getBoundingClientRect().width ? null : true), 'the panel out of the way');
  commands.execute('view.togglePanels');
  await waitFor(() => (Math.abs((pane()?.querySelector('.notepanel')?.getBoundingClientRect().width ?? 0) - usual) <= 2 ? true : null), 'back at its width');
  log(`note panel: ${usual} px, dragged to ${usual + 120}, keys, double-click, dragged away hides`);
  return note;
}

async function markColours(note: { id: number | string }) {
  const el = await waitFor(() => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${note.id}"] .cm-editor`), 'the source');
  const view = EditorView.findFromDOM(el)!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\nSome **bold** and *slanted* and `code`.\n' } });
  await sleep(300);
  // The theme's colours are hex values.
  const resolve = (v: string) => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(v).trim().slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  };
  const colourOf = (text: string) => [...el.querySelectorAll<HTMLElement>('.cm-content span')].filter((s) => s.textContent === text).map((s) => getComputedStyle(s).color);
  const want = { '**': '--syn-md-strong', '*': '--syn-md-emphasis', '`': '--syn-string', '#': '--syn-heading', '-': '--syn-number' };
  for (const [mark, v] of Object.entries(want)) {
    const got = colourOf(mark);
    assert(got.length > 0, `${mark} drawn on its own`);
    assert(got.every((c) => c === resolve(v)), `${mark} in ${v} (${got.join(', ')} vs ${resolve(v)})`);
  }
  assert(resolve('--syn-md-strong') !== getComputedStyle(el.querySelector('.cm-content')!).color, 'bold marks stand out from the text');
  log(`marks: ** ${resolve('--syn-md-strong')}, * ${resolve('--syn-md-emphasis')}, \` ${resolve('--syn-string')}`);
}

export default async function m89(dir: string) {
  await sidebarWidths(dir);
  const note = await sidePanel(dir);
  await markColours(note);
  assertEq(basename(workspace.active?.filePath ?? ''), 'index.md', 'the note still open');
  await workspace.close(workspace.active!, { force: true });
}
