// M65: pixelate and blur with their own settings. The Adjust panel is a
// short list of pages (Light, Colour, Detail, Blur, Pixelate, Effects, Clean
// up) with no sliders of its own. On a 200 × 160 picture whose colour
// changes with every pixel, a selection's Pixelate button opens Adjust ›
// Pixelate with a block size already set (a preview), Back shows the list
// with Pixelate marked as changed, and Apply leaves few colours along a row
// inside the selection and the outside untouched. The Blur button opens the
// Blur page with a radius set. The Pixelate region tool shows its block size
// in the tool bar and the pixelated area over the picture before it is
// applied; changing the size changes the preview, and applying gives what it
// showed. The Blur region tool's strength works the same way.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { fromPath, rectPath } from '../modules/image/selection';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const data = (c: HTMLCanvasElement | HTMLImageElement, r?: { x: number; y: number; width: number; height: number }) => {
  const w = r?.width ?? c.width;
  const h = r?.height ?? c.height;
  const k = document.createElement('canvas');
  k.width = w;
  k.height = h;
  k.getContext('2d')!.drawImage(c, -(r?.x ?? 0), -(r?.y ?? 0));
  return k.getContext('2d')!.getImageData(0, 0, w, h).data;
};
const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

export default async function m65(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  const ed = h.editor();
  await sleep(200);
  const pic = document.createElement('canvas');
  pic.width = 200;
  pic.height = 160;
  const g = pic.getContext('2d')!;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 200; x++) {
    g.fillStyle = `rgb(${x},${y},${(x * 7 + y * 3) % 256})`;
    g.fillRect(x, y, 1, 1);
  }
  ed.load(pic);
  ed.setTool('select');
  await sleep(50);
  const root = () => document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;

  // ---- the Adjust list ----
  h.setPanel('adjust');
  const pages = await waitFor(() => {
    const l = root().querySelectorAll<HTMLButtonElement>('.adjust .page');
    return l.length ? l : null;
  }, 'the Adjust list');
  assertEq(Array.from(pages).map((p) => p.dataset.page).join(','), 'light,colour,detail,blur,pixelate,effects,cleanup', 'one entry per kind of adjustment');
  assertEq(root().querySelectorAll('.adjust input[type=range]').length, 0, 'no sliders in the list itself');

  // ---- Pixelate from the selection bar ----
  const sel = { x: 40, y: 40, width: 80, height: 60 };
  ed.setPixelSelection(fromPath(rectPath(sel), sel, 200, 160));
  const button = (start: string) => waitFor(() => Array.from(root().querySelectorAll<HTMLButtonElement>('.selbar button')).find((b) => b.title.startsWith(start)) ?? null, `the selection bar's ${start}`);
  (await button('Pixelate the selection')).click();
  await waitFor(() => (h.adjust()?.test.page() === 'pixelate' ? true : null), 'Adjust › Pixelate opens');
  assertEq(h.adjust().test.get().pixelate, 6, 'with a block size set');
  await waitFor(() => (ed.state().adjusting ? true : null), 'previewed');
  const rows = root().querySelectorAll('.adjust .row');
  assertEq(rows.length, 1, 'only its own control on the page');
  assert(rows[0].textContent!.includes('Block size'), 'the block size');
  root().querySelector<HTMLButtonElement>('.adjust .back')!.click();
  await sleep(30);
  assert(root().querySelector('.adjust .page[data-page="pixelate"] .dot'), 'back in the list, Pixelate marked as changed');
  assert(!root().querySelector('.adjust .page[data-page="light"] .dot'), 'Light not');
  h.adjust().test.apply();
  await sleep(50);
  const after = data(ed.composite());
  const colours = new Set<number>();
  for (let x = sel.x; x < sel.x + sel.width; x++) colours.add(after[(70 * 200 + x) * 4]);
  assert(colours.size <= 16, `pixelated: ${colours.size} colours along 80 pixels of a row`);
  const at = (x: number, y: number) => Array.from(after.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)).join();
  assertEq(at(10, 10), `10,10,${(70 + 30) % 256}`, 'outside the selection untouched');
  assertEq(at(150, 120), `150,120,${(1050 + 360) % 256}`, 'there too');
  ed.undo();
  log(`Adjust › Pixelate from the selection bar (${colours.size} colours left in a row)`);

  // ---- Blur from the selection bar ----
  (await button('Blur the selection')).click();
  await waitFor(() => (h.adjust()?.test.page() === 'blur' ? true : null), 'Adjust › Blur opens');
  assertEq(h.adjust().test.get().blur, 8, 'with a radius set');
  assert(root().querySelectorAll('.adjust .toggles .chip').length === 7, 'its seven kinds');
  h.adjust().test.reset();
  h.adjust().test.open(null);
  ed.deselect();
  h.setPanel(null);

  // ---- the Pixelate region tool ----
  h.setTool('pixelate');
  await sleep(30);
  const slider = await waitFor(() => root().querySelector<HTMLInputElement>('input.region-strength'), 'block size in the tool bar');
  assertEq(slider.value, '6', 'automatic size shown');
  const area = { x: 20, y: 20, width: 60, height: 40 };
  ed.setRegion(area);
  const preview = await waitFor(() => (ed.regionPreview.visible() ? ed.regionPreview : null), 'the area previewed');
  assertEq(`${preview.width()}×${preview.height()}`, '60×40', 'over the area');
  const p6 = data(preview.image());
  slider.value = '10';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => (maxDiff(data(ed.regionPreview.image()), p6) > 0 ? true : null), 'a new size changes the preview');
  const p10 = data(ed.regionPreview.image());
  assertEq(p10[0], p10[9 * 4], 'blocks of 10: the first ten pixels alike');
  assert(p10[0] !== p10[10 * 4], 'the eleventh not');
  ed.applyRegion();
  await sleep(50);
  const d1 = maxDiff(data(ed.composite(), area), p10);
  assert(d1 <= 2, `applied as previewed (max difference ${d1})`);
  assert(!ed.regionPreview.visible(), 'preview gone');
  ed.undo();
  log('Pixelate region: block size in the tool bar, previewed in the area, applied as shown');

  // ---- the Blur region tool ----
  h.setTool('blur');
  await sleep(30);
  const strength = await waitFor(() => root().querySelector<HTMLInputElement>('input.region-strength'), 'strength in the tool bar');
  ed.setRegion(area);
  await waitFor(() => (ed.regionPreview.visible() ? true : null), 'the blur previewed');
  const b1 = data(ed.regionPreview.image());
  assert(maxDiff(b1, data(pic, area)) > 10, 'the preview is blurred');
  strength.value = '2.5';
  strength.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => (maxDiff(data(ed.regionPreview.image()), b1) > 0 ? true : null), 'stronger blur previewed');
  const b2 = data(ed.regionPreview.image());
  ed.applyRegion();
  await sleep(50);
  const d2 = maxDiff(data(ed.composite(), area), b2);
  assert(d2 <= 2, `blur applied as previewed (max difference ${d2})`);
  ed.setOptions({ regionBlur: 1, pixelSize: 0 });
  log('Blur region: strength in the tool bar, previewed, applied as shown');
  await workspace.close(tab, { force: true });
}
