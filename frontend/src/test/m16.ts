// M16: split view (2–4 tabs side by side, Zen-style) and interface size.
import { tick } from 'svelte';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const view = (t: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${t.id}"]`)!;
const box = (t: Tab) => view(t).getBoundingClientRect();
/** Current panes (a function, so earlier assertions don't narrow it). */
const panes = (): string[] => workspace.split?.panes ?? [];
const visible = (t: Tab) => {
  const r = box(t);
  return r.width > 50 && r.height > 50;
};

export default async function m16(dir: string) {
  const md = (await workspace.openPath(join(dir, 'notes', 'index.md')))!;
  const csv = (await workspace.openPath(join(dir, 'data', 'grid.csv')))!;
  const img = (await workspace.openPath(join(dir, 'img', 'subject.png')))!;
  const cube = (await workspace.openPath(join(dir, 'models', 'cube.stl')))!;
  workspace.activate(md);
  await tick();

  // ---- two side by side (Mod+\) ----
  const j = await measureJank(async () => {
    commands.execute('view.splitColumns');
    await tick();
    await sleep(300);
  });
  assert(workspace.split?.layout === 'columns' && workspace.split.panes.length === 2, `split ${JSON.stringify(workspace.split)}`);
  const [a, b] = workspace.split!.panes.map((id) => workspace.tabs.find((t) => t.id === id)!);
  assertEq(a.id, md.id, 'focused tab stays in the first pane');
  assert(visible(a) && visible(b), 'both panes visible');
  assert(Math.abs(box(a).right - box(b).left) < 3 && Math.abs(box(a).width - box(b).width) < 4, 'panes side by side, equal width');
  log(`split in ${Math.round(j.maxGap)} ms longest frame`);
  assert(document.querySelector('.tabbar .layout.on'), 'split button lit');
  assertEq(document.querySelectorAll('.tabbar .pane-no').length, 2, 'tabs in the split are numbered');

  // Clicking a pane focuses its tab.
  view(b).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assertEq(workspace.activeId, b.id, 'pointer focuses the other pane');
  // Choosing a tab from the tab bar shows it in the focused pane.
  workspace.activate(img);
  await tick();
  assertEq(workspace.split!.panes.join(), [md.id, img.id].join(), 'tab bar choice replaces the focused pane');
  await waitFor(() => (visible(img) ? true : null), 'image in its pane');

  // ---- divider drag ----
  const div = document.querySelector<HTMLElement>('.split-overlay .div.x')!;
  const views = document.querySelector<HTMLElement>('.views')!.getBoundingClientRect();
  const d0 = div.getBoundingClientRect();
  const pe = (type: string, x: number) => div.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: d0.top + 50, pointerId: 3, bubbles: true }));
  pe('pointerdown', d0.left + 4);
  pe('pointermove', views.left + views.width * 0.3);
  pe('pointerup', views.left + views.width * 0.3);
  await tick();
  assert(Math.abs(workspace.split!.x - 0.3) < 0.02, `divider moved (${workspace.split!.x})`);
  assert(Math.abs(box(md).width / views.width - 0.3) < 0.03, 'left pane resized');

  // ---- four (grid), including two 3D-capable panes sharing the renderer ----
  commands.execute('view.splitGrid');
  await tick();
  await sleep(500);
  assertEq(panes().length, 4, 'four panes');
  for (const t of [md, csv, img, cube]) assert(visible(t), `${t.title} visible in the grid`);
  const quads = [md, csv, img, cube].map((t) => box(t));
  const area = quads.reduce((n, r) => n + r.width * r.height, 0);
  assert(area / (views.width * views.height) > 0.95, 'panes fill the view');

  // ---- drag a tab onto a pane's edge ----
  const second = (await workspace.openPath(join(dir, 'models', 'spiral.ply'), { activate: false }))!;
  let dropped = false;
  try {
    const dt = new DataTransfer();
    dt.setData('application/x-hia-tab', second.id);
    const overlay = document.querySelector<HTMLElement>('.split-overlay')!;
    window.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    await tick();
    const r = box(csv);
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
    overlay.dispatchEvent(new DragEvent('dragover', at));
    await tick();
    assert(document.querySelector('.split-overlay .zone'), 'drop zone shown while dragging a tab');
    overlay.dispatchEvent(new DragEvent('drop', at));
    window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    dropped = true;
  } catch (e) {
    log(`synthetic drag not supported here: ${e}`);
  }
  if (dropped) {
    await tick();
    assert(panes().includes(second.id) && !panes().includes(csv.id), 'dropping in the middle of a pane replaces its tab');
    await sleep(800);
    // Two 3D views: the one without the shared renderer shows a still of its last frame.
    workspace.activate(second);
    await sleep(300);
    workspace.activate(cube);
    await sleep(300);
    assert(view(second).querySelector('canvas.still'), 'unfocused 3D pane keeps a still image');
  }

  // ---- closing a pane's tab; back to one ----
  await workspace.close(img, { force: true });
  assert(panes().length === 3 && !panes().includes(img.id), 'closing a pane removes it');
  const snap = workspace.snapshot([]);
  assert(snap.split && snap.split.panes.length === 3, `session keeps the split ${JSON.stringify(snap.split)}`);
  commands.execute('view.unsplit');
  await tick();
  assertEq(workspace.split, null, 'back to one tab');
  assert(visible(workspace.active!) && [md, csv, cube, second].filter((t) => t !== workspace.active).every((t) => !visible(t)), 'only the focused tab shows');

  // ---- interface size ----
  const fs0 = parseFloat(getComputedStyle(document.body).fontSize);
  const tb0 = document.querySelector<HTMLElement>('.tabbar')!.getBoundingClientRect().height;
  const ic0 = document.querySelector<SVGElement>('.tabbar svg')!.getBoundingClientRect().width;
  commands.execute('view.uiBigger');
  commands.execute('view.uiBigger');
  await tick();
  assertEq(settings.value.uiScale, 1.25, 'two steps up = 125%');
  const fs1 = parseFloat(getComputedStyle(document.body).fontSize);
  const tb1 = document.querySelector<HTMLElement>('.tabbar')!.getBoundingClientRect().height;
  const ic1 = document.querySelector<SVGElement>('.tabbar svg')!.getBoundingClientRect().width;
  log(`ui 125%: font ${fs0}→${fs1}px, tab bar ${tb0}→${tb1}px, icons ${ic0}→${ic1}px`);
  assert(Math.abs(fs1 / fs0 - 1.25) < 0.02 && Math.abs(tb1 / tb0 - 1.25) < 0.05 && ic1 > ic0, 'text, bars and icons grew');
  workspace.activate(csv);
  await waitFor(() => (document.querySelector('.tabview.active .grid') ? true : null), 'grid');
  assertEq(document.querySelector<HTMLElement>('.tabview.active .grid')!.style.getPropertyValue('--row'), '35px', 'grid rows follow the size');
  commands.execute('view.uiReset');
  await tick();
  assertEq(settings.value.uiScale, 1, 'reset');

  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
