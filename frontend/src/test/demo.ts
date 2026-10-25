// Scripted tours of the app for the README's clips (scripts/readme-media.sh
// records them). Arg: "<scene>|<demo folder>|<theme>". A drawn pointer glides
// to what is clicked so the recording shows where things happen; logs
// "demo: rec" when the scene starts and "demo: end" when it ends. Scenes
// named "still-<name>" stage one view for a screenshot and log "demo: still".
import { EditorView } from '@codemirror/view';
import { aiModels } from '../core/aimodels.svelte';
import { api } from '../core/backend';
import { compareFiles } from '../core/compare';
import { dropInto } from '../core/split';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { pasteInto, pngOf, readTransfer } from '../core/transfer.svelte';
import { ui } from '../core/ui.svelte';
import { WindowSetSize } from '../wailsjs/runtime/runtime';
import { log, press, sleep, waitFor } from './harness';

const W = 1280;
const H = 800;

// ------------------------------------------------------------- the pointer

const ARROW =
  '<svg width="28" height="32" viewBox="0 0 28 32"><path transform="translate(1.2 2)" d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#000" opacity=".28" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let cursor: HTMLDivElement;
let at = { x: W * 0.6, y: H * 0.55 };

function addCursor() {
  cursor = document.createElement('div');
  cursor.innerHTML = ARROW;
  Object.assign(cursor.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transform: `translate(${at.x}px, ${at.y}px)`,
  });
  document.body.appendChild(cursor);
}

async function moveTo(x: number, y: number, ms = 650) {
  const d = Math.hypot(x - at.x, y - at.y);
  const t = Math.max(250, Math.min(ms, 250 + d * 0.9));
  cursor.style.transition = `transform ${t}ms cubic-bezier(.35,.1,.2,1)`;
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  at = { x, y };
  await sleep(t + 40);
}

function centre(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function ripple() {
  const r = document.createElement('div');
  Object.assign(r.style, {
    position: 'fixed',
    left: `${at.x - 18}px`,
    top: `${at.y - 18}px`,
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: 'rgba(224, 120, 70, .45)',
    zIndex: '2147483646',
    pointerEvents: 'none',
    transform: 'scale(.3)',
    transition: 'transform 380ms ease-out, opacity 380ms ease-out',
  });
  document.body.appendChild(r);
  await sleep(16);
  r.style.transform = 'scale(1.2)';
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 420);
  cursor.animate([{ scale: 1 }, { scale: 0.86 }, { scale: 1 }], { duration: 200 });
  await sleep(120);
}

/** Glide to an element and click it. */
async function click(el: HTMLElement, dx = 0, dy = 0) {
  const c = centre(el);
  await moveTo(c.x + dx, c.y + dy);
  await ripple();
  el.click();
}

/** Type into a text field, one key at a time. */
async function typeInto(input: HTMLInputElement, text: string, ms = 70) {
  input.focus();
  for (const ch of text) {
    input.value += ch;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(ms);
  }
}

/** Type into a code editor at the end of the document, a key at a time. */
async function typeCode(view: EditorView, text: string, ms = 45) {
  view.focus();
  for (const ch of text) {
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: ch }, selection: { anchor: pos + 1 }, userEvent: 'input.type', scrollIntoView: true });
    await sleep(ch === '\n' ? ms * 4 : ms + (Math.random() * ms) / 2);
  }
}

// Waits not worth watching (a model working) are cut from the clip: the
// scene marks them and logs the list at the end, in seconds from "rec".
let rec0 = 0;
const cuts: [number, number][] = [];
async function cut<T>(p: Promise<T>): Promise<T> {
  const t0 = (performance.now() - rec0) / 1000;
  const v = await p;
  const t1 = (performance.now() - rec0) / 1000;
  if (t1 - t0 > 1.2) cuts.push([t0 + 0.5, t1 - 0.4]);
  return v;
}

// ----------------------------------------------------------------- helpers

const row = (path: string) => waitFor(() => document.querySelector<HTMLElement>(`.tree .row[title="${CSS.escape(path)}"]`), `tree row ${path}`);
const pane = (t: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${t.id}"]`);

async function openFromTree(dir: string, name: string, hold: number) {
  const r = await row(join(dir, name));
  await click(r);
  const tab = await waitFor(() => workspace.tabs.find((t) => t.filePath === join(dir, name)), `tab ${name}`);
  await sleep(hold);
  return tab;
}

/** Turn the model at `rpm` turns a minute by the clock, not per frame: a heavy
 * model on software OpenGL draws few frames, and OrbitControls' auto-rotate
 * would crawl. */
async function spin(tab: Tab, rpm = 6) {
  const v = await waitFor(() => (tab as unknown as { modelTest?: { viewer: () => any; loading: () => boolean } }).modelTest, 'model view');
  await waitFor(() => (!v.loading() && v.viewer() ? true : null), 'model loaded', 60000);
  await sleep(400); // the view frames the model once laid out
  const viewer = v.viewer();
  const c = viewer.controls;
  const t0 = performance.now();
  const start = Math.atan2(viewer.camera.position.x - c.target.x, viewer.camera.position.z - c.target.z);
  const r = Math.hypot(viewer.camera.position.x - c.target.x, viewer.camera.position.z - c.target.z);
  const turn = () => {
    if (!viewer.renderer.domElement.isConnected) return;
    const a = start + ((performance.now() - t0) / 60000) * rpm * 2 * Math.PI;
    viewer.camera.position.x = c.target.x + r * Math.sin(a);
    viewer.camera.position.z = c.target.z + r * Math.cos(a);
    viewer.camera.lookAt(c.target);
    viewer.kick();
    requestAnimationFrame(turn);
  };
  requestAnimationFrame(turn);
}

async function palette(query: string) {
  press('Mod+K');
  if (!ui.paletteOpen) ui.openPalette('');
  const input = await waitFor(() => document.querySelector<HTMLInputElement>('.palette input'), 'palette');
  await sleep(250);
  await typeInto(input, query, 85);
  await sleep(450);
  press('Enter', input);
  await sleep(200);
}

// ------------------------------------------------------------------ scenes

/** Everyday files in one window: a note, the report, a CSV and an SVG; then
 * the photo, where Select subject (with the optional AI model) finds the
 * shuttle, and the cut-out goes into the report, dragged beside it. */
async function tour(dir: string) {
  await moveTo(140, 300, 400);
  await openFromTree(dir, 'Notes.md', 2100);
  await openFromTree(dir, 'Report.docx', 1900);
  await openFromTree(dir, 'Landmark flights.csv', 1800);
  await openFromTree(dir, 'Mission profile.svg', 2200);
  const img = await openFromTree(dir, 'Discovery in orbit.jpg', 700);
  const report = workspace.findByPath(join(dir, 'Report.docx'))!;
  const h = await waitFor(() => (img as unknown as { imageTest?: any }).imageTest, 'image editor');
  await waitFor(() => h.editor(), 'editor');
  // The object tool, then Select subject: the model finds the shuttle.
  await click(await waitFor(() => pane(img)!.querySelector<HTMLElement>('button[aria-label="Select object"]'), 'object tool'));
  await sleep(400);
  const subject = await waitFor(() => [...pane(img)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Select subject')), 'Select subject');
  await click(subject);
  await sleep(300);
  await cut(waitFor(() => (!h.busy() && h.editor().selection ? true : null), 'subject selected', 120000));
  await sleep(1500);
  const copy = await waitFor(() => [...pane(img)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Copy'), 'Copy');
  await click(copy);
  await sleep(600);
  // Drag the report's tab onto the right edge of the photo: side by side.
  const tabEl = document.querySelector<HTMLElement>(`.tab[data-tab="${report.id}"]`)!;
  const from = centre(tabEl);
  await moveTo(from.x, from.y);
  const ghost = document.createElement('div');
  ghost.textContent = report.title;
  Object.assign(ghost.style, {
    position: 'fixed', left: '0', top: '0', zIndex: '2147483646', pointerEvents: 'none', padding: '6px 12px', borderRadius: '6px',
    font: '500 14px Inter, sans-serif', color: '#fff', background: 'rgba(40, 44, 56, .92)', boxShadow: '0 4px 14px rgba(0,0,0,.4)',
    transition: 'transform 700ms cubic-bezier(.35,.1,.2,1)', transform: `translate(${from.x + 14}px, ${from.y + 10}px)`,
  });
  document.body.appendChild(ghost);
  const view = pane(img)!.getBoundingClientRect();
  const edge = { x: view.right - 70, y: view.top + view.height / 2 };
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed', left: `${view.left + view.width / 2}px`, top: `${view.top}px`, width: `${view.width / 2}px`, height: `${view.height}px`,
    background: 'rgba(224, 120, 70, .16)', border: '2px solid rgba(224, 120, 70, .7)', borderRadius: '6px', zIndex: '2147483645',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 250ms',
  });
  document.body.appendChild(hint);
  await sleep(16);
  ghost.style.transform = `translate(${edge.x + 14}px, ${edge.y + 10}px)`;
  await moveTo(edge.x, edge.y, 700);
  hint.style.opacity = '1';
  await sleep(500);
  ghost.remove();
  hint.remove();
  workspace.setSplit(dropInto(workspace.split, report.id, img.id, 'right'));
  await sleep(900);
  // Into the report: a new line after the introduction, then paste.
  const d = await waitFor(() => (report as unknown as { docTest?: any }).docTest, 'document editor');
  const page = d.page() as HTMLElement;
  const intro = [...page.querySelectorAll<HTMLElement>('[data-p]')].find((p) => p.textContent?.includes('science fair'))!;
  await click(intro, 60, 0);
  const r = document.createRange();
  r.selectNodeContents(intro);
  r.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(r);
  page.focus();
  document.dispatchEvent(new Event('selectionchange'));
  document.execCommand('insertParagraph');
  void keycap('Ctrl  V');
  await sleep(300);
  const x = await readTransfer();
  if (x?.kind === 'image') await d.addPicture(await pngOf(x.image), 'png');
  await waitFor(() => page.querySelector('img'), 'the cut-out in the report', 15000);
  await sleep(3200);
}

/** A key press, shown as a keycap for a moment. */
async function keycap(label: string) {
  const k = document.createElement('div');
  k.textContent = label;
  Object.assign(k.style, {
    position: 'fixed',
    left: `${at.x + 26}px`,
    top: `${at.y + 18}px`,
    padding: '6px 12px',
    borderRadius: '4px',
    font: '600 15px Inter, sans-serif',
    color: '#fff',
    background: 'rgba(20, 20, 20, .82)',
    boxShadow: '0 2px 8px rgba(0,0,0,.35)',
    zIndex: '2147483646',
    pointerEvents: 'none',
  });
  document.body.appendChild(k);
  await sleep(900);
  k.remove();
}

/** NASA's photo of Discovery: select the shuttle, copy it, paste it into a note. */
async function image(dir: string) {
  const tab = workspace.findByPath(join(dir, 'Discovery in orbit.jpg'))!;
  const note = workspace.findByPath(join(dir, 'notes', 'Moodboard.md'))!;
  const h = await waitFor(() => (tab as unknown as { imageTest?: any }).imageTest, 'image editor');
  await waitFor(() => h.editor(), 'editor');
  await sleep(400);
  // The object tool, then Select subject: the shuttle is found.
  await click(await waitFor(() => document.querySelector<HTMLElement>('button[aria-label="Select object"]'), 'object tool'));
  await sleep(400);
  const subject = await waitFor(() => [...pane(tab)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Select subject')), 'Select subject');
  await click(subject);
  await sleep(300);
  await cut(waitFor(() => (!h.busy() && h.editor().selection ? true : null), 'subject selected', 60000));
  await sleep(1400);
  // Copy, from the selection bar.
  const copy = await waitFor(() => [...pane(tab)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Copy'), 'Copy');
  await click(copy);
  await sleep(700);
  // Into the note: its tab, the end of the text, paste.
  await click(document.querySelector<HTMLElement>(`.tab[data-tab="${note.id}"]`)!);
  await sleep(700);
  const el = await waitFor(() => pane(note)?.querySelector<HTMLElement>('.cm-editor'), 'note editor');
  const view = EditorView.findFromDOM(el)!;
  const c = centre(el);
  await moveTo(c.x - 40, c.y - 60);
  await ripple();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
  void keycap('Ctrl  V');
  await sleep(300);
  await pasteInto(note);
  await waitFor(() => pane(note)?.querySelector('.preview img, .md-preview img, img[src*="assets"]') ?? null, 'pasted picture shown', 15000);
  await sleep(2800);
}

/** Writing Markdown with a live preview, a diagram included. */
async function markdown(dir: string) {
  const tab = workspace.findByPath(join(dir, 'notes', 'Poster.md'))!;
  const el = await waitFor(() => pane(tab)?.querySelector<HTMLElement>('.cm-editor'), 'editor');
  const view = EditorView.findFromDOM(el)!;
  await sleep(700);
  const c = centre(el);
  await moveTo(c.x, c.y + 120);
  await ripple();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  await typeCode(view, '- the landing video on a loop\n\n## The talk\n\n1. **launch**\n2. orbit and docking\n3. the landing\n\n');
  // A diagram, whole (half a Mermaid block is an error), then one more step.
  const pos = view.state.selection.main.head;
  const block = '```mermaid\nflowchart LR\n  Launch --> Orbit\n```\n';
  view.dispatch({ changes: { from: pos, insert: block }, selection: { anchor: pos + block.length - 4 }, userEvent: 'input.paste', scrollIntoView: true });
  await sleep(1400);
  await typeCode(view, '  Orbit --> Landing\n');
  await sleep(2600);
}

/** Search for a command, then four files side by side. */
async function split() {
  const model = workspace.tabs.at(-1)!;
  await sleep(600);
  await palette('split four');
  await sleep(500);
  await spin(model, 6);
  await sleep(1200);
  // Move between the views.
  for (const t of workspace.tabs.slice(0, 3)) {
    const p = pane(t);
    if (p) await click(p, 0, 40);
    await sleep(500);
  }
  await sleep(1400);
}

const FILES = ['notes/Notes (draft).md', 'Notes.md', 'Report.docx', 'Landmark flights.csv', 'Mission profile.svg', 'Shuttle fact sheet.pdf', 'Discovery in orbit.jpg', 'Fleet.xlsx', 'Rocket.svg', '3DBenchy.stl', 'Goldberg Variation 1.ogg', 'Atlantis landing.webm', 'notes/Moodboard.md', 'notes/Poster.md'];

const SCENES: Record<string, (dir: string) => Promise<void>> = { tour, image, markdown, split };

// Stills for the gallery ("still-<name>"): the folder open, one view staged.
const open = (f: string) => (d: string) => workspace.openPath(join(d, f)).then(() => undefined);
const STILLS: Record<string, (dir: string) => Promise<void>> = {
  pdf: open('Shuttle fact sheet.pdf'),
  word: open('Report.docx'),
  spreadsheet: open('Fleet.xlsx'),
  compare: async (d) => {
    compareFiles(join(d, 'notes', 'Notes (draft).md'), join(d, 'Notes.md'));
  },
  svg: open('Rocket.svg'),
  model3d: async (d) => {
    const t = (await workspace.openPath(join(d, '3DBenchy.stl')))!;
    await spin(t, 0);
  },
  audio: open('Goldberg Variation 1.ogg'),
  video: open('Atlantis landing.webm'),
  json: async (d) => {
    const t = (await workspace.openPath(join(d, 'missions.json')))!;
    const tree = await waitFor(() => (t as unknown as { dataTest?: { tree: () => { expandAll: () => Promise<void> } | undefined } }).dataTest?.tree(), 'JSON tree');
    await sleep(500);
    await tree.expandAll();
  },
  html: open('museums.html'),
  archive: open('photos.zip'),
  settings: async () => {
    workspace.openTool('settings');
    const h = await waitFor(() => [...document.querySelectorAll('h2, h3')].find((e) => e.textContent?.includes('AI models')), 'AI models section');
    h.scrollIntoView({ block: 'start' });
  },
};

export default async function demo(arg: string) {
  const [scene, dir, theme] = arg.split('|');
  settings.update((s) => {
    s.theme = (theme as 'light' | 'dark') || 'dark';
    s.uiScale = 1.1;
  });
  WindowSetSize(W, H);
  // "models": install the optional subject model into the cache once (the
  // script keeps that cache between runs), before any recording.
  if (scene === 'models') {
    if (!(await aiModels.installed('subject'))) {
      await api.AIInstall('subject');
      await waitFor(async () => ((await aiModels.installed('subject')) ? true : null), 'subject model installed', 1_500_000);
    }
    log('demo: models ready');
    return;
  }
  // Warm up: each viewer's code and the files load once before recording,
  // so nothing in the clip waits on a first load.
  for (const f of FILES) {
    await workspace.openPath(join(dir, f));
    await sleep(500);
  }
  await sleep(1000);
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  if (scene === 'tour' || scene.startsWith('still-')) await workspace.openFolder(dir);
  if (scene.startsWith('still-')) {
    await STILLS[scene.slice(6)](dir);
    await sleep(3000);
    log('demo: still');
    await sleep(1500);
    return;
  }
  if (scene === 'image') {
    await workspace.openPath(join(dir, 'notes', 'Moodboard.md'));
    await workspace.openPath(join(dir, 'Discovery in orbit.jpg'));
  }
  if (scene === 'markdown') await workspace.openPath(join(dir, 'notes', 'Poster.md'));
  if (scene === 'split') for (const f of ['Notes.md', 'Shuttle fact sheet.pdf', 'Discovery in orbit.jpg', '3DBenchy.stl']) await workspace.openPath(join(dir, f));
  await sleep(1500);
  addCursor();
  await sleep(200);
  log('demo: rec');
  rec0 = performance.now();
  await sleep(500);
  await SCENES[scene](dir);
  log(`demo: end cuts=${cuts.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(',')}`);
  await sleep(1500); // still on screen while the recorder stops
}
