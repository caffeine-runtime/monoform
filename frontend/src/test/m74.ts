// M74: rulers, guides, grid and snapping. On a white 200×100 picture: the
// rulers command shows rulers with ticks; dragging from the top ruler down to
// y = 40 makes a guide there (dragged back onto the ruler: none); a
// rectangle selection started 3 screen pixels above the guide starts on it,
// and with snapping off it doesn't. Ctrl+' shows the grid (20 px here) and
// points snap to it too; a layer dragged near the guide snaps its top edge
// onto it. With the move tool a guide dragged back onto the ruler is gone;
// Clear guides removes the rest. Rulers are hidden while the view is turned.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m74(dir: string) {
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
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;
  h.setOverlays({ rulers: false, grid: false, guides: true, snap: true, gridSize: 0 }); // as a first run finds them
  h.setTool('select');
  const settled = async () => {
    let last = '';
    await waitFor(async () => {
      await sleep(60);
      const v = JSON.stringify(ed.docGroup.getAbsoluteTransform().getMatrix());
      const same = v === last;
      last = v;
      return same ? true : null;
    }, 'the view settled');
  };
  await settled();
  const fire = (type: string, x: number, y: number, target?: Element, extra: object = {}) => {
    const el = target ?? document.elementFromPoint(x, y)!;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1, ...extra };
    el.dispatchEvent(new PointerEvent(`pointer${type}`, { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent(`mouse${type}`, o));
  };
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    fire('down', a.x, a.y);
    for (let i = 1; i <= 6; i++) fire('move', a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
    fire('up', b.x, b.y);
    await sleep(60);
  };

  // ---- rulers ----
  await commands.execute('image.rulers');
  const top = await waitFor(() => root().querySelector<HTMLCanvasElement>('.ruler.top'), 'the top ruler');
  assert(root().querySelector('.ruler.left'), 'and the left one');
  await sleep(100);
  const px = top.getContext('2d')!.getImageData(0, 0, top.width, top.height).data;
  const colours = new Set<number>();
  for (let i = 0; i < px.length; i += 4) colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  assert(colours.size > 2, `ticks drawn (${colours.size} colours)`);

  // ---- a guide from the top ruler ----
  const tr = top.getBoundingClientRect();
  const at40 = ed.toScreen({ x: 100, y: 40 });
  const onRuler = { x: at40.x, y: tr.top + 10 };
  fire('down', onRuler.x, onRuler.y, top);
  for (let i = 1; i <= 5; i++) fire('move', at40.x, onRuler.y + ((at40.y - onRuler.y) * i) / 5, top);
  fire('up', at40.x, at40.y, top);
  await sleep(30);
  assertEq(JSON.stringify(ed.guideList().map((g: { axis: string; pos: number }) => [g.axis, g.pos])), '[["y",40]]', 'a level guide at y = 40');
  fire('down', onRuler.x + 20, onRuler.y, top);
  fire('move', onRuler.x + 20, at40.y, top);
  fire('move', onRuler.x + 20, onRuler.y, top);
  fire('up', onRuler.x + 20, onRuler.y, top);
  assertEq(ed.guideList().length, 1, 'dragged back onto the ruler: no new guide');
  log('rulers drawn; a guide dragged out of the top ruler');

  // ---- snapping a selection ----
  const z = ed.view.zoom;
  const near = 40 - 3 / z; // 3 screen pixels above the guide
  await drag(ed.toScreen({ x: 30, y: near }), ed.toScreen({ x: 120, y: 80 }));
  assertEq(ed.selection?.bounds.y, 40, 'the selection starts on the guide');
  ed.deselect();
  await sleep(80); // the hit areas redrawn
  await commands.execute('image.snap');
  await drag(ed.toScreen({ x: 30, y: near }), ed.toScreen({ x: 120, y: 80 }));
  assert(ed.selection && ed.selection.bounds.y < 40, `snapping off: it starts where dragged (${ed.selection?.bounds.y})`);
  ed.deselect();
  await sleep(80); // the hit areas redrawn
  await commands.execute('image.snap');
  log('a selection snaps to the guide, or not with snapping off');

  // ---- the grid (Ctrl+') ----
  window.dispatchEvent(new KeyboardEvent('keydown', { key: "'", code: 'Quote', ctrlKey: true, bubbles: true }));
  await sleep(30);
  assert(ed.grid, "Ctrl+' shows the grid");
  assertEq(ed.gridStep(), 20, 'a round size: 20 px');
  await drag(ed.toScreen({ x: 60 - 2 / z, y: 60 + 2 / z }), ed.toScreen({ x: 150, y: 90 }));
  assertEq(`${ed.selection?.bounds.x},${ed.selection?.bounds.y}`, '60,60', 'onto grid lines');
  ed.deselect();
  await sleep(80); // the hit areas redrawn
  window.dispatchEvent(new KeyboardEvent('keydown', { key: "'", code: 'Quote', ctrlKey: true, bubbles: true }));
  await sleep(30);
  assert(!ed.grid, "Ctrl+' again: no grid");

  // ---- a layer snaps when moved ----
  const sq = document.createElement('canvas');
  sq.width = 30;
  sq.height = 30;
  sq.getContext('2d')!.fillRect(0, 0, 30, 30);
  ed.addLayer('Square', sq, { x: 130, y: 5 });
  const L = ed.layers[ed.layers.length - 1];
  L.group.position({ x: 133, y: 40 + 2 / z });
  L.group.fire('dragmove');
  assertEq(L.group.y(), 40, 'the top edge onto the guide');
  assertEq(L.group.x(), 133, 'left alone across (nothing near)');
  log('the grid; a layer snaps when moved');

  // ---- a guide dragged back onto the ruler with the move tool ----
  h.setTool('move');
  await settled();
  const g = ed.guideGroup.findOne('.guide');
  const gp = ed.toScreen({ x: 20, y: 40 });
  const st = ed.stage.container().getBoundingClientRect();
  await waitFor(() => (ed.stage.getIntersection({ x: gp.x - st.left, y: gp.y - st.top }) === g ? true : null), 'the guide can be taken');
  const el = document.elementFromPoint(gp.x, gp.y)!;
  fire('down', gp.x, gp.y, el);
  for (let i = 1; i <= 6; i++) fire('move', gp.x, gp.y + ((tr.top + 8 - gp.y) * i) / 6, el);
  fire('up', gp.x, tr.top + 8, el);
  await sleep(60);
  assertEq(ed.guideList().length, 0, 'dragged onto the ruler: gone');
  ed.addGuide('x', 50);
  ed.addGuide('y', 20);
  await commands.execute('image.clearGuides');
  assertEq(ed.guideList().length, 0, 'Clear guides');

  // ---- rulers hide while the view is turned ----
  ed.rotateView(15);
  await sleep(30);
  assert(!root().querySelector('.ruler.top'), 'no rulers on a turned view');
  ed.rotateView(0, true);
  await sleep(30);
  assert(root().querySelector('.ruler.top'), 'back when straight');
  // Leave the defaults for other tests.
  await commands.execute('image.rulers');
  await sleep(20);
  assert(!ed.grid && !root().querySelector('.ruler.top'), 'rulers and grid off again');
  log('a guide dragged back to the ruler; clear guides; rulers hide on a turned view');
  await workspace.close(tab, { force: true });
}
