// M54: Word formatting through the toolbar's real editing commands. In a new
// .docx: a word in Georgia 18 pt, one in red, one highlighted yellow, one in
// superscript; a centred paragraph with double line spacing indented half an
// inch; a Title and a Heading 4 (styles the blank document lacks). Saved and
// reopened, all of it is still there (and styles.xml got the new styles). The
// page is dark in the dark theme and the toolbar switch makes it light.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

interface Hooks {
  page: () => HTMLDivElement | undefined;
  writeTo: (path: string, retarget: boolean) => Promise<boolean>;
  exec: (cmd: string, value?: string) => void;
  setStyle: (s: string) => void;
  setFont: (f: string) => void;
  setSize: (pt: number) => void;
  setColor: (hex: string | null) => void;
  setHighlight: (name: string | null) => void;
  align: (a: 'left' | 'center' | 'right' | 'justify') => void;
  indent: (d: 1 | -1) => void;
  setSpacing: (v: string) => void;
  darkPage: () => boolean;
}
const hooks = (t: Tab) => (t as unknown as { docTest?: Hooks }).docTest;

async function open(path: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(path))!;
  const h = await waitFor(() => hooks(tab), 'document editor');
  const page = await waitFor(() => (h.page()?.querySelector('[data-p]') ? h.page()! : null), 'document rendered');
  return { tab, h, page };
}

/** Select a word inside the page. */
function selectWord(page: HTMLElement, word: string) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + word.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return;
  }
  throw new Error(`no "${word}" in the page`);
}

const blockOf = (page: HTMLElement, text: string) => Array.from(page.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6')).find((b) => b.textContent?.includes(text))!;

/** The style a word ends up with (the element around its text). */
function wordStyle(page: HTMLElement, word: string): CSSStyleDeclaration {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.includes(word)) return getComputedStyle(n.parentElement!);
  throw new Error(`no "${word}"`);
}

export default async function m54(dir: string) {
  await api.CreateFolder(join(dir, 'office', 'out')).catch(() => {});
  const path = join(dir, 'office', 'out', `format-${Date.now()}.docx`);
  await api.CreateFromTemplate(path, 'docx', { width: 0, height: 0, background: '' });
  let { h, page } = await open(path);
  const p = page.querySelector<HTMLElement>('[data-p]')!;
  const r = document.createRange();
  r.selectNodeContents(p);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  document.execCommand('insertText', false, 'Georgia red yellow x2 plain');
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'A centred paragraph');
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'The title');
  document.execCommand('insertParagraph');
  document.execCommand('insertText', false, 'Small heading');
  page.dispatchEvent(new InputEvent('input', { bubbles: true }));

  selectWord(page, 'Georgia');
  h.setFont('Georgia');
  selectWord(page, 'Georgia');
  h.setSize(18);
  selectWord(page, 'red');
  h.setColor('FF0000');
  selectWord(page, 'yellow');
  h.setHighlight('yellow');
  selectWord(page, '2');
  h.exec('superscript');
  selectWord(page, 'centred');
  h.align('center');
  h.setSpacing('2');
  h.indent(1);
  selectWord(page, 'title');
  h.setStyle('title');
  selectWord(page, 'Small');
  h.setStyle('h4');
  await sleep(50);
  const check = (what: string) => {
    const g = wordStyle(page, 'Georgia');
    assert(g.fontFamily.includes('Georgia') && Math.round(parseFloat(g.fontSize)) === 24, `${what}: Georgia 18 pt (${g.fontFamily} ${g.fontSize})`);
    assertEq(wordStyle(page, 'red').color, 'rgb(255, 0, 0)', `${what}: red`);
    assertEq(wordStyle(page, 'yellow').backgroundColor, 'rgb(255, 245, 157)', `${what}: yellow highlight`);
    assert(page.querySelector('sup')?.textContent === '2', `${what}: superscript`);
    const c = blockOf(page, 'centred');
    assertEq(`${c.style.textAlign} ${c.style.lineHeight} ${c.style.marginLeft}`, 'center 2 48px', `${what}: centred, double spaced, indented`);
    assert(blockOf(page, 'The title').matches('h1.title'), `${what}: title`);
    assertEq(blockOf(page, 'Small heading').tagName, 'H4', `${what}: heading 4`);
    assertEq(wordStyle(page, 'plain').color, wordStyle(page, 'centred').color, `${what}: the rest unchanged`);
  };
  check('edited');
  assert(await h.writeTo(path, false), 'saved');
  ({ h, page } = await open(path));
  check('reopened');
  log('font, size, colour, highlight, superscript, alignment, spacing, indent, Title and Heading 4 saved');

  // Dark paper in the dark theme; the toolbar switch keeps it light.
  const prev = { theme: settings.value.theme, light: settings.value.lightCanvases };
  settings.update((s) => ((s.theme = 'dark'), (s.lightCanvases = false)));
  await waitFor(() => (page.classList.contains('dark') ? true : null), 'dark page in the dark theme');
  const sw = Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar button')).find((b) => b.getAttribute('aria-label') === 'Light page')!;
  assert(sw, 'the light/dark page switch');
  sw.click();
  await waitFor(() => (!page.classList.contains('dark') ? true : null), 'light page after the switch');
  assert(h.darkPage() === false, 'remembered in the setting');
  settings.update((s) => ((s.theme = prev.theme), (s.lightCanvases = prev.light)));
  log('dark page follows the theme and the switch');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
