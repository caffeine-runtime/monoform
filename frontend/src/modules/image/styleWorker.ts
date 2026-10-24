// Layer styles off the main thread: the layer's pixels in, the picture of its
// effects (shadow, glow, stroke) out, with where it goes (styles.ts).
import { renderStyle, type LayerStyle } from './styles';

export interface StyleIn {
  id: number;
  image: ImageBitmap;
  style: LayerStyle;
}
export interface StyleOut {
  id: number;
  fx: ImageBitmap | null;
  x: number;
  y: number;
}

self.onmessage = (e: MessageEvent<StyleIn>) => {
  const { id, image, style } = e.data;
  const w = image.width;
  const h = image.height;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0);
  image.close();
  const px = g.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  const r = renderStyle(alpha, w, h, style);
  if (!r) {
    (self as unknown as Worker).postMessage({ id, fx: null, x: 0, y: 0 } satisfies StyleOut);
    return;
  }
  const out = new OffscreenCanvas(r.w, r.h);
  out.getContext('2d')!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.w, r.h), 0, 0);
  const fx = out.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ id, fx, x: r.x, y: r.y } satisfies StyleOut, [fx]);
};
