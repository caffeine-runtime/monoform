// M64: touchpad and touch in the image editor. A mouse-wheel notch zooms
// about the pointer; a touchpad's two-finger scroll (small, sideways or
// uneven deltas) pans by exactly its deltas without zooming; a pinch (Ctrl +
// wheel) zooms. A brush stroke begun with one finger is dropped when a
// second finger lands (the layer as it was, nothing in the history); spreading
// the two fingers to twice their distance doubles the zoom with the picture
// point under their middle staying under it, and moving both pans; lifting
// them ends the gesture. The canvas takes touch itself (touch-action: none).
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m64(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed: any = await waitFor(() => (tab as any).imageTest?.editor(), 'the image editor', 10000);
  await sleep(200);
  const host: HTMLElement = ed.stage.container();
  assertEq(host.style.touchAction, 'none', 'the canvas handles touch itself');
  const r = host.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const target = () => document.elementFromPoint(cx, cy)!;
  const wheel = (o: { deltaX?: number; deltaY: number; ctrlKey?: boolean; notch?: boolean }) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaX: o.deltaX ?? 0, deltaY: o.deltaY, deltaMode: 0, ctrlKey: !!o.ctrlKey });
    // A mouse notch reports whole 120s; a touchpad doesn't.
    Object.defineProperty(e, 'wheelDeltaY', { value: o.notch ? -120 * Math.sign(o.deltaY) : -Math.round(o.deltaY * 3) });
    target().dispatchEvent(e);
  };

  // ---- wheel: mouse zooms, touchpad pans, pinch zooms ----
  let v = { ...ed.view };
  wheel({ deltaY: -100, notch: true });
  assert(ed.view.zoom > v.zoom * 1.1, `a wheel notch zooms in (${v.zoom} → ${ed.view.zoom})`);
  await sleep(250); // a new gesture
  v = { ...ed.view };
  wheel({ deltaX: 6, deltaY: 14.5 });
  wheel({ deltaY: 20 });
  assertEq(ed.view.zoom, v.zoom, 'two fingers on a touchpad do not zoom');
  assert(Math.abs(ed.view.x - (v.x - 6)) < 0.01 && Math.abs(ed.view.y - (v.y - 34.5)) < 0.01, `they pan by their deltas (${v.x},${v.y} → ${ed.view.x},${ed.view.y})`);
  await sleep(250);
  v = { ...ed.view };
  wheel({ deltaY: -30, ctrlKey: true });
  assert(ed.view.zoom > v.zoom * 1.2, 'a touchpad pinch zooms in');
  ed.fit();
  log('wheel: notch zooms, two-finger scroll pans, pinch zooms');

  // ---- touch: a second finger drops the first finger's stroke, then pinches ----
  ed.setTool('brush');
  const before = ed.composite().toDataURL();
  const versions = ed.state().canUndo;
  const fire = (type: string, x: number, y: number) => {
    const el = document.elementFromPoint(x, y)!;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'up' ? 0 : 1 };
    el.dispatchEvent(new PointerEvent(`pointer${type}`, { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent(`mouse${type}`, o));
  };
  fire('down', cx - 40, cy);
  fire('move', cx - 20, cy + 10);
  assert(ed.composite().toDataURL() !== before, 'the first finger paints');
  // Touches with just what the editor reads (a TouchEvent can't be built everywhere).
  const touch = (type: string, pts: { x: number; y: number }[]) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    const list = pts.map((p) => ({ clientX: p.x, clientY: p.y }));
    Object.defineProperty(e, 'touches', { value: list });
    target().dispatchEvent(e);
    return e;
  };
  const z0 = ed.view.zoom;
  const under = ed.docPoint(cx, cy);
  const e1 = touch('touchstart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
  assert(e1.defaultPrevented, 'the second finger is the editor’s');
  assertEq(ed.composite().toDataURL(), before, 'the stroke is dropped');
  touch('touchmove', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }]);
  assert(Math.abs(ed.view.zoom - Math.min(64, z0 * 2)) < 1e-6, `spreading the fingers doubles the zoom (${z0} → ${ed.view.zoom})`);
  const still = ed.docPoint(cx, cy);
  assert(Math.abs(still.x - under.x) < 0.01 && Math.abs(still.y - under.y) < 0.01, 'about the point under their middle');
  touch('touchmove', [{ x: cx - 60 + 25, y: cy + 15 }, { x: cx + 60 + 25, y: cy + 15 }]);
  const moved = ed.docPoint(cx + 25, cy + 15);
  assert(Math.abs(moved.x - under.x) < 0.01 && Math.abs(moved.y - under.y) < 0.01, 'moving both fingers pans');
  touch('touchend', []);
  fire('up', cx + 25, cy + 15);
  await sleep(50);
  assertEq(ed.composite().toDataURL(), before, 'nothing painted after all');
  assertEq(ed.state().canUndo, versions, 'and nothing in the history');
  assert(!ed.pinch, 'the gesture is over');
  // One finger paints again afterwards.
  fire('down', cx - 40, cy);
  fire('move', cx - 20, cy + 10);
  fire('up', cx - 20, cy + 10);
  await sleep(30);
  assert(ed.composite().toDataURL() !== before && ed.state().canUndo, 'a stroke afterwards paints as usual');
  log('touch: second finger drops the stroke, pinch zooms about the fingers, two fingers pan');
  await workspace.close(tab, { force: true });
}
