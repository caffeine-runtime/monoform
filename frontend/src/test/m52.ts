// M52: watermark and background clean-up on a drawing like a scanned
// schematic (img/watermark.png: black lines on white, a light watermark band
// over them, a closed circle). Image › Remove a watermark opens Adjust ›
// Clean up; Light marks turns the band white and keeps the lines; A colour
// (picked in the image) does the same for that colour. Remove background
// finds the plain white and clears it everywhere (inside the circle too) with
// the lines solid; "keep closed areas" keeps the circle's inside; a coloured
// subject on a plain background stays solid; a busy picture goes to the
// model. The selection brush paints a selection (Alt takes away) whose
// outline is worked out off the main thread.
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import type { ImageEditor } from '../modules/image/editor';
import type { Adjustments } from '../modules/image/adjust';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  removeBackground: (how?: 'auto' | 'plain' | 'ai', everywhere?: boolean | 'auto') => Promise<void>;
  adjust: () => { test: { set: (k: string, v: number | boolean | string) => void; apply: () => void; get: () => Adjustments } } | undefined;
  pickAt: (x: number, y: number) => void;
  tool: () => string;
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

function px(c: HTMLCanvasElement, x: number, y: number): number[] {
  return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

async function open(dir: string, name: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', name)))!;
  const h = await waitFor(() => (hooks(tab)?.editor() ? hooks(tab) : null), `image editor (${name})`);
  return { tab, h, ed: h.editor()! };
}

const lastToast = () => ui.toasts.at(-1)?.message ?? '';

export default async function m52(dir: string) {
  let { tab, h, ed } = await open(dir, 'watermark.png');
  const band = px(ed.composite(), 60, 130);
  assertEq(band.slice(0, 3).join(), '234,234,234', 'the watermark band');
  const crossing = px(ed.composite(), 100, 160)[0];
  assert(crossing < 150, `a line under the band (${crossing})`);

  // ---- Image › Remove a watermark → Adjust › Clean up ----
  const menuItem = (await import('../core/i18n')).t('Remove a watermark…');
  (tab as unknown as { imageTest: { openCleanup?: () => Promise<void> } }).imageTest.openCleanup?.();
  const cleanup = await waitFor(() => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${tab.id}"] .adjust .cleanup`), `${menuItem} shows Clean up`);
  assert(cleanup.textContent!.includes('Light marks') && cleanup.textContent!.includes('A colour'), 'both clean-ups offered');
  const adj = await waitFor(() => h.adjust(), 'adjust panel');

  // Light marks: the band goes white, the lines stay dark (also where they cross it).
  const jank = await measureJank(async () => {
    adj.test.set('lightMarks', 0.3);
    await sleep(100);
    adj.test.apply();
  });
  let c = ed.composite();
  assertEq(px(c, 60, 130).slice(0, 3).join(), '255,255,255', 'band gone');
  assertEq(px(c, 200, 170).slice(0, 3).join(), '255,255,255', 'band gone everywhere');
  assert(px(c, 100, 160)[0] <= crossing, `line under the band kept (${px(c, 100, 160)[0]})`);
  assertEq(px(c, 100, 60).slice(0, 3).join(), '0,0,0', 'line elsewhere untouched');
  log(`light marks removed (longest UI frame ${Math.round(jank.maxGap)} ms)`);
  ed.undo();
  assertEq(px(ed.composite(), 60, 130).slice(0, 3).join(), '234,234,234', 'undo');

  // A colour, picked in the image.
  const pickBtn = cleanup.querySelector<HTMLButtonElement>('button[aria-label="Pick in the image"]')!;
  pickBtn.click();
  await waitFor(() => (h.tool() === 'picker' ? true : null), 'picking');
  h.pickAt(60, 130);
  await waitFor(() => (adj.test.get().markColor ? true : null), 'colour picked');
  assertEq(adj.test.get().markColor, '#eaeaea', 'the band colour');
  assert(h.tool() !== 'picker', 'back to the previous tool');
  adj.test.set('markTolerance', 0.05);
  await sleep(100);
  adj.test.apply();
  c = ed.composite();
  assertEq(px(c, 60, 130).slice(0, 3).join(), '255,255,255', 'that colour removed');
  assert(px(c, 100, 160)[0] < 150, 'other colours kept');
  log('picked colour removed');

  // ---- plain background: everywhere in a drawing ----
  await h.removeBackground();
  c = ed.composite();
  assertEq(px(c, 5, 5)[3], 0, 'background transparent');
  assertEq(px(c, 300, 240)[3], 0, 'inside the circle too');
  assertEq(px(c, 100, 60).join(), '0,0,0,255', 'lines solid');
  assert(px(c, 60, 130)[3] === 0, 'the cleaned band is background now');
  assert(lastToast().includes('also inside closed shapes'), lastToast());
  assertEq(ui.toasts.at(-1)?.action?.label, 'Keep closed areas', 'offers the other way');
  ui.toasts.at(-1)!.action!.run();
  await waitFor(() => (lastToast().includes('around the subject') ? true : null), 'redone keeping closed areas');
  assertEq(px(ed.composite(), 300, 240).join(), '255,255,255,255', 'closed areas kept');
  assertEq(px(ed.composite(), 5, 5)[3], 0, 'outside still transparent');
  log('plain background removed (everywhere, then keeping closed areas)');

  // A coloured subject on a plain background stays solid in its own colour.
  ({ tab, h, ed } = await open(dir, 'subject.png'));
  await h.removeBackground();
  c = ed.composite();
  assertEq(px(c, 395, 295)[3], 0, 'corner transparent');
  assertEq(px(c, 200, 150).join(), '200,30,40,255', 'subject solid, its colour kept');
  // A busy picture: no plain border, the model does it.
  ({ tab, h, ed } = await open(dir, 'big.png'));
  ui.toasts = [];
  await h.removeBackground();
  assert(lastToast().startsWith('Background removed'), `model used (${lastToast()})`);
  log('coloured subject solid; busy picture → model');

  // ---- selection brush ----
  ({ tab, h, ed } = await open(dir, 'watermark.png'));
  ed.setTool('selbrush');
  ed.setOptions({ brushSize: 20 });
  ed.paintSelection([50, 140, 150, 140]);
  let s = ed.state().pixelSelection;
  assert(s && s.x <= 40 && s.width >= 115 && s.height >= 20 && s.height <= 24, `a 20 px stroke (${JSON.stringify(s)})`);
  const sel = ed.selection!;
  await waitFor(() => (sel.edges ? true : null), 'outline worked out');
  ed.paintSelection([300, 140, 300, 170]);
  s = ed.state().pixelSelection;
  assert(s && s.x + s.width >= 305, 'a second stroke adds');
  ed.paintSelection([100, 140], 'subtract');
  const m = ed.selection!.mask.getContext('2d')!;
  assertEq(m.getImageData(100, 140, 1, 1).data[3], 0, 'Alt takes away');
  assert(m.getImageData(60, 140, 1, 1).data[3] > 200, 'the rest stays');
  log('selection brush adds and takes away');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
