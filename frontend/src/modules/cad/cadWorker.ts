// Owns the open DXF: reads and decodes it, applies edits, builds the scene
// the page draws and writes the file back. The page thread only gets flat
// arrays to draw, so big drawings never stall the UI.
import { fetchBytes } from '../../core/fetchbytes';
import { uploadParts } from '../../core/upload';
import { decode, detectEncoding, encode, SINGLE_BYTE, type Encoding } from '../text/encoding';
import { CadDoc } from './doc';
import { build, layerColor, layerHidden, type Scene } from './geometry';
import { fittedHeight, Painter, renderFitted, type View } from './paint';

let doc: CadDoc | null = null;
let encoding: Encoding = 'utf-8';
let hidden = new Set<string>();
let scene: Scene | null = null;
let painter: Painter | null = null;
let canvas: OffscreenCanvas | null = null;

/** Can this worker draw (OffscreenCanvas + Path2D)? Then the page never rasterises big drawings itself. */
const canRender = (() => {
  try {
    return typeof OffscreenCanvas !== 'undefined' && typeof Path2D !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d');
  } catch {
    return false;
  }
})();

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

export interface LayerInfo {
  name: string;
  color: number; // 0xRRGGBB or -1 (foreground)
  aci: number;
  off: boolean; // off or frozen in the file
  hidden: boolean; // hidden in this viewer only
  locked: boolean;
  count: number;
}

export interface CadInfo {
  version: string;
  units: number;
  encoding: string;
  entities: number;
  counts: Record<string, number>;
  layers: LayerInfo[];
  blocks: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

function info(): CadInfo {
  const d = doc!.d;
  const count = new Map<string, number>();
  for (const e of d.entities) count.set(e.layer, (count.get(e.layer) ?? 0) + 1);
  const names = [...new Set([...d.layers.keys(), ...count.keys()])];
  return {
    version: d.version,
    units: d.units,
    encoding,
    entities: d.entities.length,
    counts: doc!.counts(),
    layers: names.map((name) => {
      const l = d.layers.get(name);
      return { name, color: layerColor(d, name), aci: Math.abs(l?.color ?? 7), off: layerHidden(d, name), hidden: hidden.has(name), locked: !!l?.locked, count: count.get(name) ?? 0 };
    }),
    blocks: [...d.blocks.keys()].filter((b) => !b.startsWith('*')).length,
    dirty: doc!.dirty,
    canUndo: doc!.canUndo,
    canRedo: doc!.canRedo,
  };
}

function reply(id: number, extra: Record<string, unknown> = {}) {
  const t0 = performance.now();
  scene = build(doc!.d, hidden);
  painter = null;
  const ms = Math.round(performance.now() - t0);
  // Copied, not transferred: the worker keeps the scene to draw it.
  post({ id, ok: true, info: info(), scene, buildMs: ms, canRender, ...extra });
}

function decodeDxf(bytes: Uint8Array): string {
  encoding = detectEncoding(bytes);
  let text = decode(bytes, encoding);
  if (encoding === 'windows-1252') {
    // Pre-2007 files name their code page in the header.
    const m = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/.exec(text.slice(0, 1 << 16));
    const cp = m ? `windows-${m[1]}` : '';
    if (cp && cp !== encoding && SINGLE_BYTE.includes(cp)) {
      encoding = cp;
      text = decode(bytes, encoding);
    }
  }
  return text;
}

/** Encode for saving; characters the code page lacks become DXF \U+XXXX escapes. */
function encodeDxf(text: string): Uint8Array {
  try {
    return encode(text, encoding, false);
  } catch {
    let out = '';
    for (const ch of text) {
      if (ch.charCodeAt(0) < 0x80) out += ch;
      else
        try {
          encode(ch, encoding);
          out += ch;
        } catch {
          out += [...ch].map((c) => `\\U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join('');
        }
    }
    return encode(out, encoding, false);
  }
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'load': {
        const bytes = await fetchBytes(m.url, (done, total) => post({ type: 'progress', phase: 'Reading', done, total }));
        post({ type: 'progress', phase: 'Reading drawing', done: 0, total: 0 });
        doc = new CadDoc(decodeDxf(bytes));
        hidden = new Set();
        return reply(m.id);
      }
      case 'transform': {
        const r = doc!.transform(m.ids, m.m);
        return reply(m.id, { select: m.ids, skipped: r.skipped });
      }
      case 'copy': {
        const r = doc!.copy(m.ids, m.m);
        return reply(m.id, { select: r.added, skipped: r.skipped });
      }
      case 'remove':
        doc!.remove(m.ids);
        return reply(m.id, { select: [] });
      case 'add':
        return reply(m.id, { select: doc!.add(m.list) });
      case 'setLayer':
        doc!.setLayer(m.ids, m.layer);
        return reply(m.id, { select: m.ids });
      case 'setColor':
        doc!.setColor(m.ids, m.color);
        return reply(m.id, { select: m.ids });
      case 'setProp':
        doc!.setProp(m.index, m.code, m.occ, m.value);
        return reply(m.id, { select: [m.index] });
      case 'undo':
      case 'redo':
        if (!(m.type === 'undo' ? doc!.undo() : doc!.redo())) return post({ id: m.id, ok: true, info: info() });
        return reply(m.id, { select: [] });
      case 'hidden':
        hidden = new Set(m.names);
        return reply(m.id);
      case 'render': {
        // One frame of the drawing for the page (it scales the last frame while this one renders).
        if (!canRender || !scene) return post({ id: m.id, ok: true, bmp: null });
        const v: View = m.view;
        const w = Math.max(1, Math.round(m.w * m.dpr));
        const h = Math.max(1, Math.round(m.h * m.dpr));
        if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        painter ??= new Painter(scene);
        const t0 = performance.now();
        painter.draw(ctx, v, m.dpr, m.dark, m.w, m.h);
        const bmp = canvas.transferToImageBitmap();
        return post({ id: m.id, ok: true, bmp, ms: performance.now() - t0 }, [bmp]);
      }
      case 'png': {
        if (!canRender || !scene?.bounds) return post({ id: m.id, ok: true, blob: null });
        const H = fittedHeight(scene, m.w);
        const c = new OffscreenCanvas(m.w, H);
        renderFitted(c.getContext('2d')!, scene, m.w, H);
        return post({ id: m.id, ok: true, blob: await c.convertToBlob({ type: 'image/png' }) });
      }
      case 'props':
        return post({ id: m.id, ok: true, props: doc!.props(m.index) });
      case 'save': {
        const bytes = encodeDxf(doc!.text());
        const urlFor = (p: string, q: Record<string, string>) => `/__mf/${p}?${new URLSearchParams({ t: m.token, ...q })}`;
        const entry = await uploadParts(urlFor, m.path, [bytes], (done, total) => post({ type: 'progress', phase: 'Saving', done, total }));
        doc!.markSaved();
        return post({ id: m.id, ok: true, entry, info: info() });
      }
    }
  } catch (e) {
    post({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
