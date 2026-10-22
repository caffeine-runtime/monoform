// Promise wrapper around the compare worker.
import DiffWorker from './diffWorker?worker';

export class DiffClient {
  private w = new DiffWorker();
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onProgress?: (phase: string, done: number, total: number) => void;

  constructor() {
    this.w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') return this.onProgress?.(m.phase, m.done, m.total);
      const p = this.waiting.get(m.id);
      if (!p) return;
      this.waiting.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error));
    };
  }

  call<T = any>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.w.postMessage({ ...msg, id });
    });
  }

  destroy() {
    this.w.terminate();
    for (const p of this.waiting.values()) p.reject(new Error('closed')); // i18n-ignore: internal, never shown
    this.waiting.clear();
  }
}
