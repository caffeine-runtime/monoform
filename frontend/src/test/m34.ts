// M34: file history — a note written by another program, then edited and
// saved twice in the app: its history has the original and both saves, the
// newest marked current. A version opens read-only, compares with the file
// now, and restores (the open tab reloads; the replaced content becomes a
// version too). Images are versioned like text; renaming keeps the history;
// "all files" lists everything; with history off nothing new is kept.
import { api, readFile } from '../core/backend';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { controllers } from '../modules/text/controllers';
import { assert, assertEq, log, waitFor } from './harness';

type V = { t: number; h: string; s: number; k: string; n?: string };
type H = {
  versions: () => V[];
  files: () => { path: string; exists: boolean; versions: number }[];
  current: () => string;
  loaded: () => boolean;
  reload: () => Promise<void>;
  restore: (i: number) => Promise<void>;
  open: (i: number) => Promise<void>;
  compare: (i: number) => Promise<void>;
};
const hist = (t: Tab) => (t as unknown as { historyTest?: H }).historyTest;
const text = async (p: string) => new TextDecoder().decode(await readFile(p));
const kinds = (h: H) => h.versions().map((v) => v.k).join(',');

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

async function answer(button: string) {
  const d = await waitFor(() => ui.dialog, 'dialog');
  d.resolve({ button });
}

export default async function m34(dir: string) {
  await closeAll();
  const folder = join(dir, `history-${Date.now()}`); // fresh each run
  await api.CreateFolder(folder).catch(() => {});
  const p = join(folder, 'note.md');
  await api.TestWriteFile(p, '# Note\nfirst\n'); // another program: not a save in the app

  // ---- two saves in the app ----
  const tab = (await workspace.openPath(p))!;
  const ctl = await waitFor(() => {
    const c = controllers.get(tab.id);
    return c && !c.loading && tab.status.encoding ? c : null;
  }, 'editor');
  const at = (s: string) => ctl.view.dispatch({ changes: { from: ctl.view.state.doc.length, insert: s } });
  at('second\n');
  const t0 = performance.now();
  await ctl.save();
  log(`save with history: ${Math.round(performance.now() - t0)} ms`);
  at('third\n');
  await ctl.save();

  // ---- the history of the file ----
  assert(commands.execute('file.history'), 'history command');
  const ht = await waitFor(() => workspace.tabs.find((t) => t.title === 'History · note.md'), 'history tab');
  const h = await waitFor(() => (hist(ht)?.loaded() ? hist(ht) : null), 'history loaded');
  assertEq(kinds(h), 'saved,saved,original', 'original + two saves, newest first');
  assertEq(h.current(), h.versions()[0].h, 'the newest is the file now');
  const view = () => document.querySelector(`.tabview[data-tab-id="${ht.id}"]`)!;
  await waitFor(() => (view().querySelectorAll('.versions li').length === 3 ? true : null), 'three versions listed');
  assertEq(view().querySelectorAll('.versions li.current').length, 1, 'one marked current');
  assert(view().textContent?.includes('Before the first save'), 'original labelled');

  // Open a version read-only.
  await h.open(2);
  const old = await waitFor(() => workspace.tabs.find((t) => t.title.startsWith('note (') && t.title.endsWith(').md')), 'version tab');
  assert(old.preview, 'opened read-only');
  assertEq(await text(old.filePath!), '# Note\nfirst\n', 'the original content');

  // Compare it with the file now.
  workspace.activate(ht);
  await h.compare(2);
  const cmp = await waitFor(() => workspace.tabs.find((t) => t.moduleId === 'compare'), 'compare tab');
  await waitFor(() => (document.querySelector(`.tabview[data-tab-id="${cmp.id}"]`)?.textContent?.includes('+2 −0') ? true : null), 'compare: the two lines added since');

  // Restore the original: the open note reloads, the replaced content is a version.
  workspace.activate(ht);
  const r = h.restore(2);
  await answer('restore');
  await r;
  assertEq(await text(p), '# Note\nfirst\n', 'file restored');
  await waitFor(() => (ctl.view.state.doc.toString() === '# Note\nfirst\n' && !tab.dirty ? true : null), 'open tab reloaded');
  await waitFor(() => (kinds(h) === 'restored,saved,saved,original' ? true : null), `restore recorded (${kinds(h)})`);
  assertEq(h.versions()[0].h, h.versions()[3].h, 'same content as the original');
  assert(!tab.external, 'no "changed on disk" banner for our own restore');

  // Undo the restore: back to the third save.
  await h.reload();
  const r2 = h.restore(1);
  await answer('restore');
  await r2;
  assert((await text(p)).endsWith('third\n'), 'restore undone');
  await h.reload();
  await waitFor(() => (view().querySelectorAll('.versions li').length === 5 ? true : null), 'five versions');
  assertEq(view().querySelectorAll('.versions li.current').length, 1, 'only the newest copy of the current content is marked');

  // ---- an image ----
  const img = join(folder, 'pic.png');
  await api.CopyFile(join(dir, 'img', 'photo.png'), img);
  await api.CopyFile(join(dir, 'img', 'out.png'), img);
  const ih = await api.HistoryOf(img);
  assertEq(ih.entries.map((e) => e.k).join(','), 'saved,saved', 'image versions');
  const ver = await api.HistoryExtract(img, ih.entries[1].h, ih.entries[1].t);
  assertEq((await readFile(ver)).byteLength, (await readFile(join(dir, 'img', 'photo.png'))).byteLength, 'earlier image kept byte for byte');

  // ---- rename keeps the history ----
  const moved = join(folder, 'renamed.md');
  await workspace.close(tab, { force: true });
  await api.Rename(p, moved);
  assertEq((await api.HistoryOf(moved)).entries.length, 5, 'history follows the rename');
  assertEq((await api.HistoryOf(p)).entries.length, 0, 'nothing left at the old name');

  // ---- all files ----
  assert(commands.execute('history.all'), 'all files command');
  const all = await waitFor(() => workspace.tabs.find((t) => t.title === 'History'), 'all-files tab');
  const ah = await waitFor(() => (hist(all)?.loaded() && hist(all)!.files().length ? hist(all) : null), 'files listed');
  const names = ah.files().map((f) => f.path);
  assert(names.includes(moved) && names.includes(img), `listed: ${names.join(', ')}`);

  // ---- off: nothing new kept ----
  settings.update((s) => (s.historyOff = true));
  await settings.flush();
  await api.CopyFile(join(dir, 'img', 'big.png'), img);
  assertEq((await api.HistoryOf(img)).entries.length, 2, 'no version while off');
  settings.update((s) => (s.historyOff = false));
  await settings.flush();
  await closeAll();
}
