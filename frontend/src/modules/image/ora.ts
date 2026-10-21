// OpenRaster (.ora): an open layered image format (a zip of PNG layers plus
// stack.xml) read by GIMP, Krita and MyPaint. Used to save work with its
// layers. Text and shapes are flattened into their layer's pixels; we also
// store their Konva description in a namespaced attribute so Monoform
// can reopen them editable (other apps ignore it). A layer mask is applied
// to the layer's PNG too; the unmasked pixels and the mask are stored beside
// it (mf:raw, mf:mask) so the mask stays editable here. Files saved before the
// rename to Monoform used the hia: prefix and namespace; both are read.
import { endpoint } from '../../core/backend';

export interface OraLayer {
  name: string;
  png: Blob;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  composite: string; // ORA composite-op, e.g. "svg:src-over"
  objects?: string; // JSON array of Konva nodes (ours)
  /** Our layer mask: the entry with its PNG (alpha = shown), and whether it is on. */
  mask?: { src: string; on: boolean };
  /** Our entry with the layer's pixels before markup and mask. */
  raw?: string;
}

export interface OraImage {
  width: number;
  height: number;
  layers: OraLayer[]; // bottom first
  merged: Blob;
  thumbnail: Blob;
  /** Additional entries (our markup-free rasters). */
  extra?: ({ name: string; png: Blob } | null)[];
}

const BLEND_TO_ORA: Record<string, string> = {
  'source-over': 'svg:src-over',
  multiply: 'svg:multiply',
  screen: 'svg:screen',
  overlay: 'svg:overlay',
  darken: 'svg:darken',
  lighten: 'svg:lighten',
  'color-dodge': 'svg:color-dodge',
  'color-burn': 'svg:color-burn',
  'hard-light': 'svg:hard-light',
  'soft-light': 'svg:soft-light',
  difference: 'svg:difference',
  hue: 'svg:hue',
  saturation: 'svg:saturation',
  color: 'svg:color',
  luminosity: 'svg:luminosity',
};
export const oraToBlend = (op: string | null): GlobalCompositeOperation =>
  ((Object.entries(BLEND_TO_ORA).find(([, v]) => v === op)?.[0] ?? 'source-over') as GlobalCompositeOperation);
export const blendToOra = (b: string) => BLEND_TO_ORA[b] ?? 'svg:src-over';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Build the .ora file. Zipping (CRC32) runs in a worker. */
export async function writeOra(img: OraImage): Promise<ArrayBuffer> {
  // stack.xml lists layers top first.
  const top = [...img.layers].reverse();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${img.width}" h="${img.height}" xmlns:mf="https://monoform.dev/ora">\n <stack>\n` +
    top
      .map(
        (l, i) =>
          `  <layer name="${esc(l.name)}" src="data/layer${top.length - 1 - i}.png" x="${Math.round(l.x)}" y="${Math.round(l.y)}" opacity="${l.opacity.toFixed(3)}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${l.composite}"${l.objects ? ` mf:objects="${esc(l.objects)}"` : ''}${l.raw ? ` mf:raw="${esc(l.raw)}"` : ''}${l.mask ? ` mf:mask="${esc(l.mask.src)}"${l.mask.on ? '' : ' mf:mask-off="1"'}` : ''}/>`,
      )
      .join('\n') +
    `\n </stack>\n</image>\n`;
  const files: { name: string; data: ArrayBuffer }[] = [
    { name: 'mimetype', data: new TextEncoder().encode('image/openraster').buffer as ArrayBuffer },
    { name: 'stack.xml', data: new TextEncoder().encode(xml).buffer as ArrayBuffer },
  ];
  for (let i = 0; i < img.layers.length; i++) files.push({ name: `data/layer${i}.png`, data: await img.layers[i].png.arrayBuffer() });
  for (const x of img.extra ?? []) if (x) files.push({ name: x.name, data: await x.png.arrayBuffer() });
  files.push({ name: 'mergedimage.png', data: await img.merged.arrayBuffer() });
  files.push({ name: 'Thumbnails/thumbnail.png', data: await img.thumbnail.arrayBuffer() });
  const { default: ZipWorker } = await import('./zipWorker?worker');
  const w = new ZipWorker();
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<ArrayBuffer>) => resolve(e.data);
      w.onerror = (e) => reject(new Error(e.message || 'zip failed'));
      w.postMessage(files, files.map((f) => f.data));
    });
  } finally {
    w.terminate();
  }
}

export interface OraStackLayer {
  name: string;
  src: string;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  blend: GlobalCompositeOperation;
  objects?: string;
  mask?: { src: string; on: boolean };
  raw?: string;
}

const OLD_NS = 'https://holditall.dev/ora'; // before the rename to Monoform
const attr = (l: Element, name: string) =>
  l.getAttribute(`mf:${name}`) ?? l.getAttributeNS('https://monoform.dev/ora', name) ?? l.getAttribute(`hia:${name}`) ?? l.getAttributeNS(OLD_NS, name) ?? undefined;

/** Read an .ora file from disk through the zip endpoint. Layers bottom first. */
export async function readOra(path: string): Promise<{ width: number; height: number; layers: (OraStackLayer & { bitmap: ImageBitmap })[] }> {
  const entry = async (name: string) => {
    const r = await fetch(endpoint('zip', { path, entry: name }));
    if (!r.ok) throw new Error(`${name} missing in the .ora file`);
    return r;
  };
  const doc = new DOMParser().parseFromString(await (await entry('stack.xml')).text(), 'application/xml');
  const image = doc.querySelector('image');
  if (!image) throw new Error('not an OpenRaster file');
  const width = Number(image.getAttribute('w'));
  const height = Number(image.getAttribute('h'));
  // Nested stacks are flattened in document order.
  const stackLayers = [...doc.querySelectorAll('layer')].map<OraStackLayer>((l) => ({
    name: l.getAttribute('name') ?? 'Layer',
    src: l.getAttribute('src') ?? '',
    x: Number(l.getAttribute('x') ?? 0),
    y: Number(l.getAttribute('y') ?? 0),
    opacity: Number(l.getAttribute('opacity') ?? 1),
    visible: (l.getAttribute('visibility') ?? 'visible') !== 'hidden',
    blend: oraToBlend(l.getAttribute('composite-op')),
    objects: attr(l, 'objects'),
    mask: attr(l, 'mask') ? { src: attr(l, 'mask')!, on: attr(l, 'mask-off') !== '1' } : undefined,
    raw: attr(l, 'raw'),
  }));
  const layers = await Promise.all(
    stackLayers
      .filter((l) => l.src.toLowerCase().endsWith('.png'))
      .reverse()
      .map(async (l) => ({ ...l, bitmap: await createImageBitmap(await (await entry(l.src)).blob()) })),
  );
  if (!width || !height || !layers.length) throw new Error('the .ora file has no image layers');
  return { width, height, layers };
}
