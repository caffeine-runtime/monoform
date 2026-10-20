// M35: resizable splits — the divider between a Markdown note's source and
// preview drags to 30 % (the share shown while dragging), double-click puts
// it back to 50/50, arrow keys nudge it, and the ratio is remembered when the
// note is opened again; HTML has the same divider. The split view's divider
// between tabs has a visible handle, moves with the arrow keys, shows the
// share while dragging and resets on double-click.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const pane = (t: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${t.id}"]`)!;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true }));
}

/** Drag a divider to a fraction of its container; returns the label shown mid-drag. */
async function drag(div: HTMLElement, box: DOMRect, f: number, axis: 'x' | 'y' = 'x'): Promise<string> {
  const r = div.getBoundingClientRect();
  const sx = r.left + r.width / 2;
  const sy = r.top + r.height / 2;
  const tx = axis === 'x' ? box.left + box.width * f : sx;
  const ty = axis === 'y' ? box.top + box.height * f : sy;
  pointer(div, 'pointerdown', sx, sy);
  pointer(div, 'pointermove', (sx + tx) / 2, (sy + ty) / 2);
  pointer(div, 'pointermove', tx, ty);
  await sleep(50);
  const label = div.querySelector('.pct')?.textContent ?? '';
  pointer(div, 'pointerup', tx, ty);
  await sleep(50);
  return label;
}

function key(el: HTMLElement, k: string) {
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

export default async function m35(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  try {
    localStorage.removeItem('hia.split.markdown');
  } catch {
    /* ignore */
  }
  // ---- Markdown: source | preview ----
  const md = (await workspace.openPath(join(dir, 'diagrams', 'notes.md')))!;
  const div = await waitFor(() => pane(md).querySelector<HTMLElement>('.panes > .divider'), 'markdown divider');
  const box = () => pane(md).querySelector('.panes')!.getBoundingClientRect();
  const share = () => pane(md).querySelector('.src')!.getBoundingClientRect().width / box().width;
  assert(near(share(), 0.5), `starts at 50 % (${share()})`);
  const label = await drag(div, box(), 0.3);
  assert(near(share(), 0.3), `dragged to 30 % (${share().toFixed(3)})`);
  assert(/30 % · 70 %/.test(label), `share shown while dragging: "${label}"`);
  div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await sleep(50);
  assert(near(share(), 0.5), `double-click: 50/50 (${share()})`);
  key(div, 'ArrowRight');
  key(div, 'ArrowRight');
  await sleep(50);
  assert(near(share(), 0.54, 0.01), `arrow keys nudge (${share()})`);
  log(`markdown split at ${Math.round(share() * 100)} %`);

  // Remembered when the note is opened again.
  await workspace.close(md, { force: true });
  const md2 = (await workspace.openPath(join(dir, 'diagrams', 'notes.md')))!;
  await waitFor(() => pane(md2).querySelector('.panes > .divider'), 'divider again');
  const share2 = pane(md2).querySelector('.src')!.getBoundingClientRect().width / pane(md2).querySelector('.panes')!.getBoundingClientRect().width;
  assert(near(share2, 0.54, 0.01), `ratio remembered (${share2})`);

  // HTML has the same divider in its split view.
  const html = (await workspace.openPath(join(dir, 'web', 'index.html')))!;
  const splitBtn = await waitFor(() => [...pane(html).querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent?.includes('Split')), 'HTML split button');
  splitBtn.click();
  await waitFor(() => pane(html).querySelector('.panes > .divider'), 'HTML divider');

  // ---- split view between tabs ----
  workspace.activate(md2);
  commands.execute('view.splitColumns');
  await waitFor(() => (workspace.split?.panes.length === 2 ? true : null), 'two panes');
  const sd = await waitFor(() => document.querySelector<HTMLElement>('.split-overlay .div.x'), 'split divider');
  assert(sd.querySelector('.grip') && sd.querySelector('.grip')!.getBoundingClientRect().height > 20, 'visible handle');
  key(sd, 'ArrowLeft');
  await waitFor(() => (near(workspace.split!.x, 0.48, 0.005) ? true : null), 'arrow key moves the split');
  const host = document.querySelector('.split-overlay')!.getBoundingClientRect();
  const sl = await drag(sd, host, 0.7);
  assert(near(workspace.split!.x, 0.7), `split dragged to 70 % (${workspace.split!.x})`);
  assert(/70 % · 30 %/.test(sl), `share shown while dragging: "${sl}"`);
  sd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitFor(() => (workspace.split!.x === 0.5 ? true : null), 'double-click: equal sizes');
  workspace.setSplit(null);
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  assertEq(workspace.tabs.length, 0, 'closed');
}
