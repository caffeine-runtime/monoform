// M32 (peek): the app started with --peek FILE (pictures opened from
// Explorer, the "Quick peek" verb) — a small window with just the file,
// read-only, no sidebar or tab bar, a "Quick view" bar with the path; the
// saved session isn't touched; Edit hands the file to the full editor.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { peek } from '../core/peek.svelte';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { markdownViews } from '../modules/markdown/views';
import { assert, assertEq, log, waitFor } from './harness';

export default async function m32peek(dir: string) {
  const t = await waitFor(() => workspace.tabs[0], 'peeked file opened');
  const file = join(dir, 'diagrams', 'notes.md');
  assertEq(t.path, file, 'the file from the command line');
  assert(peek.on, 'peek mode');
  assert(t.preview && t.readOnly, 'read-only');
  assertEq(workspace.tabs.length, 1, 'only that file (session not restored)');
  assert(!document.querySelector('.sidebar') && !document.querySelector('.tabbar'), 'no sidebar or tab bar');
  const bar = await waitFor(() => document.querySelector('.peekbar'), 'peek bar');
  assert(bar.textContent?.includes('notes.md'), 'file name shown');
  assert(document.querySelector('.pathbar')?.textContent?.includes('diagrams'), 'path shown');
  // A note reads as it looks: the rendered preview, no side panel; the bar's
  // Edit is the only way to the editor (no preview toggle in the status bar).
  await waitFor(() => markdownViews.get(t.id), 'Markdown view');
  log(`markdown view ${markdownViews.get(t.id)!.get()}`);
  assertEq(markdownViews.get(t.id)!.get(), 'preview', 'Markdown shows the preview');
  await waitFor(() => document.querySelector('.preview .md h1'), 'rendered note');
  assert(!document.querySelector('.notepanel'), 'no outline panel');
  assert(!document.querySelector('.status .mode'), 'no preview toggle in the status bar');
  log(`peek window ${window.innerWidth}×${window.innerHeight}`);
  assert(window.innerWidth <= 1000, `small window (${window.innerWidth})`);
  const sessionBefore = JSON.stringify(settings.value.session);
  const edit = bar.querySelector<HTMLButtonElement>('button.edit')!;
  assert(edit?.textContent?.includes('Edit'), 'Edit button');
  edit.click();
  const handed = await waitFor(async () => ((await api.TestLastHandoff())?.length ? await api.TestLastHandoff() : null), 'handed to the editor');
  assertEq(handed.join('|'), file, 'the file goes to the full editor');
  assertEq(JSON.stringify(settings.value.session), sessionBefore, 'session left alone');
}
