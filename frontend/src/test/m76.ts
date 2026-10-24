// M76: editor keys win over the app's own shortcuts while typing. In a Word
// document Ctrl+B bolds the selected word (the sidebar stays as it is) and
// Ctrl+K asks for a link (the palette stays shut); with the focus outside the
// page both are the app's again (palette, sidebar). In the code editor Ctrl+/
// comments the line (not the shortcut list) and Ctrl+K still opens the
// palette; in plain text, which has no comments, Ctrl+/ is the shortcut list.
// Keys are pressed as key events, not by calling the editors.
import { EditorView } from '@codemirror/view';
import { api } from '../core/backend';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { ui } from '../core/ui.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';

async function open(path: string): Promise<Tab> {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  return (await workspace.openPath(path))!;
}

function select(page: HTMLElement, word: string) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + word.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return;
  }
  throw new Error(`no "${word}"`);
}

async function closePalette() {
  ui.paletteOpen = false;
  await sleep(30);
}

export default async function m76(dir: string) {
  // ---- Word document ----
  await api.CreateFolder(join(dir, 'office', 'out')).catch(() => {});
  const path = join(dir, 'office', 'out', `keys-${Date.now()}.docx`);
  await api.CreateFromTemplate(path, 'docx', { width: 0, height: 0, background: '' });
  const tab = await open(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => (tab as any).docTest, 'document editor');
  const page: HTMLElement = await waitFor(() => (h.page()?.querySelector('[data-p]') ? h.page() : null), 'document rendered');
  const r = document.createRange();
  r.selectNodeContents(page.querySelector('[data-p]')!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  page.focus();
  document.execCommand('insertText', false, 'Make this word bold');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));

  const sidebar = settings.value.sidebarVisible;
  select(page, 'bold');
  page.focus();
  press('Ctrl+B', page);
  await sleep(30);
  assert(document.queryCommandState('bold'), 'Ctrl+B in the page bolds the word');
  assertEq(settings.value.sidebarVisible, sidebar, 'and leaves the sidebar alone');

  select(page, 'word');
  page.focus();
  press('Ctrl+K', page);
  const d = await waitFor(() => ui.dialog, 'the link dialog (Ctrl+K)');
  assertEq(d.title, 'Insert link', 'Ctrl+K in the page asks for a link');
  assert(!ui.paletteOpen, 'the palette stays shut');
  d.resolve({ button: 'cancel' });
  await sleep(30);

  page.blur();
  window.getSelection()!.removeAllRanges();
  press('Ctrl+K', document.body);
  await waitFor(() => (ui.paletteOpen ? true : null), 'the palette (Ctrl+K outside the page)');
  await closePalette();
  press('Ctrl+B', document.body);
  await waitFor(() => (settings.value.sidebarVisible !== sidebar ? true : null), 'Ctrl+B outside the page toggles the sidebar');
  press('Ctrl+B', document.body);
  await waitFor(() => (settings.value.sidebarVisible === sidebar ? true : null), 'and back');
  log('Word: Ctrl+B bolds, Ctrl+K links; outside the page they are the sidebar and the palette');

  // ---- code editor ----
  await open(join(dir, 'code', 'sample.ts'));
  const cm = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .cm-editor'), 'code editor');
  const view = EditorView.findFromDOM(cm)!;
  await waitFor(() => (view.state.doc.length > 10 ? true : null), 'the file in the editor');
  await waitFor(() => (view.state.languageDataAt('commentTokens', 0).length ? true : null), 'TypeScript loaded (comment syntax)');
  const line2 = view.state.doc.line(2);
  view.dispatch({ selection: { anchor: line2.from + 3 } });
  view.focus();
  press('Ctrl+/', view.contentDOM);
  await sleep(30);
  assertEq(view.state.doc.line(2).text.slice(0, 18), '// export function', 'Ctrl+/ comments the line');
  assert(!ui.dialog, 'and does not open the shortcut list');
  press('Ctrl+/', view.contentDOM);
  await sleep(30);
  assertEq(view.state.doc.line(2).text, line2.text, 'Ctrl+/ again takes the comment away');
  press('Ctrl+K', view.contentDOM);
  await waitFor(() => (ui.paletteOpen ? true : null), 'Ctrl+K in the code editor opens the palette');
  await closePalette();
  log('code editor: Ctrl+/ comments, Ctrl+K opens the palette');

  // Plain text has no comments: Ctrl+/ is the shortcut list there.
  await open(join(dir, 'corpus', 'file042.txt'));
  const plain = await waitFor(() => document.querySelector<HTMLElement>('.tabview.active .cm-editor'), 'plain text editor');
  const pv = EditorView.findFromDOM(plain)!;
  await waitFor(() => (pv.state.doc.length > 0 ? true : null), 'the text file in the editor');
  pv.focus();
  const text0 = pv.state.doc.toString();
  press('Ctrl+/', pv.contentDOM);
  const list = await waitFor(() => ui.dialog, 'the shortcut list (Ctrl+/ in plain text)');
  assertEq(list.title, 'Keyboard shortcuts', 'Ctrl+/ in plain text shows the shortcut list');
  assertEq(pv.state.doc.toString(), text0, 'and leaves the text alone');
  list.resolve({ button: 'ok' });
  log('plain text: Ctrl+/ is the shortcut list');
}
