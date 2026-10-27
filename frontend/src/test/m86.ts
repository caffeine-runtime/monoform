// M86: quick view of files that are mostly looked at (started with --peek
// FILE, as a double-click on a PDF, a song or a video does): a reader or a
// player, without the editor's tools, and Edit in the bar for the rest. The
// argument says what the file is: "audio", "video" or "pdf".
import { peek } from '../core/peek.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';

const MODULES: Record<string, string> = { audio: 'audio', video: 'video', pdf: 'pdf' };

export default async function m86(kind: string) {
  const t = await waitFor(() => workspace.tabs[0], 'peeked file opened');
  assert(peek.on && t.readOnly, 'read-only quick view');
  assertEq(t.moduleId, MODULES[kind], `opens in the ${kind} view`);
  await waitFor(() => document.querySelector('.peekbar button.edit'), 'Edit in the bar');
  log(`quick view of ${t.title}: ${window.innerWidth}×${window.innerHeight}`);

  const tool = (title: string) => [...document.querySelectorAll<HTMLElement>('.toolbar [title]')].some((b) => b.title.startsWith(title));
  if (kind === 'audio') {
    await waitFor(() => document.querySelector('.stage canvas'), 'waveform');
    assert(window.innerWidth <= 740 && window.innerHeight <= 440, `a player's window (${window.innerWidth}×${window.innerHeight})`);
    assert(tool('Play') && tool('Zoom in'), 'play and zoom');
    assert(!tool('Undo') && ![...document.querySelectorAll('.toolbar button')].some((b) => b.textContent?.includes('Save')), 'no editing or saving');
    // Delete would cut the selection in the editor; here nothing changes.
    document.querySelector('.stage canvas')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    press('Delete', document.body);
    await sleep(200);
    assert(!t.dirty, 'Delete changes nothing');
  } else if (kind === 'video') {
    await waitFor(() => document.querySelector('video'), 'video');
    assert(tool('Play') && tool('Full screen'), 'player controls');
    assert(!tool('Cut out') && !tool('Rotate') && !tool('Undo'), 'no editing tools');
    press('R', document.body);
    await sleep(200);
    assert(!t.dirty, 'R rotates nothing');
  } else {
    await waitFor(() => document.querySelector('.page canvas, .page .canvasWrapper'), 'a page');
    assert(tool('Zoom in') || tool('Find'), 'reading controls');
    assert(!tool('Draw') && !tool('Sign') && !tool('Redact') && !tool('Page operations'), 'no markup tools');
  }
  assert(!document.querySelector('.status .mode'), 'no preview toggle in the status bar');
  assert(window.innerWidth <= 1000, 'a small window');
}
