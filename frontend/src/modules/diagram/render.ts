// Renders diagram sources to SVG: Graphviz DOT in a worker (own parser +
// dagre), Mermaid on the main thread (it needs the DOM to measure text), one
// diagram at a time. Results are cached by source so re-rendering a Markdown
// preview only draws what changed.
import DotWorker from './dotWorker?worker';
import type { DiagramKind } from './fence';

export type { DiagramKind };
export { kindOfFence } from './fence';

export interface DiagramResult {
  svg?: string;
  error?: string;
  line?: number;
  width?: number;
  height?: number;
}

const cache = new Map<string, DiagramResult>();
const CACHE_MAX = 200;

export function kindOfPath(path: string): DiagramKind {
  return /\.(mmd|mermaid)$/i.test(path) ? 'mermaid' : 'dot';
}

export function cached(kind: DiagramKind, src: string): DiagramResult | undefined {
  return cache.get(`${kind}\u0000${src}`);
}

function remember(kind: DiagramKind, src: string, r: DiagramResult) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(`${kind}\u0000${src}`, r);
}

// ---- DOT ----

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: DiagramResult) => void>();

function dot(src: string): Promise<DiagramResult> {
  if (!worker) {
    worker = new DotWorker();
    worker.onmessage = (e) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data);
    };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, src });
  });
}

// ---- Mermaid ----

type Mermaid = typeof import('mermaid').default;
let mermaidP: Promise<Mermaid> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let mid = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidP ??= import('mermaid').then((m) => {
    const mm = m.default;
    mm.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: 'Inter Variable, system-ui, sans-serif',
      // SVG text instead of HTML labels: exports to PNG and embeds cleanly.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    return mm;
  });
  return mermaidP;
}

function mermaid(src: string): Promise<DiagramResult> {
  const run = async (): Promise<DiagramResult> => {
    const mm = await loadMermaid();
    // Let a frame through between diagrams.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const id = `hia-mermaid-${++mid}`;
    try {
      const { svg } = await mm.render(id, src);
      const vb = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
      return { svg, width: vb ? Number(vb[1]) : undefined, height: vb ? Number(vb[2]) : undefined };
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      const msg = e instanceof Error ? e.message : String(e);
      const line = /line (\d+)/i.exec(msg);
      return { error: msg.split('\n').slice(0, 4).join('\n'), line: line ? Number(line[1]) : 0 };
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

export async function renderDiagram(kind: DiagramKind, src: string): Promise<DiagramResult> {
  const hit = cached(kind, src);
  if (hit) return hit;
  const r = kind === 'dot' ? await dot(src) : await mermaid(src);
  remember(kind, src, r);
  return r;
}

/**
 * Draws every diagram placeholder (div.diagram with a pre.diagram-src) inside
 * root. Cached ones are filled synchronously, so a re-rendered preview
 * doesn't flicker.
 */
export function fillDiagrams(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('div.diagram:not([data-done])')) {
    const kind = el.dataset.kind as DiagramKind;
    const src = el.querySelector('pre.diagram-src')?.textContent ?? '';
    const show = (r: DiagramResult) => {
      el.dataset.done = '1';
      if (r.svg) {
        el.classList.remove('error');
        el.innerHTML = r.svg;
      } else {
        el.classList.add('error');
        const msg = document.createElement('div');
        msg.className = 'diagram-error';
        msg.textContent = `${kind === 'dot' ? 'Graphviz' : 'Mermaid'}: ${r.error ?? 'could not draw this diagram'}`;
        el.prepend(msg);
      }
    };
    const hit = cached(kind, src);
    if (hit) show(hit);
    else {
      el.classList.add('loading');
      void renderDiagram(kind, src).then((r) => {
        el.classList.remove('loading');
        if (el.isConnected) show(r);
      });
    }
  }
}
