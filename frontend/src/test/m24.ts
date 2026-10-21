// M24: image formats — animated GIF frame editing (delete, reverse, retime,
// loop, undo) saved as GIF and as animated WebP and reopened; HEIC through the
// system decoder (and converted to JPG from the file tree action); ICO/ICNS
// written from an image and read back; font preview (names, coverage, the
// face loaded into the page).
import { api } from '../core/backend';
import { join } from '../core/paths';
import { convertImage } from '../core/tools';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const anim = (t: Tab) => (t as unknown as { animTest?: Hooks }).animTest;

async function openAnim(path: string, frames: number) {
  const tab = (await workspace.openPath(path))!;
  assertEq(tab.moduleId, 'image', 'image module');
  const h = await waitFor(() => (anim(tab)?.frames().length === frames ? anim(tab) : null), `${path}: ${frames} frames`, 15000);
  return { tab, h };
}

export default async function m24(dir: string) {
  const out = join(dir, 'img', 'out24');
  await api.CreateFolder(out).catch(() => {});

  // ---- build a 6-frame GIF from the 2-frame fixture, edit, save ----
  const src = await openAnim(join(dir, 'img', 'anim.gif'), 2);
  const h = src.h;
  h.setPlaying(false);
  h.select([0, 1]);
  h.duplicate();
  h.select([0, 1, 2, 3]);
  h.duplicate();
  assertEq(h.frames().length, 8, 'duplicated to 8 frames');
  h.select([6, 7]);
  h.remove();
  assertEq(h.frames().length, 6, 'deleted 2');
  h.undo();
  assertEq(h.frames().length, 8, 'undo');
  h.redo();
  assertEq(h.frames().length, 6, 'redo');
  h.select([0]);
  h.reverse(); // one frame selected → whole animation reversed
  h.retime(2); // twice as fast
  assertEq(h.frames()[0].delay, 50, 'delays halved (100 → 50 ms)');
  h.setLoop(3);
  await sleep(30);
  assert(src.tab.dirty, 'dirty');
  const gif = join(out, 'edited.gif');
  assert(await h.writeTo(gif), 'saved GIF');
  await sleep(30);
  assert(!src.tab.dirty, 'clean after save');
  const webp = join(out, 'edited.webp');
  assert(await h.writeTo(webp), 'saved animated WebP');
  await workspace.close(src.tab, { force: true });
  for (const p of [gif, webp]) {
    const r = await openAnim(p, 6);
    assertEq(r.h.loop(), 3, `${p}: loop count kept`);
    assertEq(r.h.frames().map((f: any) => f.delay).join(','), '50,50,50,50,50,50', `${p}: delays kept`);
    await workspace.close(r.tab, { force: true });
  }

  // ---- HEIC ----
  const heic = join(dir, 'img', 'sample.heic');
  const ht = (await workspace.openPath(heic))!;
  assertEq(ht.moduleId, 'image', 'HEIC opens in the image editor');
  const ed = await waitFor(() => ((ht as any).imageTest?.editor() ? (ht as any).imageTest.editor() : null), 'HEIC decoded', 20000);
  assertEq(`${ed.width}x${ed.height}`, '64x48', 'HEIC size');
  log(`HEIC: ${ht.status.type}`);
  await workspace.close(ht, { force: true });
  const jpg = await convertImage(heic, 'jpg');
  assert(jpg && (await api.Stat(jpg)).size > 300, 'converted to JPG next to it');

  // ---- ICO / ICNS ----
  const ico = join(out, 'app.ico');
  const icns = join(out, 'app.icns');
  await api.IconWrite(join(dir, 'img', 'subject.png'), ico, 'ico', []);
  await api.IconWrite(join(dir, 'img', 'subject.png'), icns, 'icns', []);
  for (const [p, n, big] of [
    [ico, 7, 256],
    [icns, 11, 1024],
  ] as const) {
    const t = (await workspace.openPath(p))!;
    await waitFor(() => (document.querySelectorAll('.tabview.active .icons .size').length === n ? true : null), `${p}: ${n} sizes listed`);
    assert(document.querySelector('.tabview.active .icons .view img')?.getAttribute('alt') === `${big} px`, `${p}: largest shown`);
    await workspace.close(t, { force: true });
  }

  // ---- fonts ----
  for (const f of ['test.ttf', 'test.woff']) {
    const t = (await workspace.openPath(join(dir, 'fonts', f)))!;
    assertEq(t.moduleId, 'font', `${f} opens in the font view`);
    const fh = await waitFor(() => ((t as any).fontTest?.loaded() ? (t as any).fontTest : null), `${f} loaded`);
    assertEq(fh.info().family, 'Mf Test Sans', 'family name');
    assert(document.fonts.check(`16px "${fh.family}"`), 'face available to the page');
    await sleep(30);
    assertEq(document.querySelectorAll('.tabview.active .grid .ch').length, 5, 'covered characters listed (space, A, B, ž, 😀)');
    await workspace.close(t, { force: true });
  }
}
