// Parses and lays out DOT graphs off the main thread.
import { DotError, parseDot } from './dot';
import { layoutDot } from './dotLayout';

const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext('2d')!;
const widths = new Map<string, number>();

function measure(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (widths.size > 50_000) widths.clear();
    widths.set(key, w);
  }
  return w;
}

self.onmessage = (e: MessageEvent<{ id: number; src: string }>) => {
  const { id, src } = e.data;
  try {
    const l = layoutDot(parseDot(src), measure);
    (self as unknown as Worker).postMessage({ id, svg: l.svg, width: l.width, height: l.height, nodes: l.nodes, edges: l.edges });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err), line: err instanceof DotError ? err.line : 0 });
  }
};
