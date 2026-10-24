// M75: the brush ring. With the brush, eraser, clone stamp, healing brush
// or selection brush the pointer carries a ring as wide as the brush, at the
// pointer over the picture; it follows size changes and the zoom (it is in
// picture pixels), and goes with the pointer leaving the picture or a tool
// without a brush.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m75(dir: string) {
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
  await sleep(50);
  const move = (x: number, y: number) => {
    const p = ed.toScreen({ x, y });
    const el = document.elementFromPoint(p.x, p.y)!;
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y }));
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

  h.setTool('brush');
  ed.setOptions({ brushSize: 20 });
  move(60, 40);
  let r = ed.brushRingAt();
  assert(r && near(r.x, 60) && near(r.y, 40) && r.r === 10, `brush: a ring of radius 10 at the pointer (${JSON.stringify(r)})`);
  ed.setOptions({ brushSize: 36 });
  assertEq(ed.brushRingAt()?.r, 18, 'it follows the size');
  move(120, 70);
  r = ed.brushRingAt();
  assert(r && near(r.x, 120) && near(r.y, 70), 'and the pointer');
  for (const t of ['eraser', 'clone', 'heal']) {
    h.setTool(t);
    move(100, 50);
    assertEq(ed.brushRingAt()?.r, 18, `${t}: the same ring`);
  }
  h.setTool('selbrush');
  ed.setOptions({ brushSize: 12 });
  move(100, 50);
  assertEq(ed.brushRingAt()?.r, 6, 'selection brush: its own size');
  log('a ring as wide as the brush, at the pointer, for every brush tool');

  // In picture pixels: the ring grows with the zoom on screen.
  const before = ed.brushRingAt()!.r * ed.view.zoom;
  ed.zoomStep(1);
  await sleep(30);
  move(100, 50);
  assert(ed.brushRingAt()!.r * ed.view.zoom > before, 'zoomed in, the ring is bigger on screen');

  ed.stage.fire('mouseleave');
  assertEq(ed.brushRingAt(), null, 'gone when the pointer leaves');
  move(100, 50);
  assert(ed.brushRingAt(), 'back over the picture');
  h.setTool('select');
  assertEq(ed.brushRingAt(), null, 'no ring for a tool without a brush');
  move(100, 50);
  assertEq(ed.brushRingAt(), null, 'not even when moving');
  log('follows the zoom; hidden off the picture and for other tools');
  await workspace.close(tab, { force: true });
}
