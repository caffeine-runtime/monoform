// M39: tabs. The + button opens a start page in a tab, and what is opened
// from it takes its place. Dragging a tab (pointer events): along the bar
// reorders with a mark where it will land; onto a view's edge splits; out
// of the window shows "Release for a new window", and releasing there opens
// the file in a second app window (a child process that, in a self-test,
// reports what it shows) and closes the tab here.
import { api, fileUrl } from '../core/backend';
import { boot } from '../core/boot';
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const tabEls = () => [...document.querySelectorAll<HTMLElement>('.tabbar .tab')];
const titles = () => workspace.tabs.map((t) => t.title);
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

function pointer(type: string, target: EventTarget, x: number, y: number, extra: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, screenX: x + 100, screenY: y + 100, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, bubbles: true, ...extra }));
}

/** Press on a tab, move through the points, release at the last one. */
async function dragTab(el: HTMLElement, path: { x: number; y: number }[]) {
  const c = centre(el);
  pointer('pointerdown', el, c.x, c.y);
  pointer('pointermove', el, c.x + 8, c.y); // past the threshold
  for (const p of path) {
    pointer('pointermove', el, p.x, p.y);
    await sleep(20);
  }
  const end = path[path.length - 1];
  pointer('pointerup', el, end.x, end.y);
  await sleep(30);
}

export default async function m39(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const files = [join(dir, 'notes', 'index.md'), join(dir, 'notes', 'sub', 'other.md'), join(dir, 'diagrams', 'notes.md')];
  for (const f of files) await workspace.openPath(f);
  assertEq(titles().join(','), 'index.md,other.md,notes.md', 'three tabs');

  // ---- + opens a start page in a tab; opening from it replaces it ----
  const plus = document.querySelector<HTMLButtonElement>('.tabbar button[aria-label="New tab"]');
  assert(plus, 'a + button in the tab bar');
  workspace.activate(workspace.tabs[0]);
  plus!.click();
  await waitFor(() => (workspace.active?.title === 'New tab' ? true : null), 'new tab active');
  assertEq(workspace.tabs.indexOf(workspace.active!), 1, 'next to the active tab');
  await waitFor(() => document.querySelector('.tabview.active .welcome .drop'), 'start page in the tab');
  await workspace.openPath(files[1]);
  assertEq(titles().join(','), 'index.md,New tab,other.md,notes.md', 'an already open file just activates (the new tab stays)');
  const extra = join(dir, 'hash', 'abc.txt');
  workspace.activate(workspace.tabs.find((t) => t.title === 'New tab')!);
  await workspace.openPath(extra);
  assertEq(titles().join(','), 'index.md,abc.txt,other.md,notes.md', 'the opened file takes the new tab’s place');
  await workspace.close(workspace.tabs[1], { force: true });

  // ---- drag along the bar: reorder, with a mark while dragging ----
  await sleep(50);
  let els = tabEls();
  const last = els[2].getBoundingClientRect();
  const c0 = centre(els[0]);
  pointer('pointerdown', els[0], c0.x, c0.y);
  pointer('pointermove', els[0], c0.x + 8, c0.y);
  pointer('pointermove', els[0], last.right - 4, c0.y);
  await sleep(30);
  assert(document.querySelector('.tabbar .tab.dragging'), 'the dragged tab is dimmed');
  assert(document.querySelector('.tabbar .tab.drop-after'), 'a mark after the last tab');
  assert(document.querySelector('.tab-ghost'), 'a ghost follows the pointer');
  pointer('pointerup', els[0], last.right - 4, c0.y);
  await sleep(30);
  assertEq(titles().join(','), 'other.md,notes.md,index.md', 'moved to the end');
  assert(!document.querySelector('.tab-ghost'), 'ghost gone');
  assert(!document.querySelector('.tab.dragging'), 'no tab dimmed');
  // A plain click still just activates.
  els = tabEls();
  const c1 = centre(els[1]);
  pointer('pointerdown', els[1], c1.x, c1.y);
  pointer('pointerup', els[1], c1.x, c1.y);
  els[1].click();
  await sleep(30);
  assertEq(workspace.active?.title, 'notes.md', 'click activates');
  assertEq(titles().join(','), 'other.md,notes.md,index.md', 'a click doesn’t move');

  // ---- drag onto the right edge of the view: split ----
  workspace.activate(workspace.tabs[0]);
  const view = document.querySelector('.tabview.active')!.getBoundingClientRect();
  await dragTab(tabEls()[2], [
    { x: view.left + view.width / 2, y: view.top + view.height / 2 },
    { x: view.right - 20, y: view.top + view.height / 2 },
  ]);
  await waitFor(() => (workspace.split?.panes.length === 2 ? true : null), 'split by dropping on the right edge');
  assertEq(workspace.tabs.find((t) => t.id === workspace.split!.panes[1])?.title, 'index.md', 'dropped tab on the right');
  workspace.setSplit(null);

  // ---- drag out of the window: a new window with the file ----
  const marker = join(dir, 'newfiles', 'window-child.json');
  const leaving = tabEls().findIndex((e) => e.textContent?.includes('notes.md'));
  const el = tabEls()[leaving];
  const c = centre(el);
  pointer('pointerdown', el, c.x, c.y);
  pointer('pointermove', el, c.x + 8, c.y);
  pointer('pointermove', el, -40, c.y + 30);
  await sleep(30);
  assert(document.querySelector('.tab-ghost .ghint')?.textContent?.includes('new window'), 'ghost says it opens a new window');
  pointer('pointerup', el, -40, c.y + 30);
  await waitFor(() => (!titles().includes('notes.md') ? true : null), 'tab left this window', 5000);
  const t0 = performance.now();
  const child = await waitFor(async () => {
    const r = await fetch(fileUrl(marker));
    return r.ok ? ((await r.json()) as { extraWindow: boolean; tabs: string[]; sidebar: boolean }) : null;
  }, 'the new window to start and report', 30000);
  log(`new window reported after ${Math.round(performance.now() - t0)} ms: ${JSON.stringify(child)}`);
  assert(child.extraWindow, 'it runs as an extra window');
  assertEq(child.tabs.join(','), files[2], 'showing just the moved file');
  assert(!boot.extraWindow, 'this one is still the main window');
}

/** Run by the new window in a self-test: report what it shows, then quit. */
export async function windowChild(dir: string) {
  await waitFor(() => (workspace.tabs.length ? true : null), 'the file');
  await api.CreateFolder(join(dir, 'newfiles')).catch(() => {});
  await api.TestWriteFile(join(dir, 'newfiles', 'window-child.json'), JSON.stringify({ extraWindow: boot.extraWindow, tabs: workspace.tabs.map((t) => t.filePath) }));
}
