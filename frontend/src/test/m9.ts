// M9: image editor v2 — layers, transparency, selections + clipboard, magic
// wand, free rotation, fonts, adjustments, background removal, object
// selection, save a copy, layered .ora round trip.
import { api, fileUrl } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ImageEditor } from '../modules/image/editor';
import * as selection from '../modules/image/selection';
import { rotatedSize } from '../modules/image/raster';
import { settings } from '../core/settings.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  writeImage: (p: string) => Promise<boolean>;
  wandAt: (x: number, y: number, mode: string) => Promise<void>;
  objectAt: (x: number, y: number, mode: string) => Promise<void>;
  removeBackground: (how?: 'auto' | 'plain' | 'ai') => Promise<void>;
  copy: (cut?: boolean, merged?: boolean) => void;
  paste: () => Promise<void>;
  saveCopy: () => Promise<boolean>;
  adjust: () => { test: { set: (k: string, v: number | boolean) => void; setBlurType: (t: string) => void; apply: () => void; reset: () => void } } | undefined;
  setPanel: (p: 'layers' | 'adjust' | null) => void;
  fonts: () => string[];
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

function px(c: HTMLCanvasElement, x: number, y: number): number[] {
  return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

async function decodeFile(p: string): Promise<HTMLCanvasElement> {
  const blob = await (await fetch(fileUrl(p))).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export default async function m9(dir: string) {
  const I = join(dir, 'img');
  const src = join(I, 'subject.png');
  const before = await api.Stat(src);
  const tab = (await workspace.openPath(src))!;
  const h = await waitFor(() => (hooks(tab)?.editor() ? hooks(tab) : null), 'image editor');
  const ed = h.editor()!;
  assertEq(`${ed.width}x${ed.height}`, '400x300', 'size');

  // ---- layers ----
  ed.addLayer('Paint');
  assertEq(ed.state().layers.length, 2, 'two layers');
  ed.setOptions({ color: '#00ff00', brushSize: 20, brushOpacity: 1 });
  ed.paint([{ x: 300, y: 250 }, { x: 380, y: 250 }]);
  assert(px(ed.composite(), 340, 250)[1] > 200, 'brush stroke visible in composite');
  assert(px(ed.layerCanvas(ed.state().activeId)!, 20, 290)[3] === 0, 'new layer is transparent');
  const paintId = ed.state().activeId;
  ed.setLayerProps(paintId, { visible: false });
  assert(px(ed.composite(), 340, 250)[1] < 240 && px(ed.composite(), 340, 250)[0] > 200, 'hidden layer not in composite');
  ed.setLayerProps(paintId, { visible: true, opacity: 0.5 });
  const half = px(ed.composite(), 340, 250);
  assert(half[1] > 120 && half[1] < 250 && half[0] > 80, `half-opacity blend (${half})`);
  ed.setLayerProps(paintId, { opacity: 1 });
  ed.duplicateLayer();
  assertEq(ed.state().layers.length, 3, 'duplicate');
  ed.deleteLayer();
  ed.moveLayer(paintId, -1);
  assertEq(ed.state().layers[0].id, paintId, 'moved below background');
  ed.moveLayer(paintId, 1);
  ed.mergeDown(paintId);
  assertEq(ed.state().layers.length, 1, 'merged down');
  assert(px(ed.composite(), 340, 250)[1] > 200, 'stroke kept after merge');
  ed.undo();
  assertEq(ed.state().layers.length, 2, 'undo merge');
  ed.redo();

  // ---- transparency: eraser, then PNG keeps alpha ----
  ed.paint([{ x: 10, y: 150 }, { x: 60, y: 150 }], true);
  assertEq(px(ed.composite(), 30, 150)[3], 0, 'eraser makes pixels transparent');
  const pngOut = join(I, 'out', 'alpha.png');
  await api.CreateFolder(join(I, 'out')).catch(() => {});
  assert(await h.writeImage(pngOut), 'saved PNG');
  const back = await decodeFile(pngOut);
  assertEq(px(back, 30, 150)[3], 0, 'PNG kept transparency');
  assertEq(px(back, 200, 150)[3], 255, 'opaque elsewhere');

  // ---- rectangle selection, copy/paste as layer, delete pixels ----
  const r = { x: 140, y: 90, width: 120, height: 120 };
  ed.setPixelSelection(selection.fromPath(selection.rectPath(r), r, ed.width, ed.height));
  const copied = ed.copySelection();
  assertEq(`${copied.canvas.width}x${copied.canvas.height}@${copied.x},${copied.y}`, '120x120@140,90', 'copy crops to the selection');
  h.copy();
  await h.paste();
  await waitFor(() => (ed.state().layers.length === 2 ? true : null), 'pasted layer');
  const pasted = ed.state().layers[1];
  assertEq(pasted.name, 'subject (part)', 'pasted layer named after where it was copied from');
  ed.setActive(ed.state().layers[0].id);
  ed.setPixelSelection(selection.fromPath(selection.rectPath(r), r, ed.width, ed.height));
  ed.clearSelectionPixels();
  assertEq(px(ed.layerCanvas(ed.state().activeId)!, 200, 150)[3], 0, 'delete clears selected pixels');
  assert(px(ed.composite(), 200, 150)[0] > 150, 'pasted copy covers the hole');
  ed.deselect();
  ed.undo(); // restore the hole
  ed.undo(); // remove pasted layer
  ed.deselect();
  assertEq(ed.state().layers.length, 1, 'back to one layer');

  // ---- magic wand on the red disc ----
  await h.wandAt(200, 150, 'replace');
  const wb = ed.state().pixelSelection!;
  assert(near(wb.x, 120, 2) && near(wb.y, 70, 2) && near(wb.width, 161, 3) && near(wb.height, 161, 3), `wand bounds ${JSON.stringify(wb)}`);
  await h.wandAt(50, 50, 'add');
  assert(ed.state().pixelSelection!.x <= 20, 'shift-add the blue square');
  ed.deselect();

  // ---- text with a chosen font ----
  const fonts = h.fonts();
  assert(fonts.includes('Inter Variable') && fonts.includes('Source Serif 4 Variable'), `bundled fonts listed (${fonts.length} total)`);
  ed.setOptions({ fontFamily: 'Source Serif 4 Variable', fontSize: 40, color: '#ffffff' });
  const text = await ed.addText({ x: 30, y: 230 }, 'Hello');
  assert(text, 'text added');
  assertEq(ed.state().layers[0].objects, 1, 'text object on the layer');

  // ---- adjustments: saturation −100 makes the disc gray ----
  h.setPanel('adjust');
  const adj = await waitFor(() => h.adjust(), 'adjust panel');
  const jank = await measureJank(async () => {
    adj.test.set('saturation', -1);
    await sleep(100);
    adj.test.apply();
    await sleep(50);
  });
  const gray = px(ed.composite(), 200, 150);
  assert(Math.abs(gray[0] - gray[1]) < 8 && Math.abs(gray[1] - gray[2]) < 8, `desaturated (${gray})`);
  log(`adjust preview+apply longest frame ${Math.round(jank.maxGap)} ms`);
  ed.undo();
  assert(px(ed.composite(), 200, 150)[0] > 150, 'undo adjustment');

  // ---- kinds of blur, limited to a selection ----
  const blurArea = { x: 100, y: 50, width: 120, height: 200 }; // covers the disc's left edge only
  ed.setPixelSelection(selection.fromPath(selection.rectPath(blurArea), blurArea, ed.width, ed.height));
  const orig = ed.composite();
  const changedAt = (c: HTMLCanvasElement, x: number, y: number) => px(c, x, y).some((v, i) => Math.abs(v - px(orig, x, y)[i]) > 20);
  const kinds: [string, Record<string, number>, boolean][] = [
    ['gaussian', {}, true],
    ['motion', { blurAngle: 0 }, true],
    ['zoom', {}, true],
    ['spin', { blurX: 0.2 }, true],
    ['lens', {}, true],
    ['tiltshift', { blurY: 0 }, true],
    ['surface', {}, false], // keeps hard edges
    ['frosted', {}, true],
  ];
  for (const [kind, extra, blurs] of kinds) {
    adj.test.setBlurType(kind);
    for (const [k, v] of Object.entries(extra)) adj.test.set(k, v);
    const bj = await measureJank(async () => {
      adj.test.set('blur', 40);
      await sleep(80);
      adj.test.apply();
      await sleep(30);
    });
    const out = ed.composite();
    const edge = changedAt(out, 121, 150) || changedAt(out, 118, 150);
    assertEq(edge, blurs, `${kind} blur ${blurs ? 'softens' : 'keeps'} the disc edge inside the selection`);
    assert(!changedAt(out, 279, 150) && !changedAt(out, 221, 150), `${kind} blur stays inside the selection`);
    if (kind === 'frosted') {
      // Grainy, not smooth: across the disc's edge the red channel jumps up and down.
      let turns = 0;
      for (let x = 106, d0 = 0; x < 136; x++) {
        const d = Math.sign(px(out, x + 1, 150)[0] - px(out, x, 150)[0]);
        if (d && d0 && d !== d0) turns++;
        if (d) d0 = d;
      }
      assert(turns >= 4, `frosted glass is grainy across the edge (${turns} turns)`);
    }
    log(`${kind} blur longest frame ${Math.round(bj.maxGap)} ms`);
    ed.undo();
    adj.test.reset();
  }
  // Painting inside a selection never leaks out of it.
  ed.setOptions({ color: '#00ff00', brushSize: 16, brushOpacity: 1 });
  ed.paint([{ x: 40, y: 100 }, { x: 180, y: 100 }]);
  assert(px(ed.composite(), 150, 100)[1] > 200, 'brush paints inside the selection');
  assert(!changedAt(ed.composite(), 60, 100), 'brush does not paint outside the selection');
  ed.undo();
  ed.deselect();
  h.setPanel('layers');

  // ---- background removal ----
  let t0 = performance.now();
  const bgJank = await measureJank(() => h.removeBackground('ai'));
  const rb = ed.composite();
  const corner = px(rb, 395, 295)[3];
  const centre = px(rb, 200, 150)[3];
  log(`remove background ${Math.round(performance.now() - t0)} ms (longest UI frame ${Math.round(bgJank.maxGap)} ms): corner alpha ${corner}, disc alpha ${centre}`);
  assert(corner < 40 && centre > 200, 'background transparent, subject kept');
  ed.undo();
  t0 = performance.now();
  const warm = await measureJank(() => h.removeBackground('ai'));
  log(`remove background again (model loaded) ${Math.round(performance.now() - t0)} ms, longest UI frame ${Math.round(warm.maxGap)} ms`);
  ed.undo();

  // ---- object selection (SlimSAM) ----
  t0 = performance.now();
  const obJank = await measureJank(() => h.objectAt(200, 150, 'replace'));
  const ob = ed.state().pixelSelection;
  log(`object select ${Math.round(performance.now() - t0)} ms incl. analysis (longest UI frame ${Math.round(obJank.maxGap)} ms): ${JSON.stringify(ob)}`);
  assert(ob && near(ob.x, 120, 1) && near(ob.y, 70, 1) && near(ob.width, 161, 2) && near(ob.height, 161, 2), 'object mask snapped to the disc edge');
  // Edges are refined to the pixels: compare the mask with the true disc.
  const om = ed.selection!.mask.getContext('2d')!.getImageData(0, 0, ed.width, ed.height).data;
  let wrong = 0;
  for (let y = 0; y < ed.height; y++) for (let x = 0; x < ed.width; x++) if (om[(y * ed.width + x) * 4 + 3] > 127 !== (x - 200) ** 2 + (y - 150) ** 2 <= 80 ** 2) wrong++;
  log(`object mask: ${wrong} pixels differ from the disc (edge ≈ 503 px)`);
  assert(wrong <= 25, `object edge is pixel-accurate (${wrong} wrong pixels)`);
  t0 = performance.now();
  await h.objectAt(50, 50, 'replace');
  const ob2 = ed.state().pixelSelection;
  log(`second click ${Math.round(performance.now() - t0)} ms: ${JSON.stringify(ob2)}`);
  assert(ob2 && near(ob2.x, 20, 1) && near(ob2.y, 20, 1) && near(ob2.width, 60, 2) && near(ob2.height, 60, 2), 'second object (square), exact edges');
  ed.deselect();
  await people(dir);
  workspace.activate(tab);

  // ---- canvas edge: pasteboard outside, a thin border around the document ----
  const priv = ed as unknown as { stage: { content: HTMLDivElement }; klayer: { getCanvas: () => { _canvas: HTMLCanvasElement; getPixelRatio: () => number } }; active: { objs: { getChildren: () => any[] } }; select: (n: unknown) => void };
  const lc = priv.klayer.getCanvas();
  const pr = lc.getPixelRatio();
  const v = ed.view;
  const stagePx = (x: number, y: number) => [...lc._canvas.getContext('2d')!.getImageData(Math.round(x * pr), Math.round(y * pr), 1, 1).data];
  assert(stagePx(Math.round(v.x) - 1, Math.round(v.y) + 150 * v.zoom)[3] > 0, 'border drawn just outside the canvas');
  assertEq(stagePx(2, 2)[3], 0, 'pasteboard (no checkerboard) far outside the canvas');

  // ---- rectangle: Ctrl-drag makes a square; corner radius is adjustable ----
  ed.setTool('rect');
  ed.setOptions({ cornerRadius: 12, strokeWidth: 4 });
  const box = priv.stage.content.getBoundingClientRect();
  const mouse = (type: string, dx: number, dy: number, ctrlKey = false) =>
    priv.stage.content.dispatchEvent(new MouseEvent(type, { bubbles: true, ctrlKey, button: 0, clientX: box.left + v.x + dx * v.zoom, clientY: box.top + v.y + dy * v.zoom }));
  const objsBefore = ed.state().layers[0].objects;
  mouse('mousedown', 100, 100);
  mouse('mousemove', 160, 120, true);
  mouse('mouseup', 160, 120, true);
  assertEq(ed.state().layers[0].objects, objsBefore + 1, 'rectangle drawn');
  const rect = priv.active.objs.getChildren().at(-1);
  assert(near(rect.width(), 60, 1) && near(rect.height(), 60, 1), `Ctrl keeps it square (${rect.width()}×${rect.height()})`);
  assertEq(rect.cornerRadius(), 12, 'rounded corners from the Corners option');
  priv.select(rect);
  ed.updateObject({ cornerRadius: 0 });
  assertEq(ed.objectProps()?.cornerRadius, 0, 'sharp corners after editing');
  ed.undo();
  ed.undo();
  assertEq(ed.state().layers[0].objects, objsBefore, 'undo rectangle');
  ed.setTool('hand');

  // ---- free rotation ----
  ed.rotateBy(30, true);
  const want = rotatedSize(400, 300, 30);
  assertEq(`${ed.width}x${ed.height}`, `${want.w}x${want.h}`, 'rotated canvas enlarged');
  assertEq(px(ed.composite(), 2, 2)[3], 0, 'rotated corners transparent');
  ed.undo();
  assertEq(`${ed.width}x${ed.height}`, '400x300', 'undo rotation');

  // ---- layered .ora round trip (two layers, editable text) ----
  ed.addLayer('Top');
  ed.paint([{ x: 50, y: 280 }, { x: 150, y: 280 }]);
  const ora = join(I, 'out', 'layers.ora');
  assert(await h.writeImage(ora), 'saved .ora');
  const oraTab = (await workspace.openPath(ora))!;
  const oh = await waitFor(() => (hooks(oraTab)?.editor()?.state().layers.length === 2 ? hooks(oraTab) : null), '.ora reopened with 2 layers', 15000);
  const os = oh.editor()!.state();
  assertEq(os.layers.map((l) => l.name).join(','), 'Background,Top', 'layer names');
  assertEq(os.layers[0].objects, 1, 'text still editable after reopening');
  await workspace.close(oraTab, { force: true });
  workspace.activate(tab);

  // ---- save a copy keeps the original ----
  assert(await h.saveCopy(), 'saved a copy');
  const copyPath = join(I, 'subject (edited).png');
  assert((await api.Exists([copyPath]))[0], 'copy exists');
  const after = await api.Stat(src);
  assertEq(`${after.size}/${after.modTime}`, `${before.size}/${before.modTime}`, 'original untouched');
  assertEq(tab.filePath, copyPath, 'tab now edits the copy');
  await workspace.close(tab, { force: true });

  // "Keep originals": a plain save (Ctrl+S) of an opened image writes a copy.
  settings.update((s) => (s.imageKeepOriginal = true));
  const red = join(I, 'red.png');
  const redBefore = await api.Stat(red);
  const rt = (await workspace.openPath(red))!;
  const rh = await waitFor(() => (hooks(rt)?.editor() ? hooks(rt) : null), 'red editor');
  rh.editor()!.flip(true);
  assert(await workspace.save(rt), 'saved');
  assertEq(rt.filePath, join(I, 'red (edited).png'), 'save went to a copy');
  assertEq((await api.Stat(red)).modTime, redBefore.modTime, 'original kept');
  settings.update((s) => (s.imageKeepOriginal = false));
  await workspace.close(rt, { force: true });
}

/** One click on a person selects the whole person, not the badge or the face that was clicked. */
async function people(dir: string) {
  const t = (await workspace.openPath(join(dir, 'people', 'astronaut.jpg')))!;
  const h = await waitFor(() => (hooks(t)?.editor() ? hooks(t) : null), 'portrait editor');
  const ed = h.editor()!;
  const inside = (x: number, y: number) => ed.selection!.mask.getContext('2d')!.getImageData(x, y, 1, 1).data[3] > 127;
  // [click, what, points that must be selected]: a badge on the suit used to be all a click there gave, the face all a click on it gave.
  const cases: [number, number, string, [number, number][]][] = [
    [150, 400, 'the suit', [[150, 400], [190, 300], [80, 330], [320, 300]]],
    [225, 120, 'the face', [[225, 120], [225, 40], [150, 400], [190, 300]]],
  ];
  for (const [x, y, what, must] of cases) {
    const t0 = performance.now();
    await h.objectAt(x, y, 'replace');
    const b = ed.state().pixelSelection;
    log(`click on ${what}: ${Math.round(performance.now() - t0)} ms, ${JSON.stringify(b)}`);
    assert(b, `selected something for ${what}`);
    for (const [px, py] of must) assert(inside(px, py), `click on ${what}: (${px}, ${py}) selected`);
    assert(!inside(30, 200) && !inside(400, 150) && !inside(480, 30), `click on ${what}: flag, shuttle model and background not selected`);
  }
  await workspace.close(t, { force: true });
}
