// Frontend side of the background job API (internal/jobs). Any backend call
// that returns a job id can be awaited here; progress shows in the status bar
// once a job has run for more than 300 ms.
import { api, on } from './backend';

export interface JobProgress {
  id: string;
  kind: string;
  label: string;
  done: number;
  total: number;
  message: string;
}

export interface JobDone<T = unknown> {
  id: string;
  kind: string;
  result: T;
  error: string;
  cancelled: boolean;
  millis: number;
}

export interface JobView extends JobProgress {
  visible: boolean;
  started: number;
}

interface Pending {
  resolve: (d: JobDone) => void;
  onData?: (items: any) => void;
  onProgress?: (p: JobProgress) => void;
  view: JobView;
}

export const SHOW_AFTER_MS = 300;

class JobsState {
  list = $state<JobView[]>([]);
  private pending = new Map<string, Pending>();
  // Events can arrive before start() has registered the id.
  private early = new Map<string, { data: any[]; progress?: JobProgress; done?: JobDone }>();
  private wired = false;

  wire() {
    if (this.wired) return;
    this.wired = true;
    on<JobProgress>('job:progress', (p) => {
      const pend = this.pending.get(p.id);
      if (!pend) {
        this.earlyOf(p.id).progress = p;
        return;
      }
      Object.assign(pend.view, { done: p.done, total: p.total, message: p.message });
      this.refresh(pend.view);
      pend.onProgress?.(p);
    });
    on<{ id: string; items: any }>('job:data', (d) => {
      const pend = this.pending.get(d.id);
      if (!pend) {
        this.earlyOf(d.id).data.push(d.items);
        return;
      }
      pend.onData?.(d.items);
    });
    on<JobDone>('job:done', (d) => {
      const pend = this.pending.get(d.id);
      if (!pend) {
        this.earlyOf(d.id).done = d;
        return;
      }
      this.finish(d.id, d);
    });
  }

  private earlyOf(id: string) {
    let e = this.early.get(id);
    if (!e) this.early.set(id, (e = { data: [] }));
    return e;
  }

  /**
   * Await a job started by `start()` (a binding returning the job id).
   * Resolves when the job ends (also on error/cancel; inspect the result).
   */
  async run<T = unknown>(
    label: string,
    start: () => Promise<string>,
    opts: { onData?: (items: any) => void; onProgress?: (p: JobProgress) => void; silent?: boolean } = {},
  ): Promise<JobDone<T>> {
    this.wire();
    const id = await start();
    return new Promise<JobDone<T>>((resolve) => {
      const view: JobView = { id, kind: '', label, done: 0, total: 0, message: '', visible: false, started: Date.now() };
      const pend: Pending = { resolve: resolve as (d: JobDone) => void, onData: opts.onData, onProgress: opts.onProgress, view };
      this.pending.set(id, pend);
      if (!opts.silent) {
        this.list = [...this.list, view];
        setTimeout(() => {
          // Mark the canonical view; list entries are copies made by refresh().
          view.visible = true;
          this.refresh(view);
        }, SHOW_AFTER_MS);
      }
      const early = this.early.get(id);
      if (early) {
        this.early.delete(id);
        for (const items of early.data) opts.onData?.(items);
        if (early.progress) Object.assign(view, early.progress);
        if (early.done) this.finish(id, early.done);
      }
    });
  }

  cancel(id: string) {
    void api.CancelJob(id);
  }

  private refresh(view: JobView) {
    const i = this.list.findIndex((j) => j.id === view.id);
    if (i >= 0) this.list[i] = { ...view };
  }

  private finish(id: string, d: JobDone) {
    const pend = this.pending.get(id);
    if (!pend) return;
    this.pending.delete(id);
    this.list = this.list.filter((j) => j.id !== id);
    pend.resolve(d);
  }
}

export const jobs = new JobsState();
