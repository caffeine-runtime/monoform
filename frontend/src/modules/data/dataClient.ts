import DataWorker from './dataWorker?worker';
import type { TreeNode } from './dataWorker';
import type { JsonError } from './jsonparse';

export type { TreeNode };

export class DataClient {
  private w = new DataWorker();
  private seq = 0;
  private waiting = new Map<number, (v: any) => void>();

  constructor() {
    this.w.onmessage = (e) => {
      const r = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      r?.(e.data);
    };
  }

  private call<T>(msg: object): Promise<T> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.w.postMessage({ ...msg, id });
    });
  }

  parse(text: string, format: string) {
    return this.call<{ ok: boolean; error?: JsonError; root?: TreeNode; documents?: number; table?: string[] }>({ type: 'parse', text, format });
  }

  children(path: (string | number)[], offset = 0, limit = 500) {
    return this.call<{ nodes: TreeNode[]; total: number }>({ type: 'children', path, offset, limit });
  }

  rows(start: number, end: number) {
    return this.call<{ rows: string[][] }>({ type: 'rows', start, end });
  }

  stringify(indent: number, path?: (string | number)[]) {
    return this.call<{ text?: string; error?: string }>({ type: 'stringify', indent, path });
  }

  destroy() {
    this.w.terminate();
  }
}
