// M60: moving a pasted layer. A picture pasted into img/photo.png becomes
// the active layer with the move tool on; with an empty (transparent) layer
// added above it and the pasted one made active again, dragging over it with
// the pointer moves it — the layer on top doesn't catch the drag — by the
// distance dragged. Other tools see every layer again.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m60(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed: any = await waitFor(() => (tab as any).imageTest?.editor(), 'the image editor', 10000);
  await sleep(200);
  const c = document.createElement('canvas');
  c.width = 80;
  c.height = 60;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e03131';
  g.fillRect(0, 0, 80, 60);
  ed.pasteImage(c);
  assertEq(ed.tool, 'move', 'pasting turns the move tool on');
  const pasted = ed.activeId;
  ed.addLayer('Empty on top');
  ed.setActive(pasted);
  ed.setTool('move');
  await sleep(100);
  const L = ed.active;
  const [x0, y0] = [L.group.x(), L.group.y()];
  const r = ed.stage.container().getBoundingClientRect();
  const v = ed.view;
  const sx = r.left + v.x + (x0 + 40) * v.zoom;
  const sy = r.top + v.y + (y0 + 30) * v.zoom;
  const el = document.elementFromPoint(sx, sy)!;
  const fire = (type: string, x: number, y: number, target: EventTarget) => {
    target.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, isPrimary: true, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent(`mouse${type}`, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1 }));
  };
  fire('down', sx, sy, el);
  for (let i = 1; i <= 8; i++) {
    fire('move', sx + i * 10, sy + i * 5, el);
    fire('move', sx + i * 10, sy + i * 5, window);
    await sleep(16);
  }
  fire('up', sx + 80, sy + 40, el);
  fire('up', sx + 80, sy + 40, window);
  await sleep(100);
  const [dx, dy] = [L.group.x() - x0, L.group.y() - y0];
  assert(Math.abs(dx - 80 / v.zoom) < 2 && Math.abs(dy - 40 / v.zoom) < 2, `the pasted layer moved under the empty one (${dx.toFixed(1)}, ${dy.toFixed(1)} px for ${(80 / v.zoom).toFixed(1)}, ${(40 / v.zoom).toFixed(1)})`);
  ed.setTool('hand');
  assert(ed.layers.every((l: { group: { listening: () => boolean } }) => l.group.listening()), 'other tools see every layer');
  log(`moved ${dx.toFixed(1)}, ${dy.toFixed(1)} px through a transparent layer above it`);
  await workspace.close(tab, { force: true });
}
