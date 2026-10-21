// M38: masks. Video: a new blur covers the whole clip, blur areas can be a
// rectangle, an ellipse or any drawn outline (with points to drag), and can be
// inverted; image overlays can be masked too. Image editor: a layer mask hides
// parts of a layer without erasing them — painted with the brush (hide) and
// eraser (show), filled from a selection, inverted, turned off, kept through
// undo, flips and merges, saved in .ora (other apps get the masked pixels)
// and applied.
import { api, endpoint } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ImageEditor } from '../modules/image/editor';
import { imageControllers } from '../modules/image/editors';
import * as raster from '../modules/image/raster';
import { fromPath, rectPath } from '../modules/image/selection';
import { maskOf, type Layer, type Project, type Pt } from '../modules/video/project';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface VideoHooks {
  loading: () => boolean;
  natural: () => { w: number; h: number };
  el: () => HTMLVideoElement | undefined;
  seek: (t: number) => void;
  setSel: (a: number, b: number) => void;
  fx: () => Project;
  setFx: (p: Project) => void;
  addImageBitmap: (b: ImageBitmap, name: string, at?: { x: number; y: number }) => Promise<void>;
  addBlur: (shape?: 'ellipse' | 'rect' | 'path') => void;
  drawOutline: (l: Layer, outline: Pt[]) => void;
  drawing: () => boolean;
  drawNow: () => Promise<void>;
  fxCanvas: () => HTMLCanvasElement | undefined;
}

function pixel(c: CanvasImageSource, x: number, y: number, w: number, h: number): number[] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.drawImage(c, 0, 0, w, h);
  return [...g.getImageData(x, y, 1, 1).data];
}
const same = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const isRed = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60 && p[3] > 200;

export default async function m38(dir: string) {
  await video(dir);
  await image(dir);
}

async function video(dir: string) {
  const tab = (await workspace.openPath(join(dir, 'video', 'clip.webm')))!;
  const hk = () => (tab as unknown as { videoTest?: VideoHooks }).videoTest;
  await waitFor(() => (hk() && !hk()!.loading() ? true : null), 'clip opened', 15000);
  const h = hk()!;
  await waitFor(() => (h.natural().w === 320 && (h.el()?.readyState ?? 0) >= 2 ? true : null), 'first frame', 8000);
  const dur = h.el()!.duration;

  // ---- a new blur covers the whole clip, not 5 s from the playhead ----
  h.seek(2);
  h.setSel(0, 0); // no selection
  h.addBlur('rect');
  let l = h.fx().layers[0];
  assertEq(l.start, 0, 'blur starts at the beginning');
  assert(Math.abs(l.end - dur) < 0.01, `blur lasts the whole clip (${l.end} of ${dur})`);
  assertEq(maskOf(l).shape, 'rect', 'rectangle blur from the menu');
  assert(!h.drawing(), 'not drawing for a rectangle');

  // Reference frame without effects at 1 s.
  h.setFx({ ...h.fx(), layers: [] });
  h.seek(1);
  await waitFor(() => (h.el()!.seeking ? null : true), 'seeked', 3000);
  h.addBlur('rect');
  l = h.fx().layers[0];
  const cv = h.fxCanvas()!;
  const plain = { ...l, blur: { ...l.blur!, kind: 'pixelate' as const, amount: 30, feather: 0 }, w: 2, h: 2, keys: [{ ...l.keys[0], x: -50, y: -50 }] };
  h.setFx({ ...h.fx(), layers: [plain] });
  await h.drawNow();
  const probes: [number, number][] = [
    [150, 65], // inside the box of the triangle below, outside the triangle
    [158, 35], // inside the triangle
    [100, 120], // far outside
  ];
  const base = probes.map(([x, y]) => pixel(cv, x, y, 320, 180));
  log(`base: ${base.map((p) => p.slice(0, 3).join(',')).join(' | ')}`);

  // ---- freeform: a triangle drawn over the picture becomes the area ----
  h.setFx({ ...h.fx(), layers: [{ ...plain, w: 100, h: 60, keys: [{ ...plain.keys[0], x: 160, y: 90 }] }] });
  h.addBlur('path');
  assert(h.drawing(), 'drawing starts for "Draw any shape"');
  const free = h.fx().layers[1];
  h.setFx({ ...h.fx(), layers: [{ ...free, blur: { ...free.blur!, kind: 'pixelate', amount: 30, feather: 0 } }] });
  const tri: Pt[] = [];
  const corners: Pt[] = [[120, 30], [200, 30], [160, 70]];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 20; k++) tri.push([corners[i][0] + ((corners[(i + 1) % 3][0] - corners[i][0]) * k) / 20, corners[i][1] + ((corners[(i + 1) % 3][1] - corners[i][1]) * k) / 20]);
  h.drawOutline(h.fx().layers[0], tri);
  l = h.fx().layers[0];
  const m = maskOf(l);
  assertEq(m.shape, 'path', 'freeform area');
  assertEq(m.points!.length, 3, `drawn outline simplified to its corners (${JSON.stringify(m.points)})`);
  assertEq(`${l.w}x${l.h} @ ${l.keys[0].x},${l.keys[0].y}`, '80x40 @ 160,50', 'box fits the drawing');
  await h.drawNow();
  let now = probes.map(([x, y]) => pixel(cv, x, y, 320, 180));
  log(`triangle: ${now.map((p) => p.slice(0, 3).join(',')).join(' | ')}`);
  assert(same(now[0], base[0]), 'outside the outline (but inside its box) untouched');
  assert(!same(now[1], base[1]), 'inside the outline pixelated');
  assert(same(now[2], base[2]), 'far outside untouched');
  // Points on the stage, one per corner.
  await sleep(50);
  assertEq(document.querySelectorAll('.tabview.active .fx-stage .box.sel .pt').length, 3, 'a handle per point');

  // ---- inverted: everything but the outline ----
  h.setFx({ ...h.fx(), layers: [{ ...l, blur: { ...l.blur!, invert: true } }] });
  await h.drawNow();
  now = probes.map(([x, y]) => pixel(cv, x, y, 320, 180));
  assert(!same(now[0], base[0]), 'inverted: outside the outline pixelated');
  assert(same(now[1], base[1]), 'inverted: inside the outline untouched');

  // ---- image overlay with an ellipse mask, then cut out ----
  const red = document.createElement('canvas');
  red.width = red.height = 40;
  const rg = red.getContext('2d')!;
  rg.fillStyle = '#ff0000';
  rg.fillRect(0, 0, 40, 40);
  h.setFx({ ...h.fx(), layers: [] });
  await h.addImageBitmap(await createImageBitmap(red), 'Red', { x: 100, y: 120 });
  const img = h.fx().layers[0];
  h.setFx({ ...h.fx(), layers: [{ ...img, mask: { shape: 'ellipse', feather: 0, invert: false } }] });
  await h.drawNow();
  assert(isRed(pixel(cv, 100, 120, 320, 180)), 'masked overlay: centre shown');
  assert(!isRed(pixel(cv, 83, 103, 320, 180)), 'masked overlay: corner hidden by the ellipse (the green video shows)');
  h.setFx({ ...h.fx(), layers: [{ ...img, mask: { shape: 'ellipse', feather: 0, invert: true } }] });
  await h.drawNow();
  assert(!isRed(pixel(cv, 100, 120, 320, 180)) && isRed(pixel(cv, 83, 103, 320, 180)), 'cut out: centre hidden, corner shown');
  await workspace.close(tab, { force: true });
}

async function image(dir: string) {
  const tab: Tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  const it = () => (tab as unknown as { imageTest?: { editor: () => ImageEditor | null; writeImage: (p: string) => Promise<boolean> } }).imageTest;
  const E = await waitFor(() => it()?.editor() ?? null, 'image editor');
  const W = E.width;
  const H = E.height;
  const at = (x: number, y: number) => pixel(E.composite(), x, y, W, H);
  // A red layer over the photo; (300, 150) is blue underneath, (100, 150) black or white.
  const fill = raster.makeCanvas(W, H);
  const fg = fill.getContext('2d')!;
  fg.fillStyle = '#ff0000';
  fg.fillRect(0, 0, W, H);
  const id = E.addLayer('Red', fill);
  const under = pixel(E.layerCanvas(E.state().layers[0].id)!, 300, 150, W, H);
  assert(isRed(at(300, 150)), 'red layer on top');

  E.setOptions({ brushSize: 40 });
  let tp = performance.now();
  E.paint([{ x: 260, y: 250 }, { x: 340, y: 250 }]);
  const plainMs = performance.now() - tp;
  tp = performance.now();
  E.paint([{ x: 260, y: 260 }, { x: 340, y: 260 }]);
  log(`plain strokes: ${Math.round(plainMs)} ms, ${Math.round(performance.now() - tp)} ms`);
  E.undo();
  E.undo();
  // ---- add a mask; the brush hides, the eraser shows ----
  E.addMask('show');
  let s = E.state();
  assert(s.editMask && s.layers.find((l) => l.id === id)!.mask, 'mask added and being painted');
  assert(isRed(at(300, 150)), 'a new mask shows everything');
  E.setOptions({ brushSize: 40 });
  const t0 = performance.now();
  const jank = await measureJank(async () => E.paint([{ x: 260, y: 150 }, { x: 340, y: 150 }]));
  log(`mask stroke ${Math.round(performance.now() - t0)} ms, longest UI frame ${Math.round(jank.maxGap)} ms`);
  tp = performance.now();
  E.paint([{ x: 260, y: 200 }, { x: 340, y: 200 }]);
  log(`second mask stroke ${Math.round(performance.now() - tp)} ms`);
  E.undo();
  assert(same(at(300, 150), under), `painted area hidden: the photo shows through (${at(300, 150)})`);
  assert(isRed(at(300, 100)), 'outside the stroke still red');
  assert(isRed(pixel(E.layerCanvas(id)!, 300, 150, W, H)), "the layer's own pixels are untouched");
  E.paint([{ x: 300, y: 150 }], true);
  assert(isRed(at(300, 150)), 'eraser on the mask shows again');
  E.undo();
  assert(same(at(300, 150), under), 'undo brings the hidden area back');
  // X swaps: the brush shows.
  E.setMaskHide(false);
  E.paint([{ x: 300, y: 150 }]);
  assert(isRed(at(300, 150)), 'brush set to show');
  E.setMaskHide(true);

  // ---- from a selection, inverted, off/on ----
  const r = { x: 20, y: 20, width: 60, height: 60 };
  E.setPixelSelection(fromPath(rectPath(r), r, W, H));
  E.fillMask(false);
  assert(!isRed(at(50, 50)) && isRed(at(150, 50)), 'selection hidden on the mask');
  E.invertMask();
  assert(isRed(at(50, 50)) && !isRed(at(150, 50)), 'inverted mask');
  E.deselect();
  E.toggleMask(false);
  assert(isRed(at(150, 50)) && isRed(at(50, 50)), 'mask off: all of the layer shows');
  E.toggleMask(true);
  assert(!isRed(at(150, 50)), 'mask on again');
  E.invertMask(); // back to: only the 60×60 square hidden

  // ---- painting on the pixels keeps the mask ----
  E.setEditMask(false);
  E.setOptions({ color: '#00ff00', brushSize: 20 });
  E.paint([{ x: 50, y: 50 }, { x: 150, y: 50 }]);
  assert(same(at(50, 50), pixel(E.layerCanvas(E.state().layers[0].id)!, 50, 50, W, H)), 'pixels painted under the hidden part stay hidden');
  assert(pixel(E.layerCanvas(id)!, 50, 50, W, H)[1] > 200, '(but they are painted)');
  assert(at(150, 50)[1] > 200, 'pixels painted where the mask shows are seen');

  // ---- document flip moves the mask with the pixels ----
  E.flip(true);
  const photo = () => E.layerCanvas(E.state().layers[0].id)!;
  assert(same(at(W - 50, 50), pixel(photo(), W - 50, 50, W, H)), 'the hidden square moved to the other side with the layer');
  assert(isRed(at(50, 50)), 'and the old place shows the layer');
  E.flip(true);

  // ---- the layers panel shows the mask ----
  imageControllers.get(tab.id)!.panel('layers');
  await sleep(50);
  assert(document.querySelector('.tabview.active .layer .thumb.mask'), 'mask thumbnail in the layers panel');

  // ---- .ora keeps it editable; other apps see the masked pixels ----
  const ora = join(dir, 'img', 'out', 'masked.ora');
  await api.CreateFolder(join(dir, 'img', 'out')).catch(() => {});
  assert(await it()!.writeImage(ora), 'saved as .ora');
  const before = E.composite();
  const r2 = await fetch(endpoint('zip', { path: ora, entry: 'data/layer1.png' }));
  const png = await createImageBitmap(await r2.blob());
  assert(pixel(png, 50, 50, W, H)[3] < 10, 'layer PNG for other apps has the hidden part transparent');
  await workspace.close(tab, { force: true });
  const t2 = (await workspace.openPath(ora))!;
  const E2 = await waitFor(() => (t2 as unknown as { imageTest?: { editor: () => ImageEditor | null } }).imageTest?.editor() ?? null, 'reopened .ora');
  await waitFor(() => (E2.state().layers.length === 2 ? true : null), 'two layers', 5000);
  const top = E2.state().layers[1];
  assert(top.mask && top.maskOn, 'mask came back');
  assert(pixel(E2.layerCanvas(top.id)!, 50, 50, W, H)[1] > 200, 'with the unmasked (green-painted) pixels under it');
  for (const [x, y] of [[50, 50], [150, 50], [300, 150]] as const) assert(same(pixel(E2.composite(), x, y, W, H), pixel(before, x, y, W, H)), `reopened looks the same at ${x},${y}`);

  // ---- merge down keeps the look and drops the mask; apply erases ----
  E2.setActive(top.id);
  E2.applyMask();
  s = E2.state();
  assert(!s.layers[1].mask && pixel(E2.layerCanvas(top.id)!, 50, 50, W, H)[3] < 10, 'applied: hidden pixels erased, mask gone');
  E2.undo();
  assert(E2.state().layers[1].mask, 'undo brings the mask back');
  const look = pixel(E2.composite(), 50, 50, W, H);
  E2.mergeDown();
  assertEq(E2.state().layers.length, 1, 'merged');
  assert(!E2.state().layers[0].mask && same(pixel(E2.composite(), 50, 50, W, H), look), 'merge keeps the masked look');
  await workspace.close(t2, { force: true });
}
