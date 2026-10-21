// M44: the SVG editor on a CAD drawing (layers, dashed centre lines, a
// 1400-point polyline, text). Opening builds the drawing once — the build
// effect used to re-run itself ~1000 times (half a minute frozen on a real
// CAD file, and again after every edit) — with "Opening the drawing…" shown
// until it is on screen. Zooming scales what is drawn and lays it out at
// the new size once the zoom rests; panning and an edit (one rebuild) stay
// within a frame budget; closing is quick. UI frames are logged.
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type Hooks = {
  design: () => { ready: () => boolean; fit: () => void; test: { builds: () => number; rootEl: () => SVGSVGElement | null; pv: () => { zoom: number } } } | undefined;
  select: (i: number | null) => void;
  designOp: (op: string) => void;
  els: () => unknown[];
};

function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, altKey: true }));
}

export default async function m44(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  let tab: Tab | undefined;
  let sawLoading = false;
  const t0 = performance.now();
  const open = await measureJank(async () => {
    tab = (await workspace.openPath(join(dir, 'img', 'cad-drawing.svg')))!;
    const h = await waitFor(() => (tab as unknown as { svgTest?: Hooks }).svgTest, 'svg editor');
    await waitFor(() => {
      sawLoading ||= !!document.querySelector('.design .loading');
      return h.design()?.ready() ? true : null;
    }, 'drawing on screen', 30000);
  });
  const ms = Math.round(performance.now() - t0);
  const h = (tab as unknown as { svgTest: Hooks }).svgTest;
  const d = h.design()!;
  log(`CAD drawing (${h.els().length} elements) on screen in ${ms} ms, longest UI frame ${Math.round(open.maxGap)} ms`);
  assertEq(d.test.builds(), 1, 'built once on open');
  assert(sawLoading, '"Opening the drawing…" shown until it is on screen');
  assert(!document.querySelector('.design .loading'), 'and gone after');
  await sleep(300);
  assertEq(d.test.builds(), 1, 'and not again by itself');

  const host = document.querySelector<HTMLElement>('.design .canvas')!;
  const r = host.getBoundingClientRect();
  const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
  // Zoom: scaled while the wheel turns, laid out at the new size after.
  const root = d.test.rootEl()!;
  const w0 = root.getBoundingClientRect().width;
  const zoom = await measureJank(async () => {
    for (let i = 0; i < 10; i++) {
      host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: -60 }));
      await new Promise((res) => requestAnimationFrame(res));
    }
  });
  assert(root.style.transform.includes('scale'), 'zooming scales the drawn picture');
  await waitFor(() => (root.style.transform === '' ? true : null), 'laid out at the new size when the zoom rests', 2000);
  const w1 = root.getBoundingClientRect().width;
  assert(Math.abs(parseFloat(root.style.width) - w1) < 2 && w1 > w0 * 1.5, `zoomed in (${Math.round(w0)} → ${Math.round(w1)} px)`);
  assertEq(d.test.builds(), 1, 'zooming rebuilds nothing');
  // Pan.
  const pan = await measureJank(async () => {
    pointer(host, 'pointerdown', cx, cy);
    for (let i = 0; i < 20; i++) {
      pointer(host, 'pointermove', cx + i * 5, cy + i * 3);
      await new Promise((res) => requestAnimationFrame(res));
    }
    pointer(host, 'pointerup', cx + 100, cy + 60);
  });
  d.fit();
  await sleep(300);
  // One edit, one rebuild.
  h.select(10);
  await sleep(100);
  const edit = await measureJank(async () => {
    h.designOp('nudge:1,0');
    await sleep(300);
  });
  assertEq(d.test.builds(), 2, 'an edit rebuilds once');
  const t1 = performance.now();
  const close = await measureJank(async () => {
    await workspace.close(tab!, { force: true });
  });
  log(`longest UI frame: zoom ${Math.round(zoom.maxGap)} ms, pan ${Math.round(pan.maxGap)} ms, edit ${Math.round(edit.maxGap)} ms, close ${Math.round(close.maxGap)} ms (${Math.round(performance.now() - t1)} ms)`);
}
