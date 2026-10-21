// Main-thread side of the vision worker: started on first use, terminated
// after a minute idle so the models' memory is returned.
import type { ErasePatch, EraseStarted, MaskResult, VisionIn, VisionOut } from './visionWorker';
import type { Rect } from './erase';

const IDLE_MS = 60_000;

type Omit2<T> = T extends unknown ? Omit<T, 'id'> : never;

class Vision {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  /** Key of the image the worker has analysed for object selection. */
  samKey = '';

  private async ensure(): Promise<Worker> {
    if (this.worker) return this.worker;
    const { default: W } = await import('./visionWorker?worker');
    const w = new W();
    w.onmessage = (e: MessageEvent<VisionOut>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (!p) return;
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
      this.armIdle();
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'image analysis failed'));
      this.pending.clear();
      this.stop();
    };
    this.worker = w;
    return w;
  }

  private armIdle() {
    clearTimeout(this.idle);
    if (!this.pending.size) this.idle = setTimeout(() => this.stop(), IDLE_MS);
  }

  private async call<T>(msg: Omit2<VisionIn>, transfer: Transferable[]): Promise<T> {
    clearTimeout(this.idle);
    const w = await this.ensure();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  async wand(src: CanvasImageSource, x: number, y: number, tolerance: number, contiguous: boolean): Promise<MaskResult> {
    const image = await createImageBitmap(src as ImageBitmapSource);
    return this.call({ type: 'wand', image, x, y, tolerance, contiguous }, [image]);
  }

  async removeBackground(src: CanvasImageSource): Promise<MaskResult> {
    const image = await createImageBitmap(src as ImageBitmapSource);
    return this.call({ type: 'removeBg', image }, [image]);
  }

  /** Analyse an image for object selection (slow, once per image). */
  async analyse(src: CanvasImageSource, key: string): Promise<number> {
    const image = await createImageBitmap(src as ImageBitmapSource);
    const r = await this.call<{ millis: number }>({ type: 'samEncode', image, key }, [image]);
    this.samKey = key;
    return r.millis;
  }

  selectObject(key: string, points: { x: number; y: number; positive: boolean }[]): Promise<MaskResult> {
    return this.call({ type: 'samDecode', key, points }, []);
  }

  /** The subject with the optional BiRefNet model (base: endpoint('ai'), carrying the session token). */
  async subjectAI(src: CanvasImageSource, base: string): Promise<MaskResult> {
    const image = await createImageBitmap(src as ImageBitmapSource);
    return this.call({ type: 'aiSubject', image, base }, [image]);
  }

  /** Start removing what mask covers inside rect; returns the backend job and what finish needs. */
  async eraseBegin(src: CanvasImageSource, mask: CanvasImageSource, rect: Rect, base: string, seed: number): Promise<EraseStarted> {
    const image = await createImageBitmap(src as ImageBitmapSource);
    const m = await createImageBitmap(mask as ImageBitmapSource);
    return this.call({ type: 'eraseBegin', image, mask: m, rect, base, seed }, [image, m]);
  }

  /** The repainted patch (soft-edged, rect-sized) once the job is done. */
  eraseFinish(started: EraseStarted, base: string): Promise<ErasePatch> {
    return this.call({ type: 'eraseFinish', started, base }, []);
  }

  /** Outline of an arbitrary mask (inverted selections etc.). */
  async edges(mask: CanvasImageSource): Promise<MaskResult> {
    const image = await createImageBitmap(mask as ImageBitmapSource);
    return this.call({ type: 'edges', image }, [image]);
  }

  stop() {
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = null;
    this.samKey = '';
    for (const p of this.pending.values()) p.reject(new Error('stopped'));
    this.pending.clear();
  }
}

export const vision = new Vision();
export type { MaskResult };
