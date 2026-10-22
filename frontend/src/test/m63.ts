// M63: moving, scaling and turning a selection's outline (not the pixels).
// On a 200 × 160 picture with the rectangle select tool, a selection of
// 80 × 40 at (60, 30) gets handles. Dragged from inside by (20, 10) it is at
// (80, 40); its right handle dragged 20 further makes it 100 wide; turned 90°
// with the round handle it stands 40 × 100 about the same middle (the mask
// follows: inside the new shape selected, the old corners not); the picture
// is untouched throughout. Shift-dragging inside adds a selection instead of
// moving; a click inside drops it. A wand-like mask selection moves the same
// way and gets its outline worked out again. The brush hides the handles.
// The selection bar's pixel transform is now "Transform pixels".
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { fromMask, fromPath, rectPath } from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m63(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed: any = await waitFor(() => (tab as any).imageTest?.editor(), 'the image editor', 10000);
  await sleep(200);
  const pic = document.createElement('canvas');
  pic.width = 200;
  pic.height = 160;
  const g = pic.getContext('2d')!;
  g.fillStyle = '#204060';
  g.fillRect(0, 0, 200, 160);
  g.fillStyle = '#fff';
  g.fillRect(20, 20, 40, 20);
  ed.load(pic);
  ed.setTool('select');
  await sleep(50);
  const picture = ed.composite().toDataURL();

  const box = () => ed.stage.container().getBoundingClientRect();
  /** A document point on screen. */
  const screen = (x: number, y: number) => {
    const p = ed.docGroup.getAbsoluteTransform().point({ x, y });
    return { x: box().left + p.x, y: box().top + p.y };
  };
  const fire = (type: string, x: number, y: number, shift = false) => {
    const el = document.elementFromPoint(x, y)!;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1, shiftKey: shift };
    el.dispatchEvent(new PointerEvent(`pointer${type}`, { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent(`mouse${type}`, o));
  };
  /** Press at a screen point, move to another in steps, let go. */
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }, shift = false) => {
    fire('down', a.x, a.y, shift);
    for (let i = 1; i <= 8; i++) fire('move', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, shift);
    fire('up', b.x, b.y, shift);
    await sleep(60);
    if (ed.selTr.nodes().length) await framed();
  };
  const handle = (name: string) => {
    const p = ed.selTr.findOne(`.${name}`).getAbsolutePosition();
    return { x: box().left + p.x, y: box().top + p.y };
  };
  /** The handles drawn, and their hit area (a frame or two later). */
  const framed = () =>
    waitFor(() => {
      const b = ed.selection?.bounds;
      if (!b) return null;
      const p = ed.docGroup.getAbsoluteTransform().point({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      return ed.stage.getIntersection(p) === ed.selFrame ? true : null;
    }, "the selection's handles");
  const selected = (x: number, y: number) => ed.selection.mask.getContext('2d').getImageData(x, y, 1, 1).data[3] > 128;
  const bounds = () => JSON.stringify(ed.selection.bounds);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;

  // ---- handles on the selection ----
  const r0 = { x: 60, y: 30, width: 80, height: 40 };
  ed.setPixelSelection(fromPath(rectPath(r0), r0, 200, 160));
  await framed();
  assertEq(ed.selTr.nodes().length, 1, 'the selection gets handles');

  // ---- moved by dragging inside ----
  await drag(screen(100, 50), screen(120, 60));
  assertEq(bounds(), JSON.stringify({ x: 80, y: 40, width: 80, height: 40 }), 'dragged by (20, 10)');
  assert(selected(85, 45) && !selected(65, 35), 'the mask moved with it');
  assert(ed.selection.paths, 'still drawn as a vector outline');
  assertEq(ed.composite().toDataURL(), picture, 'the picture is untouched');

  // ---- scaled by a side handle ----
  const mr = handle('middle-right');
  const step = screen(20, 0).x - screen(0, 0).x;
  await drag(mr, { x: mr.x + step, y: mr.y });
  const b1 = ed.selection.bounds;
  assert(near(b1.x, 80) && near(b1.width, 100) && near(b1.height, 40), `the right handle widens it (${bounds()})`);
  assert(selected(175, 60) && !selected(185, 60), 'the mask too');

  // ---- turned 90° with the round handle ----
  const mid = screen(130, 60);
  await drag(handle('rotater'), { x: mid.x + 200, y: mid.y + 1 });
  assert(near(ed.selFrame.rotation(), 90), `turned to 90° (snapped): ${ed.selFrame.rotation()}`);
  const b2 = ed.selection.bounds;
  assert(near(b2.width, 40) && near(b2.height, 100) && near(b2.x + b2.width / 2, 130) && near(b2.y + b2.height / 2, 60), `stands 40 × 100 about the same middle (${bounds()})`);
  assert(selected(130, 15) && selected(130, 95), 'above and below the old box now selected');
  assert(!selected(90, 45) && !selected(170, 75), 'the old corners not');
  assertEq(ed.composite().toDataURL(), picture, 'the picture is still untouched');
  assertEq(ed.layerCount, 1, 'and no layer was lifted');
  // Dragged again: from the turned outline, kept turned.
  await drag(screen(130, 50), screen(120, 50));
  const b3 = ed.selection.bounds;
  assert(near(b3.x + b3.width / 2, 120) && near(b3.width, 40), `a turned selection moves as it is (${bounds()})`);
  log('selection outline moved, widened and turned 90°; pixels untouched');

  // ---- Shift adds instead of moving; a click drops it ----
  const r1 = { x: 20, y: 20, width: 60, height: 40 };
  ed.setPixelSelection(fromPath(rectPath(r1), r1, 200, 160));
  await framed();
  await drag(screen(40, 30), screen(70, 80), true);
  const b4 = ed.selection.bounds;
  assert(near(b4.x, 20) && near(b4.y, 20) && near(b4.x + b4.width, 80) && near(b4.y + b4.height, 80), `Shift-drag inside adds a selection (${bounds()})`);
  assert(selected(25, 25) && selected(65, 75) && !selected(75, 75), 'both parts selected');
  const c = screen(30, 30);
  fire('down', c.x, c.y);
  fire('up', c.x, c.y);
  await waitFor(() => (ed.selection === null ? true : null), 'a click inside drops it');
  assertEq(ed.selTr.nodes().length, 0, 'and its handles');
  log('Shift-drag adds; a click drops the selection');

  // ---- a mask selection (as from the wand) ----
  const mask = document.createElement('canvas');
  mask.width = 200;
  mask.height = 160;
  const mg = mask.getContext('2d')!;
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.arc(50, 50, 20, 0, Math.PI * 2);
  mg.fill();
  ed.setPixelSelection(fromMask(mask, { x: 30, y: 30, width: 40, height: 40 }, null));
  await framed();
  await drag(screen(50, 50), screen(110, 50));
  assert(selected(110, 50) && !selected(50, 50), 'a mask selection moves too');
  assertEq(JSON.stringify(ed.selection.bounds), JSON.stringify({ x: 90, y: 30, width: 40, height: 40 }), 'its box with it');
  await waitFor(() => (ed.selection?.edges ? true : null), 'its outline worked out again', 5000);
  assertEq(ed.composite().toDataURL(), picture, 'the picture untouched');

  // ---- other tools: no handles ----
  ed.setTool('brush');
  assertEq(ed.selTr.nodes().length, 0, 'the brush hides the handles');
  assert(ed.selection, 'the selection stays');
  ed.setTool('lasso');
  assertEq(ed.selTr.nodes().length, 1, 'the lasso shows them again');
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabview.active button')).find((b) => b.textContent?.trim() === 'Transform pixels');
  assert(btn, 'the selection bar offers "Transform pixels"');
  log('mask selection moved (outline redone); handles only with the selection tools');
  await workspace.close(tab, { force: true });
}
