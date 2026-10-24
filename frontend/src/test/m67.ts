// M67: clone stamp and spot healing. On a 200 × 150 picture (a smooth
// left-to-right gradient, a blue square at (130, 60) 20 × 20 and a dark spot
// at (60, 110)): the clone stamp without a source asks for an Alt-click and
// paints nothing; Alt-click at (40, 70) shows the source mark there; a 10 px
// stroke across the square at y = 70 (from x 128) paints the gradient from
// 88 px to the left into it (the square's top row stays blue), the mark following the
// brush; one undo takes the stroke back. The spot healing brush painted over
// the spot replaces it with what is around (within a few levels of the
// gradient there), in one undo step.
import { join } from '../core/paths';
import { ui } from '../core/ui.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m67(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const grad = (x: number) => [40 + x, 60 + Math.round(x / 2), 90];
  const pic = document.createElement('canvas');
  pic.width = 200;
  pic.height = 150;
  const g = pic.getContext('2d')!;
  for (let x = 0; x < 200; x++) {
    g.fillStyle = `rgb(${grad(x).join(',')})`;
    g.fillRect(x, 0, 1, 150);
  }
  g.fillStyle = '#1040ff';
  g.fillRect(130, 60, 20, 20);
  g.fillStyle = '#101010';
  g.beginPath();
  g.arc(60, 110, 5, 0, Math.PI * 2);
  g.fill();
  ed.load(pic);
  await sleep(100);
  const px = (x: number, y: number) => Array.from(ed.composite().getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)) as number[];
  const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const box = () => ed.stage.container().getBoundingClientRect();
  const screen = (x: number, y: number) => {
    const p = ed.docGroup.getAbsoluteTransform().point({ x, y });
    return { x: box().left + p.x, y: box().top + p.y };
  };
  const fire = (type: string, x: number, y: number, alt = false) => {
    const el = document.elementFromPoint(x, y)!;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1, altKey: alt };
    el.dispatchEvent(new PointerEvent(`pointer${type}`, { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent(`mouse${type}`, o));
  };
  const stroke = async (pts: [number, number][], alt = false) => {
    const s = pts.map(([x, y]) => screen(x, y));
    fire('down', s[0].x, s[0].y, alt);
    for (let i = 1; i < s.length; i++) for (let k = 1; k <= 6; k++) fire('move', s[i - 1].x + ((s[i].x - s[i - 1].x) * k) / 6, s[i - 1].y + ((s[i].y - s[i - 1].y) * k) / 6, alt);
    fire('up', s[s.length - 1].x, s[s.length - 1].y, alt);
    await sleep(60);
  };

  // ---- clone stamp ----
  h.setTool('clone');
  ed.setOptions({ brushSize: 10, brushOpacity: 1 });
  const before = ed.composite().toDataURL();
  await stroke([[140, 70], [141, 70]]);
  assertEq(ed.composite().toDataURL(), before, 'nothing painted without a source');
  assert(ui.toasts.some((t) => t.message.includes('Alt-click')), 'asked for an Alt-click');
  await stroke([[40, 70]], true);
  assert(ed.cloneMark.visible() && Math.abs(ed.cloneMark.x() - 40) < 1 && Math.abs(ed.cloneMark.y() - 70) < 1, 'the source mark at the Alt-click');
  await stroke([[128, 70], [152, 70]]);
  // The stroke starts at x 128, so it copies from 88 px to the left all along.
  assert(near(px(140, 70), grad(52), 6), `the square painted with the source (${px(140, 70)} vs ${grad(52)})`);
  assert(near(px(132, 70), grad(44), 6), 'aligned: the source moves with the brush');
  assert(near(px(140, 61), [16, 64, 255], 4), 'the square outside the brush stays blue');
  assert(Math.abs(ed.cloneMark.x() - 64) < 1.5, `the mark followed the brush (${ed.cloneMark.x()})`);
  ed.undo();
  assert(near(px(140, 70), [16, 64, 255], 4), 'one undo takes the stroke back');
  log('clone stamp: Alt-click source, aligned stroke, undo');

  // ---- spot healing ----
  h.setTool('heal');
  ed.setOptions({ brushSize: 16 });
  assert(near(px(60, 110), [16, 16, 16], 4), 'the spot is there');
  await stroke([[58, 110], [62, 110]]);
  await waitFor(() => (!near(px(60, 110), [16, 16, 16], 30) ? true : null), 'the spot healed', 10000);
  for (const [x, y] of [[60, 110], [57, 108], [63, 112]]) assert(near(px(x, y), grad(x), 8), `healed to its surroundings at (${x}, ${y}): ${px(x, y)} vs ${grad(x)}`);
  assert(near(px(90, 110), grad(90), 1) && near(px(140, 70), [16, 64, 255], 4), 'nothing else changed');
  ed.undo();
  assert(near(px(60, 110), [16, 16, 16], 4), 'one undo brings the spot back');
  log('spot healing: replaced from around, one undo step');
  await workspace.close(tab, { force: true });
}
