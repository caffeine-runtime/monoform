// Scripted tours of the app for the README's clips (scripts/readme-media.sh
// records them). Arg: "<scene>|<demo folder>|<theme>". A drawn pointer glides
// to what is clicked so the recording shows where things happen; logs
// "demo: rec" when the scene starts and "demo: end" when it ends. Scenes
// named "still-<name>" stage one view for a screenshot and log "demo: still".
import { EditorView } from '@codemirror/view';
import { compareFiles } from '../core/compare';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { WindowSetSize } from '../wailsjs/runtime/runtime';
import { log, press, sleep, waitFor } from './harness';

const W = 1280;
const H = 800;

// ------------------------------------------------------------- the pointer

const ARROW =
  '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

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
    filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
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

async function spin(tab: Tab, speed = 3) {
  const h = await waitFor(() => (tab as unknown as { modelTest?: { viewer: () => any } }).modelTest?.viewer(), 'model viewer');
  h.controls.autoRotate = true;
  h.controls.autoRotateSpeed = speed;
  h.kick?.();
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

/** Every kind of file in one window: click through the trip folder. */
async function tour(dir: string) {
  await moveTo(140, 300, 400);
  await openFromTree(dir, 'Plan.md', 1900);
  await openFromTree(dir, 'Lisbon guide.pdf', 1700);
  await openFromTree(dir, 'tram-28.png', 1500);
  await openFromTree(dir, 'Budget.xlsx', 1500);
  await openFromTree(dir, 'azulejo.svg', 1400);
  const glb = await openFromTree(dir, 'souvenir.glb', 0);
  await spin(glb, 6);
  await sleep(1900);
  await openFromTree(dir, 'Fado sketch.wav', 1500);
  await openFromTree(dir, 'Sunset.webm', 1800);
}

/** The image editor: a magic-wand selection recoloured, then a background removed. */
async function image(dir: string) {
  const tab = workspace.findByPath(join(dir, 'tram-28.png'))!;
  const h = await waitFor(() => (tab as unknown as { imageTest?: any }).imageTest, 'image editor');
  await waitFor(() => h.editor(), 'editor');
  await sleep(400);
  // Pick the magic wand from the toolbar, click the tram.
  const wand = await waitFor(() => document.querySelector<HTMLElement>('button[aria-label="Magic wand"]'), 'wand');
  await click(wand);
  await sleep(300);
  const canvas = await waitFor(() => pane(tab)?.querySelector<HTMLCanvasElement>('canvas'), 'canvas');
  const r = canvas.getBoundingClientRect();
  const { w, h: ih } = h.natural() ?? { w: 1600, h: 1000 };
  const scale = Math.min(r.width / w, r.height / ih);
  const ox = r.left + (r.width - w * scale) / 2;
  const oy = r.top + (r.height - ih * scale) / 2;
  await moveTo(ox + 760 * scale, oy + 820 * scale);
  await ripple();
  await h.wandAt(760, 820, 'replace');
  await sleep(700);
  // Adjust › Hue: the tram turns red.
  h.setPanel('adjust');
  const a = await waitFor(() => h.adjust(), 'adjust panel');
  await sleep(400);
  const hue = document.querySelector<HTMLElement>('input[type="range"][max="180"][min="-180"]');
  if (hue) {
    const hr = hue.getBoundingClientRect();
    await moveTo(hr.left + hr.width / 2, hr.top + hr.height / 2);
    await ripple();
    for (let i = 0; i <= 24; i++) {
      const v = -Math.round((i / 24) * 48);
      a.test.set('hue', v);
      cursor.style.transition = 'none';
      cursor.style.transform = `translate(${hr.left + hr.width / 2 + (v / 360) * hr.width}px, ${hr.top + hr.height / 2}px)`;
      await sleep(40);
    }
    at = { x: hr.left + hr.width / 2 - (48 / 360) * hr.width, y: hr.top + hr.height / 2 };
  }
  await sleep(1300);
  // A portrait: Remove background, from the command search.
  const photo = workspace.findByPath(join(dir, 'portrait.jpg'))!;
  await click(document.querySelector<HTMLElement>(`.tab[data-tab="${photo.id}"]`)!);
  await sleep(900);
  await palette('remove backg');
  await sleep(600);
  await cut(waitFor(() => (document.body.textContent?.includes('Background removed') ? true : null), 'background removed', 30000));
  await sleep(2400);
}

/** Writing Markdown with a live preview, a diagram included. */
async function markdown(dir: string) {
  const tab = workspace.findByPath(join(dir, 'notes', 'Packing.md'))!;
  const el = await waitFor(() => pane(tab)?.querySelector<HTMLElement>('.cm-editor'), 'editor');
  const view = EditorView.findFromDOM(el)!;
  await sleep(700);
  const c = centre(el);
  await moveTo(c.x, c.y + 120);
  await ripple();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  await typeCode(view, '- sunglasses\n\n## Before we go\n\n1. **print** the boarding passes\n2. water the plants\n\n');
  // The diagram a line at a time (half a line of Mermaid is an error).
  for (const line of ['```mermaid\n', 'flowchart LR\n', '  Pack --> Fly\n', '  Fly --> Tram --> Nata\n', '```\n']) {
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: line }, selection: { anchor: pos + line.length }, userEvent: 'input.paste', scrollIntoView: true });
    await sleep(420);
  }
  await sleep(2600);
}

/** Search for a command, then four files side by side. */
async function split(dir: string) {
  const glb = workspace.tabs.at(-1)!;
  await sleep(600);
  await palette('split four');
  await sleep(500);
  await spin(glb, 4);
  await sleep(1200);
  // Move between the views.
  for (const t of workspace.tabs.slice(0, 3)) {
    const p = pane(t);
    if (p) await click(p, 0, 40);
    await sleep(500);
  }
  await sleep(1400);
}

const FILES = ['notes/Plan (draft).md', 'Plan.md', 'Lisbon guide.pdf', 'tram-28.png', 'Budget.xlsx', 'azulejo.svg', 'souvenir.glb', 'Fado sketch.wav', 'Sunset.webm', 'portrait.jpg', 'notes/Packing.md'];

const SCENES: Record<string, (dir: string) => Promise<void>> = { tour, image, markdown, split };

// Stills for the gallery ("still-<name>"): the folder open, one view staged.
const open = (f: string) => (d: string) => workspace.openPath(join(d, f)).then(() => undefined);
const STILLS: Record<string, (dir: string) => Promise<void>> = {
  start: async () => undefined,
  markdown: open('Plan.md'),
  pdf: open('Lisbon guide.pdf'),
  spreadsheet: open('Budget.xlsx'),
  svg: open('azulejo.svg'),
  model3d: async (d) => {
    const t = (await workspace.openPath(join(d, 'souvenir.glb')))!;
    await spin(t, 2);
  },
  audio: open('Fado sketch.wav'),
  video: open('Sunset.webm'),
  compare: async (d) => {
    compareFiles(join(d, 'notes', 'Plan (draft).md'), join(d, 'Plan.md'));
  },
  word: open('Itinerary.docx'),
  json: async (d) => {
    const t = (await workspace.openPath(join(d, 'itinerary.json')))!;
    const tree = await waitFor(() => (t as unknown as { dataTest?: { tree: () => { expandAll: () => Promise<void> } | undefined } }).dataTest?.tree(), 'JSON tree');
    await sleep(500);
    await tree.expandAll();
  },
  html: open('trip.html'),
  archive: open('photos.zip'),
  checksums: open('SHA256SUMS'),
  palette: async () => {
    ui.openPalette('pdf');
  },
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
    await workspace.openPath(join(dir, 'portrait.jpg'));
    await workspace.openPath(join(dir, 'tram-28.png'));
  }
  if (scene === 'markdown') await workspace.openPath(join(dir, 'notes', 'Packing.md'));
  if (scene === 'split') for (const f of ['Plan.md', 'Lisbon guide.pdf', 'tram-28.png', 'souvenir.glb']) await workspace.openPath(join(dir, f));
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
