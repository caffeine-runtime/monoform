// M32: preview mode — a file opened in preview is read-only (the editor
// can't be typed into), "Edit" in the status bar switches it to editing and
// back; the "open in preview" setting; files sent by a second launch with
// --preview open as previews. (m32peek covers the quick-peek window.)
import { EditorView } from '@codemirror/view';
import { EventsEmit } from '../wailsjs/runtime/runtime';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, sleep, waitFor } from './harness';

const cm = () => document.querySelector<HTMLElement>('.tabview.active .cm-content');

/** Does typing into the active editor change its document? */
async function typable(): Promise<boolean> {
  await waitFor(() => ((EditorView.findFromDOM(cm()!)?.state.doc.length ?? 0) > 0 ? true : null), 'document loaded');
  await sleep(100);
  const el = cm()!;
  const view = EditorView.findFromDOM(el)!;
  const before = view.state.doc.toString();
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  document.execCommand('insertText', false, 'X');
  await sleep(50);
  const changed = view.state.doc.toString() !== before;
  if (changed) document.execCommand('undo');
  return changed;
}

export default async function m32(dir: string) {
  const p = join(dir, 'diagrams', 'notes.md');
  const t = (await workspace.openPath(p, { preview: true }))!;
  assert(t.preview && t.readOnly, 'opened as a preview');
  await waitFor(() => cm(), 'editor shown');
  assert(!(await typable()), 'typing does nothing in preview');
  assertEq(cm()!.getAttribute('contenteditable'), 'false', 'not editable');
  const edit = await waitFor(() => document.querySelector<HTMLButtonElement>('.status button.mode'), 'status-bar mode button');
  assert(edit.textContent?.includes('Edit'), 'offers Edit');
  edit.click();
  await waitFor(() => (!t.preview && !t.readOnly ? true : null), 'switched to editing');
  await waitFor(() => cm(), 'editor remounted');
  await sleep(100);
  assert(await typable(), 'typing works when editing');
  await waitFor(() => (t.dirty ? true : null), 'dirty after typing');
  await sleep(50);
  t.dirty = false;
  await waitFor(() => (document.querySelector('.status button.mode')?.textContent === 'Editing' ? true : null), 'status says Editing');
  // And back (the file is unchanged, so no question).
  assert(await workspace.setPreview(t, true), 'back to preview');
  await waitFor(() => cm(), 'editor shown again');
  await sleep(100);
  assert(!(await typable()), 'read-only again');
  await workspace.close(t, { force: true });

  // The setting.
  settings.update((s) => (s.openInPreview = true));
  const t2 = (await workspace.openPath(join(dir, 'config', 'app.ini')))!;
  assert(t2.preview, 'setting opens files in preview');
  await workspace.close(t2, { force: true });
  settings.update((s) => (s.openInPreview = false));
  const t3 = (await workspace.openPath(join(dir, 'config', 'app.ini')))!;
  assert(!t3.preview, 'and off again');
  await workspace.close(t3, { force: true });

  // A second launch with --preview hands files over as previews.
  const q = join(dir, 'config', 'app.properties');
  EventsEmit('app:open-files', { paths: [q], preview: true });
  const t4 = await waitFor(() => workspace.tabs.find((x) => x.path === q), 'forwarded file opened');
  await sleep(20);
  assertEq(t4.preview, true, 'as a preview');
  await workspace.close(t4, { force: true });
}
