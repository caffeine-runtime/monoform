// M46: Obsidian-style notes and a Navigation pane for documents. In the
// fixtures' vault/: word and character counts in the status bar (and of a
// selection); the outline tree (nested, click to go, the current heading
// highlighted); backlinks from the other notes with the linking line (click
// opens that note at the line); outgoing links with the missing one marked;
// [[wiki links]] in the preview (resolved by name, with #heading, missing ones
// dimmed and created on click); Ctrl+click on a link in the source; [[ completes
// note names. Word: the document's headings as an outline, click to go, counts.
import { acceptCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { api } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

type NoteHooks = {
  headings: () => { level: number; text: string; line: number }[];
  counts: () => { words: number; chars: number };
  selCounts: () => { words: number; chars: number } | null;
  active: () => number;
  panel: () => string;
  setPanel: (open: boolean, v?: string) => void;
  goLine: (n: number) => void;
  editor: () => EditorView | undefined;
  preview: () => HTMLElement | undefined;
};
const nh = (t: Tab) => (t as unknown as { noteTest?: NoteHooks }).noteTest;

async function openNote(path: string): Promise<{ tab: Tab; h: NoteHooks }> {
  const tab = (await workspace.openPath(path))!;
  const h = await waitFor(() => nh(tab), `${path} editor`);
  await waitFor(() => (h.editor() && h.headings().length ? true : null), `${path} read`);
  return { tab, h };
}

const cursorLine = (v: EditorView) => v.state.doc.lineAt(v.state.selection.main.head).number;
/** The panel of the tab on screen (hidden tabs keep theirs). */
const panel = () => [...document.querySelectorAll<HTMLElement>('.notepanel')].find((e) => e.offsetWidth > 0) ?? document.createElement('div');
const panelButton = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) => b.textContent?.trim().startsWith(label))!;

export default async function m46(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const vault = join(dir, 'vault');
  await workspace.openFolder(vault);
  const home = join(vault, 'Home.md');
  // A rerun: move the note an earlier run created out of the way (hidden files aren't notes).
  const created = join(vault, 'Missing note.md');
  if ((await api.Exists([created]))[0]) await api.Rename(created, join(vault, `.m46-${Date.now()}.md`));
  const t0 = performance.now();
  const { tab, h } = await openNote(home);
  log(`note open with outline in ${Math.round(performance.now() - t0)} ms`);

  // Counts, as in Obsidian's status bar (front matter, link targets and # left out).
  await waitFor(() => (tab.status.counts?.startsWith('25 words') ? true : null), 'counts in the status bar');
  assertEq(tab.status.counts, '25 words · 139 characters', 'word and character count');
  assert(document.querySelector('.status .counts')?.textContent?.includes('25 words'), 'shown in the status bar');
  const v = h.editor()!;
  const l3 = v.state.doc.line(3);
  v.dispatch({ selection: { anchor: l3.from, head: l3.from + 'Welcome to the **vault**.'.length } });
  await waitFor(() => (tab.status.counts?.startsWith('4 of 25 words') ? true : null), 'selection counted');
  log(`selection: ${tab.status.counts}`);

  // Outline: a tree; clicking a heading moves the cursor there and highlights it.
  h.setPanel(true, 'outline');
  await waitFor(() => panel().querySelector('.outline'), 'outline panel');
  assertEq(h.headings().map((x) => `${x.level}${x.text}`).join(','), '1Home,2Plan,3Details,2Archive', 'headings');
  const plan = [...panel().querySelectorAll('li')].find((li) => li.querySelector(':scope > .row .item')?.textContent === 'Plan')!;
  assert(plan.querySelector(':scope > ul .item')?.textContent === 'Details', 'Details is nested under Plan');
  const details = [...panel().querySelectorAll<HTMLButtonElement>('.item')].find((b) => b.textContent === 'Details')!;
  details.click();
  await waitFor(() => (cursorLine(v) === 8 ? true : null), 'cursor at the heading');
  await waitFor(() => (panel().querySelector('.row.on .item')?.textContent === 'Details' ? true : null), 'current heading highlighted');
  // Fold Plan: Details is hidden.
  plan.querySelector<HTMLButtonElement>(':scope > .row .fold')!.click();
  await sleep(30);
  assert(![...panel().querySelectorAll('.item')].some((b) => b.textContent === 'Details'), 'a branch folds');
  plan.querySelector<HTMLButtonElement>(':scope > .row .fold')!.click();

  // Backlinks: Ideas (two links) and Roadmap, with the lines.
  panelButton('Backlinks').click();
  await waitFor(() => (panelButton('Backlinks').textContent?.includes('3') ? true : null), 'three backlinks', 10000);
  const files = [...panel().querySelectorAll('.files > li')];
  assertEq(files.map((li) => li.querySelector('.name')?.textContent).join(','), 'Ideas,Roadmap', 'linking notes');
  assertEq(files[0].querySelectorAll('.hit').length, 2, 'both links from Ideas');
  assert(files[0].querySelector('.hit mark')?.textContent === '[[Home]]', 'the link is marked in its line');
  files[1].querySelector<HTMLButtonElement>('.hit')!.click();
  const road = await waitFor(() => (workspace.active?.path?.endsWith('Roadmap.md') ? workspace.active : null), 'backlink opens the note');
  const rh = await waitFor(() => nh(road)?.editor() ?? null, 'roadmap editor');
  await waitFor(() => (cursorLine(rh) === 4 ? true : null), 'at the linking line');

  // Back in Home: outgoing links, the missing one marked.
  workspace.activate(tab);
  await sleep(100);
  panelButton('Links').click();
  await waitFor(() => (panel().querySelectorAll('.files > li').length === 4 ? true : null), 'four outgoing links').catch((e) => {
    throw new Error(`${e.message}: ${[...panel().querySelectorAll('.files .name')].map((x) => x.textContent).join(' | ')} (active ${workspace.active?.title}, panel ${h.panel()})`);
  });
  const missing = panel().querySelector('.file.missing .name');
  assertEq(missing?.textContent, 'Missing note', 'missing note marked');

  // Preview: [[links]] resolved by name; a #heading opens at the heading.
  const views = await import('../modules/markdown/views');
  views.markdownViews.get(tab.id)!.set('preview');
  const pv = await waitFor(() => h.preview()?.querySelector('a.wikilink') && h.preview(), 'preview with wiki links');
  await waitFor(() => (pv.querySelector('a.wikilink[data-wiki="Missing note"].unresolved') ? true : null), 'missing link dimmed');
  assert(!pv.querySelector('a.wikilink[data-wiki="Ideas"]')!.classList.contains('unresolved'), 'existing link not dimmed');
  assertEq(pv.querySelector('a.wikilink[data-heading="Q3"]')?.textContent, 'roadmap', 'alias shown');
  // Outline follows the preview's scroll in preview mode.
  h.goLine(11);
  await waitFor(() => (h.headings()[h.active()]?.text === 'Archive' ? true : null), 'preview scrolled to Archive');
  (pv.querySelector('a.wikilink[data-heading="Q3"]') as HTMLElement).click();
  await waitFor(() => (workspace.active === road && cursorLine(rh) === 3 ? true : null), '[[Roadmap#Q3]] opens at Q3');

  // Clicking a link to a note that doesn't exist creates it (as in Obsidian).
  workspace.activate(tab);
  (pv.querySelector('a.wikilink[data-wiki="Missing note"]') as HTMLElement).click();
  const mt = await waitFor(() => (workspace.active?.path === created ? workspace.active : null), 'new note opened');
  assert((await api.Exists([created]))[0], 'new note written next to Home');
  await workspace.close(mt, { force: true });
  await waitFor(() => (!pv.querySelector('a.wikilink.unresolved') ? true : null), 'no longer dimmed', 10000);

  // Source: Ctrl+click follows a link; [[ completes note names.
  workspace.activate(tab);
  views.markdownViews.get(tab.id)!.set('split');
  await sleep(100);
  const lineIdeas = v.state.doc.line(3);
  const at = lineIdeas.from + lineIdeas.text.indexOf('[[Ideas]]') + 3;
  v.dispatch({ selection: { anchor: at }, effects: (await import('@codemirror/view')).EditorView.scrollIntoView(at, { y: 'center' }) });
  await sleep(50);
  const c = v.coordsAtPos(at)!;
  const target = document.elementFromPoint(c.left + 1, (c.top + c.bottom) / 2)!;
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: c.left + 1, clientY: (c.top + c.bottom) / 2, button: 0, ctrlKey: true }));
  await waitFor(() => (workspace.active?.path?.endsWith('Ideas.md') ? true : null), 'Ctrl+click opens [[Ideas]]');
  workspace.activate(tab);
  await sleep(50);
  const end = v.state.doc.length;
  v.dispatch({ changes: { from: end, insert: '\n[[Road' }, selection: { anchor: end + 7 } });
  v.focus();
  startCompletion(v);
  await waitFor(() => (currentCompletions(v.state).some((o) => o.label === 'Roadmap') ? true : null), '[[ completes note names');
  assert(!currentCompletions(v.state).some((o) => o.label === 'Home'), 'not the note itself');
  await sleep(150); // completions take input only after a short delay (interactionDelay)
  assert(acceptCompletion(v), 'completion accepted');
  assert(v.state.doc.toString().endsWith('[[Roadmap]]'), `completion inserts the link (${JSON.stringify(v.state.doc.toString().slice(-24))})`);
  await workspace.close(tab, { force: true });
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });

  // Word: the Navigation pane.
  const doc = (await workspace.openPath(join(dir, 'office', 'report.docx')))!;
  type DocHooks = { headings: () => { level: number; text: string }[]; active: () => number; counts: () => { words: number; chars: number }; goHeading: (i: number) => void; outlineOpen: () => boolean; page: () => HTMLElement };
  const dh = await waitFor(() => {
    const x = (doc as unknown as { docTest?: DocHooks }).docTest;
    return x?.headings().length ? x : null;
  }, 'document headings');
  assert(dh.outlineOpen() && document.querySelector('aside.outline [role=tree]'), 'outline shown');
  assertEq(dh.headings().map((x) => x.level).join(','), '1,2', 'Heading 1 and Heading 2');
  assert(document.querySelector('aside.outline li > ul [role=treeitem]'), 'Heading 2 nested under Heading 1');
  const dc = dh.counts();
  assert(dc.words > 5 && dc.chars > dc.words, `counts (${dc.words} words, ${dc.chars} characters)`);
  assert(doc.status.counts?.includes('characters'), `status bar: ${doc.status.counts}`);
  // The first repaint of a scrolled page is slow on the software renderer; measured apart from the outline.
  const plain = await measureJank(async () => {
    const d = (dh as unknown as { desk: () => HTMLElement }).desk();
    d.scrollTop = 200;
    await sleep(100);
    d.scrollTop = 0;
    await sleep(100);
  });
  log(`plain scroll longest frame ${Math.round(plain.maxGap)} ms`);
  const go = await measureJank(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('aside.outline .item')][1].click();
    await sleep(100);
  });
  assertEq(dh.active(), 1, 'second heading current after clicking it');
  // Selecting the heading counts the selection.
  const r = document.createRange();
  r.selectNodeContents(dh.page().querySelectorAll('h1, h2')[1]);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  await waitFor(() => (doc.status.counts?.includes(' of ') ? true : null), 'selection counted in the document');
  log(`document: ${doc.status.counts}; outline click longest frame ${Math.round(go.maxGap)} ms`);
  await workspace.close(doc, { force: true });
}
