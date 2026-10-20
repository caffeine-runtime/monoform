// M32 (peek): the app started with --peek FILE — a small window with just
// the file, read-only, no sidebar or tab bar, a "Quick peek" bar; the saved
// session isn't touched; "Open in editor" makes the window full size, the
// file editable and the rest of the app (tab bar) appear.
import { join } from '../core/paths';
import { peek } from '../core/peek.svelte';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, waitFor } from './harness';

export default async function m32peek(dir: string) {
  const t = await waitFor(() => workspace.tabs[0], 'peeked file opened');
  assertEq(t.path, join(dir, 'diagrams', 'notes.md'), 'the file from the command line');
  assert(peek.on, 'peek mode');
  assert(t.preview && t.readOnly, 'read-only');
  assertEq(workspace.tabs.length, 1, 'only that file (session not restored)');
  assert(!document.querySelector('.sidebar') && !document.querySelector('.tabbar'), 'no sidebar or tab bar');
  const bar = await waitFor(() => document.querySelector('.peekbar'), 'peek bar');
  assert(bar.textContent?.includes('notes.md'), 'file name shown');
  log(`peek window ${window.innerWidth}×${window.innerHeight}`);
  assert(window.innerWidth <= 1000, `small window (${window.innerWidth})`);
  const sessionBefore = JSON.stringify(settings.value.session);
  bar.querySelector<HTMLButtonElement>('button')!.click();
  await waitFor(() => (!peek.on && !t.preview ? true : null), 'expanded to the editor');
  await waitFor(() => (window.innerWidth > 1100 ? true : null), `window full size (${window.innerWidth})`, 5000);
  await waitFor(() => document.querySelector('.tabbar'), 'tab bar back');
  assert(sessionBefore.length > 0, 'session read');
}
