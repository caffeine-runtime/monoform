// M73: the History panel. After a new layer, a brush stroke, a flip and a
// layer opacity change, the panel (from its toolbar button) lists Opened,
// New layer, Brush, Flip horizontally, Layer opacity, the last one current.
// Clicking "New layer" goes back three steps at once (the later ones shown
// as undone); clicking "Flip horizontally" goes forward again; Undo moves the
// current step too. Doing something new drops the undone steps.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m73(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  const white = document.createElement('canvas');
  white.width = 100;
  white.height = 80;
  white.getContext('2d')!.fillStyle = '#fff';
  white.getContext('2d')!.fillRect(0, 0, 100, 80);
  ed.load(white);
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;

  const id = ed.addLayer('Ink');
  ed.setOptions({ color: '#000000', brushSize: 6, brushOpacity: 1 });
  ed.paint([
    { x: 10, y: 40 },
    { x: 30, y: 40 },
  ]);
  ed.flip(true);
  ed.setLayerProps(ed.state().layers[1].id, { opacity: 0.5 });
  await sleep(30);
  const inkAt = (x: number) => ed.composite().getContext('2d')!.getImageData(x, 40, 1, 1).data[0] < 200;

  // ---- the panel ----
  const btn = Array.from(root().querySelectorAll<HTMLButtonElement>('.icon-btn')).find((b) => b.title.startsWith('History'))!;
  assert(btn, 'a History button in the tool bar');
  btn.click();
  const steps = () => Array.from(root().querySelectorAll<HTMLButtonElement>('.history .step'));
  await waitFor(() => (steps().length ? true : null), 'the History panel');
  const names = () => steps().map((b) => b.querySelector('.name')!.textContent);
  assertEq(names().join(' | '), 'Opened | New layer | Brush | Flip horizontally | Layer opacity', 'every step listed by what it did');
  assert(steps()[4].classList.contains('current'), 'the last one current');
  assert(inkAt(80) && !inkAt(20), 'flipped ink on the right');
  log('steps listed');

  // ---- back three steps at once ----
  steps()[1].click();
  await sleep(30);
  assertEq(ed.state().step, 1, 'at "New layer"');
  assert(steps()[1].classList.contains('current') && steps()[2].classList.contains('future') && steps()[4].classList.contains('future'), 'the later steps shown as undone');
  assertEq(ed.state().layers.length, 2, 'the new layer is there');
  assert(!inkAt(80) && !inkAt(20), 'no ink yet');
  assertEq(ed.state().layers.find((l: { id: string }) => l.id === id)?.opacity, 1, 'full opacity');

  // ---- forward two ----
  steps()[3].click();
  await sleep(30);
  assert(inkAt(80) && !inkAt(20), 'forward to the flip: the ink is back, flipped');
  assertEq(ed.state().layers[1].opacity, 1, 'but not the opacity yet');
  ed.undo();
  await sleep(30);
  assert(steps()[2].classList.contains('current'), 'Undo moves the current step');
  assert(inkAt(20) && !inkAt(80), 'unflipped');
  log('back and forward several steps at once; Undo follows');

  // ---- something new drops the undone steps ----
  ed.addLayer('Second');
  await sleep(30);
  assertEq(names().join(' | '), 'Opened | New layer | Brush | New layer', 'the undone steps gone, the new one last');
  assert(steps()[3].classList.contains('current'), 'and current');
  steps()[0].click();
  await sleep(30);
  assertEq(ed.state().layers.length, 1, '"Opened": as it was opened');
  log('a new step drops the undone ones; back to the start');
  await workspace.close(tab, { force: true });
}
