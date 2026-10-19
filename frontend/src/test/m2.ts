// M2 acceptance: crop + arrow + blur, save as JPG, reopen — result matches.
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ImageEditor } from '../modules/image/editor';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  writeImage: (p: string) => Promise<boolean>;
  imgMode: () => boolean;
  natural: () => { w: number; h: number };
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

async function openImage(p: string) {
  const tab = (await workspace.openPath(p))!;
  assertEq(tab.moduleId, 'image', 'image module');
  const ed = await waitFor(() => hooks(tab)?.editor(), 'image editor', 10000);
  return { tab, ed };
}

function pixels(c: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  return c.getContext('2d')!.getImageData(x, y, w, h).data;
}

function stats(d: Uint8ClampedArray) {
  let sum = 0;
  let sq = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v;
    sq += v * v;
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

async function decodeFile(p: string): Promise<HTMLCanvasElement> {
  const { fileUrl } = await import('../core/backend');
  const blob = await (await fetch(fileUrl(p))).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c;
}

export default async function m2(dir: string) {
  const src = join(dir, 'img', 'photo.png');
  const { tab, ed } = await openImage(src);
  assertEq(`${ed.width}x${ed.height}`, '400x300', 'decoded size');
  const before = stats(pixels(ed.base, 20, 60, 100, 100));
  assert(before.sd > 100, `stripes are high-contrast (sd ${before.sd.toFixed(1)})`);

  // Crop to x 0..300, y 50..250.
  commands.execute('image.toolCrop');
  await sleep(20);
  ed.setRegion({ x: 0, y: 50, width: 300, height: 200 });
  commands.execute('image.apply');
  await waitFor(() => ed.width === 300 && ed.height === 200, 'crop applied');
  assert(tab.dirty, 'dirty after crop');

  // Arrow on the blue area (right part of the crop).
  ed.color = '#e5484d';
  ed.addArrow(220, 30, 280, 170);
  // Blur the striped area.
  ed.setTool('blur');
  ed.setRegion({ x: 10, y: 10, width: 120, height: 120 });
  const blur = await measureJank(async () => ed.applyRegion());
  log(`blur applied, longest frame ${Math.round(blur.maxGap)} ms`);

  // Undo/redo keep sizes consistent.
  ed.undo();
  assert(stats(pixels(ed.base, 20, 20, 100, 100)).sd > 100, 'undo restores stripes');
  ed.redo();

  const out = join(dir, 'img', 'edited.jpg');
  const saveT = performance.now();
  assert(await hooks(tab).writeImage(out), 'saved as JPG');
  log(`saved JPG in ${Math.round(performance.now() - saveT)} ms`);
  const head = new Uint8Array(await (await fetch((await import('../core/backend')).fileUrl(out))).arrayBuffer()).subarray(0, 3);
  assertEq(Array.from(head).join(','), '255,216,255', 'file is a real JPEG');

  // Reopen and compare.
  const { ed: re } = await openImage(out);
  assertEq(`${re.width}x${re.height}`, '300x200', 'reopened size = crop');
  const exp = ed.composite();
  const got = re.base;
  // Overall difference (JPEG is lossy: small mean error).
  const a = pixels(exp, 0, 0, 300, 200);
  const b = pixels(got, 0, 0, 300, 200);
  let err = 0;
  for (let i = 0; i < a.length; i += 4) err += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  const meanErr = err / (a.length / 4) / 3;
  log(`reopened JPG mean abs error vs editor: ${meanErr.toFixed(2)}`);
  assert(meanErr < 6, 'reopened image matches what was edited');
  const blurred = stats(pixels(got, 20, 20, 100, 100));
  assert(blurred.sd < 25, `blurred area is smooth (sd ${blurred.sd.toFixed(1)})`);
  // Arrow pixels: a point along the arrow shaft is red.
  const mid = pixels(got, 250, 100, 1, 1);
  assert(mid[0] > 180 && mid[1] < 120 && mid[2] < 120, `arrow is red at its midpoint (${Array.from(mid).slice(0, 3)})`);
  // Untouched blue area stays blue.
  const blue = pixels(got, 290, 10, 1, 1);
  assert(blue[2] > 160 && blue[0] < 80, `blue preserved (${Array.from(blue).slice(0, 3)})`);
  await workspace.close(workspace.active!, { force: true });

  // Rotate / flip / resize change dimensions as expected.
  ed.rotate(true);
  assertEq(`${ed.width}x${ed.height}`, '200x300', 'rotate swaps sides');
  ed.flip(true);
  ed.resizeTo(100, 150);
  assertEq(`${ed.width}x${ed.height}`, '100x150', 'resize');
  // Save as PNG, WebP, GIF, BMP all produce decodable files of the right size.
  for (const f of ['png', 'webp', 'gif', 'bmp']) {
    const p = join(dir, 'img', `out.${f}`);
    assert(await hooks(tab).writeImage(p), `saved ${f}`);
    const c = await decodeFile(p);
    assertEq(`${c.width}x${c.height}`, '100x150', `${f} decodes at the right size`);
  }
  assert(!tab.dirty, 'clean after save');
  await workspace.close(tab, { force: true });

  // Folder navigation: next image replaces the tab content.
  const nav = (await workspace.openPath(join(dir, 'img', 'anim.gif')))!;
  await waitFor(() => hooks(nav)?.imgMode() && hooks(nav).natural().w === 2, 'gif shown as <img>');
  commands.execute('image.next');
  await waitFor(() => nav.title !== 'anim.gif', 'navigated');
  log(`next after anim.gif: ${nav.title}`);
  await workspace.close(nav, { force: true });

  // SVG is view-only.
  const svg = (await workspace.openPath(join(dir, 'img', 'vector.svg')))!;
  await waitFor(() => hooks(svg)?.imgMode() && hooks(svg).natural().w > 0, 'svg shown');
  assert(!commands.execute('image.toolCrop'), 'edit tools disabled for SVG');
  assert(!(await workspace.save(svg)), 'SVG save refused');
  await workspace.close(svg, { force: true });
  void api;
}
