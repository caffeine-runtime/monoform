// M53: lists in Word documents. office/report.docx's bullet list (Symbol-font
// bullets from numbering.xml) shows as bullets; the numbered-list button turns
// a paragraph into "1.", a new paragraph after it continues the list ("2."),
// the level buttons and Tab / Shift+Tab nest it ("a."), Enter on an empty item
// ends the list, Backspace at the start of an item removes its marker,
// Ctrl+Shift+8 makes a bulleted list. Saved and reopened, the lists are the
// same; a new blank .docx (no numbering.xml) gets list definitions of its own.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  page: () => HTMLDivElement | undefined;
  writeTo: (path: string, retarget: boolean) => Promise<boolean>;
  toggleList: (kind: 'bullet' | 'number') => void;
  listLevel: (delta: number) => void;
  listAt: () => string | null;
}
const hooks = (t: Tab) => (t as unknown as { docTest?: Hooks }).docTest;

async function open(path: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(path))!;
  const h = await waitFor(() => hooks(tab), 'document editor');
  const page = await waitFor(() => (h.page()?.querySelector('[data-p]') ? h.page()! : null), 'document rendered');
  return { tab, h, page };
}

/** Put the caret at the start or end of an element. */
function caret(el: Node, atEnd: boolean) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!atEnd);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
}

const key = (page: HTMLElement, k: string, o: KeyboardEventInit = {}) => page.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const markers = (page: HTMLElement) => Array.from(page.querySelectorAll<HTMLElement>('.li')).map((p) => `${p.dataset.marker}${(p.textContent ?? '').trim()}`);
const byText = (page: HTMLElement, s: string) => Array.from(page.querySelectorAll<HTMLElement>('p, h1, h2, h3')).find((p) => p.textContent?.trim() === s)!;

export default async function m53(dir: string) {
  let { tab, h, page } = await open(join(dir, 'office', 'report.docx'));
  const before = markers(page);
  assertEq(before.length, 2, `the document's two list items (${before})`);
  assert(before.every((m) => m.startsWith('•')), `Symbol-font bullets shown as • (${before})`);
  const item = page.querySelector<HTMLElement>('.li')!;
  assert(parseFloat(getComputedStyle(item).paddingLeft) > 10, 'the marker sits in a hanging indent');

  // The numbered-list button on the last paragraph (other tests may have edited its text).
  const last = Array.from(page.children).filter((p) => p.tagName === 'P' && !p.classList.contains('li')).at(-1) as HTMLElement;
  caret(last, true);
  h.toggleList('number');
  assertEq(last.dataset.marker, '1.', 'numbered');
  assertEq(h.listAt(), 'number', 'the button shows it');
  // Enter (a new paragraph) continues the list.
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'Second item');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await sleep(30);
  const second = byText(page, 'Second item');
  assertEq(second?.dataset.marker, '2.', `the next item is 2. (${markers(page)})`);
  // A level deeper (button), back with Shift+Tab at the start.
  h.listLevel(1);
  assertEq(second.dataset.marker, 'a.', 'level 2 is lettered');
  caret(second, false);
  key(page, 'Tab', { shiftKey: true });
  assertEq(second.dataset.marker, '2.', 'Shift+Tab: back to the first level');
  key(page, 'Tab');
  assertEq(second.dataset.marker, 'a.', 'Tab at the start: deeper');
  key(page, 'Tab', { shiftKey: true });
  // Enter on an empty item ends the list.
  caret(second, true);
  document.execCommand('insertParagraph');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const empty = Array.from(page.querySelectorAll<HTMLElement>('.li')).at(-1)!;
  assertEq(empty.dataset.marker, '3.', 'an empty third item');
  caret(empty, false);
  key(page, 'Enter');
  assert(!empty.classList.contains('li'), 'Enter on the empty item ends the list');
  document.execCommand('insertText', false, 'After the list');
  // Ctrl+Shift+8: bulleted.
  key(page, '*', { code: 'Digit8', ctrlKey: true, shiftKey: true });
  assertEq(byText(page, 'After the list').dataset.marker, '•', 'Ctrl+Shift+8 makes a bullet');
  // Backspace at the start removes the marker but keeps the text.
  caret(byText(page, 'After the list'), false);
  key(page, 'Backspace');
  assert(!byText(page, 'After the list').classList.contains('li'), 'Backspace at the start: no longer a list item');
  key(page, '*', { code: 'Digit8', ctrlKey: true, shiftKey: true });
  log(`lists edited: ${markers(page).join(' | ')}`);

  // Saved and reopened: the same lists.
  const want = markers(page);
  const out = join(dir, 'office', 'out', 'lists.docx');
  await api.CreateFolder(join(dir, 'office', 'out')).catch(() => {});
  assert(await h.writeTo(out, true), 'saved');
  ({ tab, h, page } = await open(out));
  assertEq(markers(page).join(' | '), want.join(' | '), 'the lists survive saving');

  // A blank new document has no numbering.xml: one is added.
  const blank = join(dir, 'office', 'out', `blank-lists-${Date.now()}.docx`);
  await api.CreateFromTemplate(blank, 'docx', { width: 0, height: 0, background: '' });
  ({ tab, h, page } = await open(blank));
  const p = page.querySelector<HTMLElement>('[data-p]')!;
  caret(p, true);
  document.execCommand('insertText', false, 'Alpha');
  h.toggleList('bullet');
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'Beta');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));
  h.listLevel(1);
  assertEq(markers(page).join(' | '), '•Alpha | ◦Beta', 'bullets in a new document');
  assert(await h.writeTo(blank, false), 'saved the new document');
  ({ tab, h, page } = await open(blank));
  assertEq(markers(page).join(' | '), '•Alpha | ◦Beta', 'reopened with its new list definitions');
  log('a new document got numbering.xml');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
