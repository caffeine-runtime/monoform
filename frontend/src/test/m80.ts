// M80: word wrap. On by default: in a Markdown note a long line wraps onto
// several rows. The note's tool bar button turns it off (the line is one row,
// the setting off, the button not pressed); a text file opened then follows
// the setting, and Alt+Z there turns it on again for both.
import { EditorView } from '@codemirror/view';
import { t } from '../core/i18n';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';

const pane = (tab: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${tab.id}"]`);
const editorOf = (tab: Tab) => waitFor(() => pane(tab)?.querySelector<HTMLElement>('.cm-editor'), 'editor');
const wraps = (el: HTMLElement) => el.querySelector('.cm-content')!.classList.contains('cm-lineWrapping');

/** How many rows the editor's last line takes. */
function rows(view: EditorView) {
  const line = view.state.doc.line(view.state.doc.lines);
  return Math.round(view.lineBlockAt(line.from).height / view.defaultLineHeight);
}

export default async function m80(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  assert(settings.value.wordWrap, 'word wrap on by default');

  const note = (await workspace.openPath(`${dir}/notes/index.md`))!;
  const el = await editorOf(note);
  const view = EditorView.findFromDOM(el)!;
  await sleep(300);
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' + 'a long line that goes on and on '.repeat(40) } });
  await sleep(100);
  assert(wraps(el), 'the note wraps');
  assert(rows(view) >= 3, `a long line wraps onto several rows (${rows(view)})`);

  const button = await waitFor(() => pane(note)?.querySelector<HTMLButtonElement>(`button[aria-label="${t('Word wrap')}"]`), 'Word wrap button');
  assertEq(button.getAttribute('aria-pressed'), 'true', 'button pressed');
  button.click();
  await sleep(150);
  assert(!wraps(el) && rows(view) === 1, `off: one row (${rows(view)})`);
  assert(!settings.value.wordWrap, 'the setting is off');
  assertEq(button.getAttribute('aria-pressed'), 'false', 'button not pressed');
  log('the note: wraps by default, the tool bar button turns it off');

  // A text file opened now follows the setting; Alt+Z there changes it for every editor.
  const text = (await workspace.openPath(`${dir}/enc/utf8-lf.txt`))!;
  const tel = await editorOf(text);
  await sleep(200);
  assert(!wraps(tel), 'the text file opens unwrapped (setting off)');
  press('Alt+Z', tel.querySelector('.cm-content')!);
  await sleep(150);
  assert(wraps(tel) && settings.value.wordWrap, 'Alt+Z in the text file: on');
  await waitFor(() => (wraps(el) ? true : null), 'the note follows');
  assertEq(button.getAttribute('aria-pressed'), 'true', 'the note button pressed again');
  log('a text file and Alt+Z follow and change the same setting');

  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
