// M40: things move between editors. A picture dragged from the image editor
// (its copy/drag button) onto a video in split view becomes an overlay where
// it was dropped, with a chip and an outline while dragging; a video frame
// copied with Ctrl+C pastes into the image editor as a layer; text dropped on
// a video becomes a text overlay; a picture given to a note is saved into
// assets/ and linked; text given to the image editor becomes a text object;
// a picture given to an SVG is embedded; picture files dropped from the OS on
// the image editor become layers; a tab that can't take something says so.
import { readFile } from '../core/backend';
import { commands } from '../core/commands';
import { dropHandlers } from '../core/drop';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { give, type Transfer } from '../core/transfer.svelte';
import { ui } from '../core/ui.svelte';
import type { ImageEditor } from '../modules/image/editor';
import type { Project } from '../modules/video/project';
import { controllers } from '../modules/text/controllers';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const view = (t: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${t.id}"]`)!;
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
function pointer(type: string, target: EventTarget, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 11, bubbles: true }));
}

export default async function m40(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const img = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  const E = await waitFor(() => (img as unknown as { imageTest?: { editor: () => ImageEditor | null } }).imageTest?.editor() ?? null, 'image editor');
  const vid = (await workspace.openPath(join(dir, 'video', 'clip.webm')))!;
  const vh = () => (vid as unknown as { videoTest: { fx: () => Project; loading: () => boolean; natural: () => { w: number }; el: () => HTMLVideoElement | undefined } }).videoTest;
  await waitFor(() => (vh() && !vh().loading() && vh().natural().w === 320 && (vh().el()?.readyState ?? 0) >= 2 ? true : null), 'video ready', 15000);
  workspace.setSplit({ layout: 'columns', panes: [img.id, vid.id], x: 0.5, y: 0.5 });
  workspace.activate(img);
  await sleep(300);

  // ---- drag the picture from the image editor onto the video ----
  const grip = view(img).querySelector<HTMLButtonElement>('button.give')!;
  assert(grip, 'a copy/drag button in the image toolbar');
  const stage = view(vid).querySelector('.stage')!;
  const g = centre(grip);
  const s = centre(stage);
  pointer('pointerdown', grip, g.x, g.y);
  pointer('pointermove', grip, g.x + 10, g.y);
  await sleep(30);
  pointer('pointermove', grip, s.x, s.y);
  await sleep(50);
  assert(document.querySelector('.xfer-chip .hint')?.textContent?.includes('Drop into clip.webm'), `chip names the target (${document.querySelector('.xfer-chip')?.textContent})`);
  assert(document.querySelector('.xfer-target:not(.no)'), 'the video is outlined');
  pointer('pointerup', grip, s.x, s.y);
  await waitFor(() => (vh().fx().layers.length === 1 ? true : null), 'overlay added to the video');
  const ov = vh().fx().layers[0];
  log(`dropped overlay: ${ov.name} ${ov.w}×${ov.h} at ${Math.round(ov.keys[0].x)},${Math.round(ov.keys[0].y)}`);
  assertEq(ov.kind, 'image', 'an image overlay');
  assert(Math.abs(ov.keys[0].x - 160) < 12 && Math.abs(ov.keys[0].y - 90) < 12, 'placed where it was dropped (the middle)');
  assert(!document.querySelector('.xfer-chip') && !document.querySelector('.xfer-target'), 'drag ended');

  // ---- Ctrl+C on the video, Ctrl+V in the image editor ----
  workspace.activate(vid);
  await sleep(30);
  assert(commands.execute('edit.copyOut'), 'copy available on the video');
  await sleep(300);
  workspace.activate(img);
  const before = E.state().layers.length;
  assert(commands.execute('image.paste'), 'paste in the image editor');
  await waitFor(() => (E.state().layers.length === before + 1 ? true : null), 'frame pasted as a layer');
  const top = E.state().layers[E.state().layers.length - 1];
  const c = E.layerCanvas(top.id)!;
  log(`pasted frame layer "${top.name}" ${c.width}×${c.height}`);

  // ---- text dropped on the video (as an editor would drag it) becomes a text overlay ----
  const dt = new DataTransfer();
  dt.setData('text/plain', 'Hello there');
  const st = centre(stage);
  stage.dispatchEvent(new DragEvent('drop', { clientX: st.x, clientY: st.y, dataTransfer: dt, bubbles: true, cancelable: true }));
  await waitFor(() => (vh().fx().layers.some((l) => l.name.startsWith('Text: Hello')) ? true : null), 'text overlay');

  // ---- a picture into a note: saved into assets/ and linked ----
  workspace.setSplit(null);
  const note = (await workspace.openPath(join(dir, 'notes', 'index.md')))!;
  await waitFor(() => controllers.get(note.id), 'note editor');
  const pic: Transfer = { kind: 'image', image: c, name: 'frame' };
  assert(await give(note, pic), 'note takes a picture');
  const doc = controllers.get(note.id)!.view.state.doc.toString();
  const m = /!\[[^\]]*\]\((assets\/[^)]+\.png)\)/.exec(doc);
  assert(m, `link inserted (${doc.slice(0, 200)})`);
  const bytes = await readFile(join(dir, 'notes', m![1]));
  assert(bytes.byteLength > 100, `asset saved (${bytes.byteLength} bytes)`);

  // ---- text into the image editor: a text object ----
  workspace.activate(img);
  const objs = E.state().layers.find((l) => l.id === E.state().activeId)!.objects;
  assert(await give(img, { kind: 'text', text: 'Caption' }), 'image editor takes text');
  assertEq(E.state().layers.find((l) => l.id === E.state().activeId)!.objects, objs + 1, 'a text object added');

  // ---- a picture into an SVG: embedded ----
  const svg = (await workspace.openPath(join(dir, 'img', 'vector.svg')))!;
  await waitFor(() => (svg.handlers.accept ? true : null), 'svg editor');
  assert(await give(svg, pic), `svg takes a picture (${svg.moduleId})`);
  await waitFor(() => (svg.dirty ? true : null), 'svg changed');

  // ---- picture files dropped from the OS on the image editor: layers ----
  workspace.activate(img);
  await sleep(50);
  const n = E.state().layers.length;
  const ic = centre(view(img).querySelector('.stage')!);
  let claimed = false;
  for (const h of dropHandlers) if (h(ic.x, ic.y, [join(dir, 'img', 'red.png')])) {
    claimed = true;
    break;
  }
  assert(claimed, 'the drop is taken by the image editor (not opened as a tab)');
  await waitFor(() => (E.state().layers.length === n + 1 ? true : null), 'dropped picture added as a layer');

  // ---- something a tab can't take ----
  const toasts = ui.toasts.length;
  assert(!(await give(svg, { kind: 'files', paths: ['/x'] })), 'svg takes no files');
  assert(ui.toasts.length > toasts && /can’t take files/.test(ui.toasts[ui.toasts.length - 1].message), 'and says so');

  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
