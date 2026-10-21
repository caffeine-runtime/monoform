// M43: optional AI models (with MF_AI_FAKE=1 the Go side swaps the models
// for stand-ins: an ellipse for the subject, the surrounding colour for a
// removal — the downloads and pipelines are covered by Go tests). Settings ›
// AI models lists both packs; Install asks first (size, sources) and shows
// progress; Select subject then uses the installed model; Remove object
// without its model offers the download ("Not now" changes nothing), and
// with it removes the selected blue square through a background job, undoably;
// Remove in Settings uninstalls.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { ui } from '../core/ui.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import * as selection from '../modules/image/selection';
import type { ImageEditor } from '../modules/image/editor';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  selectSubject: () => Promise<void>;
  removeObject: () => Promise<void>;
  busy: () => string;
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

function px(ed: ImageEditor, x: number, y: number): number[] {
  return [...ed.composite().getContext('2d')!.getImageData(x, y, 1, 1).data];
}

async function answer(button: string, what: string) {
  const d = await waitFor(() => ui.dialog, what);
  log(`dialog: ${d.title} — ${d.message}`);
  d.resolve({ button });
  await sleep(20);
}

export default async function m43(dir: string) {
  for (const id of ['subject', 'eraser']) await api.AIRemove(id);

  // Settings lists the packs; Install asks, then downloads with progress.
  const settingsTab = workspace.openTool('settings');
  const row = (id: string) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${settingsTab.id}"] .pack[data-pack="${id}"]`);
  await waitFor(() => row('subject') && row('eraser'), 'both packs listed');
  assert(row('eraser')!.textContent!.includes('Object removal') && row('eraser')!.textContent!.includes('download'), 'eraser described with its size');
  row('subject')!.querySelector<HTMLButtonElement>('button')!.click();
  const d = await waitFor(() => ui.dialog, 'consent dialog');
  assert(d.title.includes('Better subject selection') && d.message!.includes('huggingface.co'), 'the dialog names what and from where');
  d.resolve({ button: 'ok' });
  await waitFor(() => (row('subject')?.textContent?.includes('Installed') ? true : null), 'subject installed', 10000);

  // Select subject uses it (the stand-in finds a centred ellipse, not the red circle).
  const t = (await workspace.openPath(join(dir, 'img', 'subject.png')))!;
  const h = await waitFor(() => (hooks(t)?.editor() ? hooks(t) : null), 'image editor');
  const ed = h.editor()!;
  await sleep(500); // the editor's first paint
  const sj = await measureJank(() => h.selectSubject());
  log(`select subject, longest UI frame ${Math.round(sj.maxGap)} ms`);
  const b = ed.selection?.bounds;
  assert(b, 'a selection');
  log(`subject bounds ${b.x},${b.y} ${b.width}×${b.height}`);
  assert(Math.abs(b.width - 240) <= 6 && Math.abs(b.height - 210) <= 6, `the installed model's answer (${b.width}×${b.height})`);
  ed.deselect();

  // Remove object without its model: offered, "Not now" changes nothing.
  ed.setPixelSelection(selection.fromPath(selection.rectPath({ x: 14, y: 14, width: 72, height: 72 }), { x: 14, y: 14, width: 72, height: 72 }, ed.width, ed.height));
  const blue = px(ed, 50, 50);
  assert(blue[2] > 150 && blue[0] < 100, `blue square (${blue})`);
  const declined = h.removeObject();
  await answer('cancel', 'download offer');
  await declined;
  assertEq(px(ed, 50, 50).join(), blue.join(), 'nothing removed');
  assert(ed.selection, 'selection kept');

  // Accepting downloads it, then removes the square as a job with progress.
  const jank = await measureJank(async () => {
    const run = h.removeObject();
    await answer('ok', 'download offer (accept)');
    await run;
  });
  log(`download offer, download and removal: longest UI frame ${Math.round(jank.maxGap)} ms`);
  const after = px(ed, 50, 50);
  assert(after[2] < 200 && after[0] > 150, `the square is filled with the surrounding colour (${after})`);
  assertEq(px(ed, 350, 250).join(), '235,232,226,255', 'the rest is untouched');
  assert(!ed.selection, 'deselected after removing');
  ed.undo();
  assertEq(px(ed, 50, 50).join(), blue.join(), 'undo brings it back');
  await sleep(300); // let the undo's redraw finish before measuring
  // Installed: removing again is a job with no questions, the UI stays responsive.
  ed.setPixelSelection(selection.fromPath(selection.rectPath({ x: 14, y: 14, width: 72, height: 72 }), { x: 14, y: 14, width: 72, height: 72 }, ed.width, ed.height));
  const again = await measureJank(() => h.removeObject());
  log(`second removal, longest UI frame ${Math.round(again.maxGap)} ms`);
  assert(!ui.dialog, 'no questions once installed');
  assert(px(ed, 50, 50)[2] < 200, 'removed again');

  // Remove in Settings uninstalls.
  workspace.activate(settingsTab);
  await waitFor(() => (row('eraser')?.textContent?.includes('Installed') ? true : null), 'eraser shown installed');
  row('eraser')!.querySelector<HTMLButtonElement>('button')!.click();
  await answer('ok', 'remove confirmation');
  await waitFor(() => (row('eraser')?.querySelector('button')?.textContent?.includes('Install') ? true : null), 'eraser removed');

  await workspace.close(t, { force: true });
  await workspace.close(settingsTab, { force: true });
  for (const id of ['subject', 'eraser']) await api.AIRemove(id);
}
