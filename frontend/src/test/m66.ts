// M66: Select › Modify. On a 200 × 150 picture a 60 × 40 rectangle selection
// at (70, 55): Expand 5 grows it to 70 × 50 with round corners; Contract 5
// (from the original) shrinks it to 50 × 30; Border 6 selects a band across
// the edge with the middle empty; Feather 8 gives soft alpha across the edge
// and leaves the middle whole; Smooth 6 drops a stray selected pixel. Each
// result is drawn as an outline. The selection bar's Modify menu offers the
// five, as does the right-click menu (Modify selection) and Ctrl+K.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { menu } from '../core/ui.svelte';
import { workspace } from '../core/tabs.svelte';
import { fromMask, fromPath, rectPath } from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m66(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const pic = document.createElement('canvas');
  pic.width = 200;
  pic.height = 150;
  pic.getContext('2d')!.fillStyle = '#808080';
  pic.getContext('2d')!.fillRect(0, 0, 200, 150);
  ed.load(pic);
  await sleep(50);
  const r0 = { x: 70, y: 55, width: 60, height: 40 };
  const reset = () => ed.setPixelSelection(fromPath(rectPath(r0), r0, 200, 150));
  const alpha = (x: number, y: number) => ed.selection.mask.getContext('2d').getImageData(x, y, 1, 1).data[3];
  const b = () => JSON.stringify(ed.selection.bounds);

  reset();
  await h.modifySelection('expand', 5);
  assertEq(b(), JSON.stringify({ x: 65, y: 50, width: 70, height: 50 }), 'expand 5');
  assert(alpha(66, 75) > 127 && alpha(100, 51) > 127, 'grown on every side');
  assert(alpha(65, 50) < 128, 'with round corners');
  assert(ed.selection.edges, 'and an outline');

  reset();
  await h.modifySelection('contract', 5);
  assertEq(b(), JSON.stringify({ x: 75, y: 60, width: 50, height: 30 }), 'contract 5');

  reset();
  await h.modifySelection('border', 6);
  assert(alpha(70, 75) > 127 && alpha(67, 75) > 127 && alpha(72, 75) > 127, 'border: across the edge');
  assert(alpha(100, 75) < 128 && alpha(60, 75) < 128, 'border: middle and outside not');

  reset();
  await h.modifySelection('feather', 8);
  assertEq(alpha(100, 75), 255, 'feather: the middle whole');
  const e = alpha(70, 75);
  assert(e > 60 && e < 200, `feather: soft at the edge (${e})`);
  assert(alpha(66, 75) > 0, 'feather: reaches outside');

  // A stray selected pixel goes with Smooth.
  const m = document.createElement('canvas');
  m.width = 200;
  m.height = 150;
  const g = m.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(70, 55, 60, 40);
  g.fillRect(20, 20, 1, 1);
  ed.setPixelSelection(fromMask(m, { x: 20, y: 20, width: 110, height: 75 }, null));
  await h.modifySelection('smooth', 6);
  assert(alpha(20, 20) < 128 && alpha(100, 75) > 127, 'smooth drops the speck, keeps the body');
  assertEq(b(), JSON.stringify({ x: 70, y: 55, width: 60, height: 40 }), 'its box is the body again');
  log('expand, contract, border, feather, smooth');

  // ---- where they are offered ----
  reset();
  await sleep(30);
  const btn = await waitFor(() => Array.from(document.querySelectorAll<HTMLButtonElement>(`.tabview[data-tab-id="${tab.id}"] .selbar button`)).find((x) => x.textContent?.trim().startsWith('Modify')) ?? null, 'Modify in the selection bar');
  btn.click();
  const items = await waitFor(() => menu.open?.items ?? null, 'its menu');
  assertEq(items.map((i) => i.label).join(','), 'Feather…,Expand…,Contract…,Smooth…,Border…', 'the five');
  menu.close();
  for (const id of ['image.selFeather', 'image.selExpand', 'image.selContract', 'image.selSmooth', 'image.selBorder']) assert(commands.get(id), `command ${id}`);
  const stage = ed.stage.container().getBoundingClientRect();
  const [cx, cy] = [stage.left + stage.width / 2, stage.top + stage.height / 2];
  document.elementFromPoint(cx, cy)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2 }));
  const ctx = await waitFor(() => menu.open?.items ?? null, 'the right-click menu');
  const sub = ctx.find((i) => i.label === 'Modify selection');
  assert(sub && sub.items?.length === 5, 'right-click › Modify selection');
  menu.close();
  log('offered in the selection bar, right-click menu and commands');
  await workspace.close(tab, { force: true });
}
