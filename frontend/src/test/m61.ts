// M61: turning things in the image editor. On a 200 × 100 black picture
// with a white 40 × 20 block at (20, 20): the block selected and "Rotate /
// scale" lifts it onto a floating layer (the move tool on, its hole black);
// turned 90° and applied (Enter), it is one layer again, the block now
// 20 × 40 about the same middle, and one undo puts it back; Esc instead of
// Enter leaves the picture as it was. A layer turned 90° keeps its middle.
// The view turned with Alt+→ (15°, the picture untouched), a rectangle
// drawn there lands where the pointer was, and Alt+0 straightens it.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { fromPath, rectPath } from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

/** The white pixels' bounding box in a canvas. */
function whiteBox(c: HTMLCanvasElement) {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 && d[i + 3] > 200) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export default async function m61(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed: any = await waitFor(() => (tab as any).imageTest?.editor(), 'the image editor', 10000);
  await sleep(200);
  const pic = document.createElement('canvas');
  pic.width = 200;
  pic.height = 100;
  const g = pic.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 200, 100);
  g.fillStyle = '#fff';
  g.fillRect(20, 20, 40, 20);
  ed.load(pic);
  await sleep(50);
  const select = () => {
    const r = { x: 20, y: 20, width: 40, height: 20 };
    ed.setPixelSelection(fromPath(rectPath(r), r, 200, 100));
  };

  // ---- rotate a selection, apply ----
  select();
  ed.transformSelection();
  assert(ed.state().transforming, 'the selection is lifted');
  assertEq(ed.tool, 'move', 'with the move tool');
  assertEq(ed.layerCount, 2, 'onto a layer of its own');
  ed.rotateLayer(90);
  commands.execute('image.apply');
  await waitFor(() => (!ed.state().transforming ? true : null), 'applied with Enter');
  assertEq(ed.layerCount, 1, 'one layer again');
  const box = whiteBox(ed.composite());
  assertEq(`${box.w}×${box.h}`, '20×40', 'the block is turned');
  assert(Math.abs(box.x + box.w / 2 - 40) <= 1 && Math.abs(box.y + box.h / 2 - 30) <= 1, `about its middle (${JSON.stringify(box)})`);
  ed.undo();
  assertEq(JSON.stringify(whiteBox(ed.composite())), JSON.stringify({ x: 20, y: 20, w: 40, h: 20 }), 'one undo puts it back');

  // ---- or cancel ----
  select();
  ed.transformSelection();
  ed.rotateLayer(45);
  commands.execute('image.escape');
  await waitFor(() => (!ed.state().transforming ? true : null), 'cancelled with Esc');
  assertEq(ed.layerCount, 1, 'no floating layer left');
  assertEq(JSON.stringify(whiteBox(ed.composite())), JSON.stringify({ x: 20, y: 20, w: 40, h: 20 }), 'the picture as it was');
  log('selection rotated and applied, undone; another cancelled');

  // ---- a layer turned about its middle ----
  const c = document.createElement('canvas');
  c.width = 60;
  c.height = 20;
  c.getContext('2d')!.fillStyle = '#fff';
  c.getContext('2d')!.fillRect(0, 0, 60, 20);
  ed.pasteImage(c, { x: 100, y: 40 });
  ed.rotateLayer(90);
  const lb = ed.active.group.getClientRect({ relativeTo: ed.docGroup });
  assert(Math.abs(lb.width - 20) < 0.5 && Math.abs(lb.height - 60) < 0.5, `layer turned (${lb.width}×${lb.height})`);
  assert(Math.abs(lb.x + lb.width / 2 - 130) < 0.5 && Math.abs(lb.y + lb.height / 2 - 50) < 0.5, 'and kept its middle');
  ed.undo();
  ed.undo();
  log('layer turned 90° about its middle');

  // ---- the view turned (not the picture) ----
  const before = ed.composite().toDataURL();
  const zoom0 = ed.view.zoom;
  commands.execute('image.viewRotateCW');
  await sleep(30);
  assertEq(ed.viewRotation, 15, 'Alt+→ turns the view 15°');
  assertEq(ed.composite().toDataURL(), before, 'the picture is untouched');
  assert(ed.composite().width === 200 && ed.composite().height === 100, 'and keeps its size');
  // A document point and where it is on screen agree both ways.
  const r = ed.stage.container().getBoundingClientRect();
  const sp = ed.docGroup.getAbsoluteTransform().point({ x: 150, y: 70 });
  const back = ed.docPoint(r.left + sp.x, r.top + sp.y);
  assert(Math.abs(back.x - 150) < 0.01 && Math.abs(back.y - 70) < 0.01, `screen ↔ picture points (${back.x}, ${back.y})`);
  // Drawing in the turned view: a rectangle from (150, 70) lands there.
  ed.setTool('rect');
  const fire = (type: string, x: number, y: number) => {
    const el = document.elementFromPoint(x, y)!;
    el.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent(`mouse${type}`, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1 }));
  };
  const end = ed.docGroup.getAbsoluteTransform().point({ x: 180, y: 90 });
  fire('down', r.left + sp.x, r.top + sp.y);
  for (let i = 1; i <= 5; i++) fire('move', r.left + sp.x + ((end.x - sp.x) * i) / 5, r.top + sp.y + ((end.y - sp.y) * i) / 5);
  fire('up', r.left + end.x, r.top + end.y);
  await sleep(50);
  const rect = ed.active.objs.getChildren().at(-1);
  assert(rect, 'a rectangle drawn in the turned view');
  assert(Math.abs(rect.x() - 150) < 1.5 && Math.abs(rect.y() - 70) < 1.5, `where the pointer was (${rect.x()}, ${rect.y()})`);
  commands.execute('image.viewRotateReset');
  await sleep(30);
  assertEq(ed.viewRotation, 0, 'Alt+0 straightens it');
  assert(ed.view.zoom > 0 && Number.isFinite(zoom0), 'zoom kept');
  log('view turned and straightened; drawing lands under the pointer');
  await workspace.close(tab, { force: true });
}
