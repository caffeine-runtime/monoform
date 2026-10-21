// Layout audit (not in CI): opens one file of each kind, squeezes the main
// area to several widths and logs wrapped UI text and bars whose content
// doesn't fit. Arg: fixtures dir.
import { api } from '../core/backend';
import { WindowSetSize } from '../wailsjs/runtime/runtime';
import { join } from '../core/paths';
import { commands } from '../core/commands';
import { compareFiles } from '../core/compare';
import { workspace } from '../core/tabs.svelte';
import { log, sleep } from './harness';

const CONTENT = '.cm-editor, .cm-content, .preview, .markdown-body, .page, .pages, [contenteditable], td, .cell, .grid, svg, canvas, .tree, .filetree, .list, .rows, .doc, .sheet, .text, .log-line, .hexview, .empty-state p, .help, .hint, .desc, .note, .dlg p';

function lines(node: Text): number {
  const r = document.createRange();
  r.selectNodeContents(node);
  const tops = new Set<number>();
  for (const rect of r.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top / 4));
  return tops.size;
}

function path(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && parts.length < 4 && !e.classList.contains('tabview'); e = e.parentElement) {
    parts.unshift(e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''));
  }
  return parts.join('>');
}

export function audit(root: Element): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const t = n.textContent?.trim();
    const p = n.parentElement;
    if (!t || !p || p.closest(CONTENT) || !p.getClientRects().length) continue;
    if (getComputedStyle(p).visibility === 'hidden') continue;
    const l = lines(n);
    if (l > 1) out.push(`wrap(${l}) "${t.slice(0, 30)}" in ${path(p)} w=${Math.round(p.getBoundingClientRect().width)}`);
  }
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.closest(CONTENT) || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (!/auto|scroll|hidden/.test(cs.overflowX) || el.scrollWidth <= el.clientWidth + 2) continue;
    if (!el.querySelector('button, .btn, input, select')) continue;
    out.push(`overflow ${path(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  for (const bar of root.querySelectorAll<HTMLElement>('.fit')) {
    if (!bar.getClientRects().length) continue;
    const r = bar.getBoundingClientRect();
    for (const c of bar.querySelectorAll<HTMLElement>('button, input, select, .seg')) {
      const cr = c.getBoundingClientRect();
      if (cr.width && (cr.right > r.right + 1 || cr.left < r.left - 1)) out.push(`clipped "${c.textContent?.trim().slice(0, 20) || c.title}" in ${path(bar)} ${Math.round(cr.right)}>${Math.round(r.right)}`);
    }
  }
  return out;
}

const style = document.createElement('style');
async function at(width: number) {
  style.textContent = `main.main { flex: none !important; width: ${width}px !important; max-width: ${width}px !important; }`;
  await sleep(250);
}

/** "dir|file1,file2|w1,w2": screenshots of those files at those widths (paths logged). */
async function shots(dir: string, files: string, widths: string) {
  for (const f of files.split(',')) {
    for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
    if (f === '@settings') commands.execute('app.settings');
    else if (f === '@compare') compareFiles(join(dir, 'compare', 'a.json'), join(dir, 'compare', 'b.json'));
    else if (f) await workspace.openPath(join(dir, f));
    await sleep(1500);
    for (const w of widths.split(',')) {
      await at(Number(w));
      await sleep(1100); // screenshot names have one-second resolution
      const r = await api.ScreenCapture('screen', 0, false);
      log(`SHOT ${f}@${w} ${r.path}`);
    }
  }
}

export default async function uiaudit(arg: string) {
  document.head.append(style);
  const [dir, shotFiles, widths] = arg.split('|');
  if (shotFiles) return shots(dir, shotFiles, widths);
  const files = [
    '', 'notes/index.md', 'code/sample.ts', 'data/people.json', 'data/grid.csv', 'data/events.jsonl', 'logs/app.log', 'config/app.ini', 'certs/chain.pem',
    'img/photo.png', 'img/anim.gif', 'diagrams/build.dot', 'drawings/flow.drawio', 'drawings/sketch.excalidraw', 'pdf/three.pdf', 'office/report.docx',
    'office/budget.xlsx', 'office/notes.odt', 'archives/sample.zip', 'packages/mf-test.deb', 'db/shop.db', 'cad/plan.dxf', 'models/cube.stl',
    'audio/tone.mp3', 'video/clip.webm', 'fonts/test.ttf', 'web/index.html', 'hash/SHA256SUMS', 'compare/a.bin', '@settings', '@compare',
  ];
  for (const f of files) {
    for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
    if (f === '@settings') commands.execute('app.settings');
    else if (f === '@compare') compareFiles(join(dir, 'compare', 'a.json'), join(dir, 'compare', 'b.json'));
    else if (f) await workspace.openPath(join(dir, f));
    await sleep(1200);
    for (const width of [1100, 760, 560, 420, 320]) {
      await at(width);
      const root = document.querySelector('.tabview.active') ?? document.querySelector('main.main')!;
      const found = [...new Set(audit(root))];
      if (width === 1100)
        for (const b of root.querySelectorAll<HTMLElement>('.toolbar button, .toolbar .btn, .selbar button, .seg button, .bar button'))
          if (!b.querySelector('svg') && b.textContent?.trim()) found.push(`noicon "${b.textContent.trim().slice(0, 30)}" in ${path(b)}`);
      for (const s of found) log(`AUDIT ${f || 'start'} @${width}: ${s}`);
    }
  }
  // The whole window at its smallest size, with a file open.
  style.textContent = '';
  await workspace.openPath(join(dir, 'data/grid.csv'));
  WindowSetSize(640, 400);
  await sleep(800);
  log(`window ${window.innerWidth}×${window.innerHeight}`);
  for (const s of audit(document.querySelector('.app')!)) log(`AUDIT window640: ${s}`);
}
