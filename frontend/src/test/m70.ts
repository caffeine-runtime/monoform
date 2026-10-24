// M70: Image › Canvas size. On a red 100 × 50 picture: the command opens the
// dialog; 140 × 90 anchored in the middle leaves the picture where it was,
// 20 px of transparent space round it, in one undo step. Anchored top left
// with the current colour, the new space is that colour and the picture
// stays at 0, 0. Smaller than the picture cuts it (anchored bottom right:
// the bottom-right part stays). Every layer moves with the picture.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m70(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const red = document.createElement('canvas');
  red.width = 100;
  red.height = 50;
  const g = red.getContext('2d')!;
  g.fillStyle = '#f00';
  g.fillRect(0, 0, 100, 50);
  g.fillStyle = '#00f';
  g.fillRect(90, 40, 10, 10); // a blue corner, to see what a cut keeps
  ed.load(red);
  await sleep(60);
  const px = (x: number, y: number) => Array.from(ed.composite().getContext('2d')!.getImageData(x, y, 1, 1).data) as number[];
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;

  // ---- through the dialog: centred, transparent ----
  commands.execute('image.canvasSize');
  const bar = await waitFor(() => root().querySelector('.banner.canvas-size'), 'the Canvas size dialog');
  const [wIn, hIn] = Array.from(bar.querySelectorAll<HTMLInputElement>('input.num'));
  assertEq(wIn.value, '100', 'starts at the picture’s width');
  const set = (el: HTMLInputElement, v: number) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(wIn, 140);
  set(hIn, 90);
  assertEq(bar.querySelectorAll('.anchor .cell').length, 9, 'nine anchor cells');
  assert(bar.querySelectorAll('.anchor .cell')[4].classList.contains('on'), 'the middle is the default anchor');
  bar.querySelector<HTMLButtonElement>('.btn.primary')!.click();
  await sleep(60);
  assert(!root().querySelector('.banner.canvas-size'), 'the dialog closes');
  assertEq(`${ed.width} × ${ed.height}`, '140 × 90', 'the new size');
  assertEq(px(10, 10)[3], 0, 'the new space is transparent');
  assertEq(px(25, 25).join(), '255,0,0,255', 'the picture moved 20 px in');
  assertEq(px(115, 65).join(), '0,0,255,255', 'its corner too');
  assertEq(px(125, 70)[3], 0, 'transparent after it');
  ed.undo();
  assertEq(`${ed.width} × ${ed.height}`, '100 × 50', 'one undo');
  assertEq(px(0, 0).join(), '255,0,0,255', 'the picture is back');
  log('Canvas size dialog: centred, transparent, undone');

  // ---- top left, filled with the current colour, two layers ----
  ed.addLayer('Top');
  ed.setOptions({ color: '#00ff00' });
  commands.execute('image.canvasSize');
  const bar2 = await waitFor(() => root().querySelector('.banner.canvas-size'), 'the dialog again');
  const [w2, h2] = Array.from(bar2.querySelectorAll<HTMLInputElement>('input.num'));
  set(w2, 150);
  set(h2, 60);
  bar2.querySelectorAll<HTMLButtonElement>('.anchor .cell')[0].click();
  const sel = bar2.querySelector<HTMLSelectElement>('select')!;
  sel.value = 'colour';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(20);
  bar2.querySelector<HTMLButtonElement>('.btn.primary')!.click();
  await sleep(60);
  assertEq(px(0, 0).join(), '255,0,0,255', 'anchored top left: the picture stays at 0, 0');
  assertEq(px(120, 20).join(), '0,255,0,255', 'new space on the right in the colour');
  assertEq(px(20, 55).join(), '0,255,0,255', 'and below');
  assertEq(px(95, 45).join(), '0,0,255,255', 'the picture untouched');
  assert(ed.layers.length === 2 && ed.layers.every((L: { canvas: HTMLCanvasElement }) => L.canvas.width === 150 && L.canvas.height === 60), 'every layer is the new size');
  ed.undo();
  log('top left, the new space in the current colour');

  // ---- smaller cuts it ----
  ed.canvasSize(30, 20, { x: 1, y: 1 });
  await sleep(40);
  assertEq(`${ed.width} × ${ed.height}`, '30 × 20', 'smaller');
  assertEq(px(25, 15).join(), '0,0,255,255', 'anchored bottom right: the blue corner kept');
  assertEq(px(5, 5).join(), '255,0,0,255', 'and red before it');
  ed.undo();
  assertEq(`${ed.width} × ${ed.height}`, '100 × 50', 'undone');
  log('smaller canvas cuts the picture at the anchor');
  await workspace.close(tab, { force: true });
}
