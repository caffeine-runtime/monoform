// M69: the gradient tool. On a white 200 × 100 picture: dragging from
// (20, 50) to (180, 50) with black, fading to transparent, previews while
// dragging (the guide line shown) and leaves black at the start, mid-grey in
// the middle and white at the end, in one undo step; Shift keeps the angle
// to 45° steps. Radial to white from the middle: black at the centre, white
// at the radius. Reverse swaps the ends. With a selection only the selection
// changes. On a layer mask it fades the layer out: shown at the start,
// hidden at the end.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { fromPath, rectPath } from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m69(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const white = document.createElement('canvas');
  white.width = 200;
  white.height = 100;
  white.getContext('2d')!.fillStyle = '#fff';
  white.getContext('2d')!.fillRect(0, 0, 200, 100);
  ed.load(white);
  await sleep(80);
  const px = (x: number, y = 50) => Array.from(ed.composite().getContext('2d')!.getImageData(x, y, 1, 1).data) as number[];
  const grey = (x: number, y = 50) => px(x, y)[0];
  const box = () => ed.stage.container().getBoundingClientRect();
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

  // ---- linear, dragged ----
  h.setTool('gradient');
  ed.setOptions({ color: '#000000', gradType: 'linear', gradEnd: 'transparent', gradReverse: false, brushOpacity: 1 });
  const a = screen(20, 50);
  const b = screen(180, 50);
  fire('down', a.x, a.y);
  for (let i = 1; i <= 8; i++) fire('move', a.x + ((b.x - a.x) * i) / 8, a.y);
  await sleep(60);
  assert(grey(20) < 10, `previewed while dragging (${grey(20)})`);
  assert(ed.gradLine.points().length === 4, 'the guide line shown');
  fire('up', b.x, b.y);
  await sleep(40);
  assert(grey(20) < 8 && Math.abs(grey(100) - 128) < 12 && grey(180) > 247, `black → grey → white (${grey(20)}, ${grey(100)}, ${grey(180)})`);
  assertEq(ed.gradLine.points().length, 0, 'the guide line gone');
  ed.undo();
  assertEq(grey(20), 255, 'one undo');

  // Shift: 45° steps (a drag slightly off horizontal stays horizontal).
  const c = screen(100, 90);
  fire('down', a.x, a.y);
  for (let i = 1; i <= 6; i++) fire('move', a.x + ((c.x - a.x) * i) / 6, a.y + ((c.y - a.y) * i) / 6 * 0.2, true);
  fire('up', c.x, a.y + (c.y - a.y) * 0.2, true);
  await sleep(40);
  assert(Math.abs(grey(60, 10) - grey(60, 90)) < 4, `Shift kept it horizontal (${grey(60, 10)} vs ${grey(60, 90)})`);
  ed.undo();
  log('linear gradient dragged, previewed, undone; Shift straightens it');

  // ---- radial to white, reversed ----
  ed.setOptions({ gradType: 'radial', gradEnd: 'white' });
  ed.drawGradient({ x: 100, y: 50 }, { x: 150, y: 50 });
  assert(grey(100) < 8 && grey(150) > 247 && Math.abs(grey(125) - 128) < 14, `radial (${grey(100)}, ${grey(125)}, ${grey(150)})`);
  ed.undo();
  ed.setOptions({ gradReverse: true });
  ed.drawGradient({ x: 100, y: 50 }, { x: 150, y: 50 });
  assert(grey(100) > 247 && grey(150) < 8, 'reversed');
  ed.undo();
  ed.setOptions({ gradReverse: false, gradType: 'linear', gradEnd: 'transparent' });

  // ---- inside a selection only ----
  const r = { x: 0, y: 0, width: 100, height: 100 };
  ed.setPixelSelection(fromPath(rectPath(r), r, 200, 100));
  ed.drawGradient({ x: 0, y: 50 }, { x: 200, y: 50 });
  assert(grey(10) < 20 && grey(150) === 255, `only the selection (${grey(10)}, ${grey(150)})`);
  ed.undo();
  ed.deselect();
  log('radial, reversed, inside the selection');

  // ---- on a layer mask: shown → hidden ----
  ed.addMask('show');
  ed.setEditMask(true);
  ed.drawGradient({ x: 0, y: 50 }, { x: 200, y: 50 });
  await sleep(30);
  const alphaAt = (x: number) => px(x)[3];
  assert(alphaAt(5) > 245 && alphaAt(195) < 15 && Math.abs(alphaAt(100) - 128) < 16, `the mask fades the layer out (${alphaAt(5)}, ${alphaAt(100)}, ${alphaAt(195)})`);
  log('on a mask: the layer fades out');
  await workspace.close(tab, { force: true });
}
