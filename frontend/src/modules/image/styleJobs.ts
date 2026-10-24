// Main-thread side of the layer-style worker: started on first use, stopped
// after a minute idle. renderStyleNow does the same work here, for when a
// picture is needed at once (saving, copying, merging).
import { renderStyle, type LayerStyle } from './styles';
import type { StyleIn, StyleOut } from './styleWorker';

export interface StyleFx {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: StyleOut) => void>();
let idle: ReturnType<typeof setTimeout> | undefined;

async function ensure(): Promise<Worker> {
  if (worker) return worker;
  const { default: W } = await import('./styleWorker?worker');
  const w = new W();
  w.onmessage = (e: MessageEvent<StyleOut>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    p?.(e.data);
    if (!pending.size) idle = setTimeout(stop, 60_000);
  };
  w.onerror = () => {
    for (const p of pending.values()) p({ id: 0, fx: null, x: 0, y: 0 });
    pending.clear();
    stop();
  };
  worker = w;
  return w;
}

function stop() {
  worker?.terminate();
  worker = null;
}

/** The effects of a style for a layer's content (in its own pixels), worked out in the worker. */
export async function renderStyleLater(content: HTMLCanvasElement, style: LayerStyle): Promise<StyleFx | null> {
  clearTimeout(idle);
  const image = await createImageBitmap(content);
  const w = await ensure();
  const id = ++seq;
  const r = await new Promise<StyleOut>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, image, style: JSON.parse(JSON.stringify(style)) } satisfies StyleIn, [image]);
  });
  return r.fx ? { image: r.fx, x: r.x, y: r.y, width: r.fx.width, height: r.fx.height } : null;
}

/** The same, here and now. */
export function renderStyleNow(content: HTMLCanvasElement, style: LayerStyle): StyleFx | null {
  const w = content.width;
  const h = content.height;
  const px = content.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  const r = renderStyle(alpha, w, h, style);
  if (!r) return null;
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.w, r.h), 0, 0);
  return { image: c, x: r.x, y: r.y, width: r.w, height: r.h };
}
