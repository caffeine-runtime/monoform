// Search by meaning (optional, off by default). Owns the embedding worker:
// started on first use, terminated after `settings.semantic.unloadAfter`
// idle seconds so its memory (~1 GB while loaded) goes back to the system.
// Go keeps the index; this side only turns text into vectors.
import { api, errorMessage, sessionToken } from '../backend';
import type { app, semantic as sem } from '../../wailsjs/go/models';
import { jobs } from '../jobs.svelte';
import { settings } from '../settings.svelte';
import { workspace } from '../tabs.svelte';
import { basename } from '../paths';
import type { EmbedIn, EmbedOut } from './embedWorker';

const DOC_TOKENS = 256;
const QUERY_TOKENS = 64;
const REINDEX_EVERY_MS = 10 * 60_000;

interface Request {
  texts: string[];
  maxTokens: number;
  resolve: (v: Float32Array[]) => void;
  reject: (e: Error) => void;
}

export type Hit = sem.Hit;

class SemanticState {
  info = $state<app.SemanticInfo | null>(null);
  /** Model state in the worker. */
  model = $state<'unloaded' | 'loading' | 'ready'>('unloaded');
  loadProgress = $state(0);
  indexing = $state<{ done: number; total: number } | null>(null);
  index = $state<{ files: number; passages: number; total: number } | null>(null);
  error = $state('');
  /** Measured embedding speed (tokens per second), for estimates. */
  tokensPerSec = $state(0);

  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private high: Request[] = [];
  private low: Request[] = [];
  private busy = false;
  private seq = 0;
  private waiting = new Map<number, { req: Request; started: number }>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private indexRun = 0;
  private lastIndex = 0;
  private started = false;

  get enabled() {
    return !!settings.value.semantic?.enabled;
  }

  get usable() {
    return this.enabled && !!this.info?.installed;
  }

  /** Called once after boot: index the open folder when the feature is on. */
  start() {
    if (this.started) return;
    this.started = true;
    $effect.root(() => {
      $effect(() => {
        const root = workspace.folder;
        const on = this.enabled;
        if (!on || !root) return;
        const t = setTimeout(() => void this.refresh().then(() => this.indexFolder(root)), 2000);
        return () => clearTimeout(t);
      });
    });
    setInterval(() => this.maybeReindex(), 60_000);
  }

  async refresh() {
    try {
      this.info = await api.SemanticInfo();
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Re-check the folder for changes if the last pass is old enough. */
  maybeReindex(minAgeMs = REINDEX_EVERY_MS) {
    const root = workspace.folder;
    if (!this.usable || !root || this.indexing || Date.now() - this.lastIndex < minAgeMs) return;
    void this.indexFolder(root);
  }

  /** Download the model if needed and turn the feature on. */
  async enable(): Promise<boolean> {
    this.error = '';
    await this.refresh();
    if (!this.info?.installed) {
      const done = await jobs.run('Downloading search model', () => api.SemanticDownload());
      if (done.cancelled) return false;
      if (done.error) {
        this.error = done.error;
        return false;
      }
      await this.refresh();
    }
    settings.update((s) => (s.semantic = { ...s.semantic, enabled: true }));
    return true;
  }

  async disable() {
    settings.update((s) => (s.semantic = { ...s.semantic, enabled: false }));
    this.indexRun++;
    this.unload();
    await api.SemanticUnload();
  }

  async removeModel() {
    await this.disable();
    await api.SemanticRemoveModel();
    this.index = null;
    await this.refresh();
  }

  async rebuild() {
    this.indexRun++;
    await api.SemanticClearIndex();
    const root = workspace.folder;
    if (root) await this.indexFolder(root);
  }

  /** Embed texts (already prefixed). Queries jump ahead of indexing work. */
  embed(texts: string[], maxTokens: number, priority: 'high' | 'low'): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      (priority === 'high' ? this.high : this.low).push({ texts, maxTokens, resolve, reject });
      void this.pump();
    });
  }

  /** Search the open folder by meaning; null when the feature is unavailable. */
  async search(q: string, k = 8): Promise<Hit[] | null> {
    const root = workspace.folder;
    if (!this.usable || !root || !q.trim()) return null;
    const [vec] = await this.embed([`task: search result | query: ${q.trim()}`], QUERY_TOKENS, 'high');
    return (await api.SemanticQuery(root, Array.from(vec), k)) ?? [];
  }

  /**
   * Bring the index of root up to date (incremental). Two passes: the first
   * passage of every new or changed file, then the remaining passages, so the
   * whole folder becomes searchable long before it is fully indexed.
   */
  async indexFolder(root: string) {
    if (!this.usable) return;
    const run = ++this.indexRun;
    this.lastIndex = Date.now();
    let job: ReturnType<typeof jobs.local> | null = null;
    const alive = () => run === this.indexRun && workspace.folder === root && this.usable;
    try {
      for (let pass = 0; pass < 3; pass++) {
        const pending = await api.SemanticPending(root);
        this.index = { files: pending.indexed, passages: pending.passages, total: pending.total };
        const files = pending.files ?? [];
        if (!files.length || !alive()) return;
        job ??= jobs.local('Indexing for search by meaning', () => this.indexRun++);
        job.label(files.some((f) => !f.partial) ? 'Indexing for search by meaning' : 'Indexing for search by meaning (details)');
        this.indexing = { done: 0, total: files.length };
        const t0 = performance.now();
        for (let i = 0; i < files.length; i++) {
          if (!alive()) return;
          const f = files[i];
          let res: app.PassagesResult;
          try {
            res = await api.SemanticPassages(f.path);
          } catch {
            continue; // deleted or unreadable meanwhile
          }
          const all = res.passages ?? [];
          const mode = f.partial ? 'rest' : all.length > 1 ? 'first' : 'all';
          const ps = mode === 'rest' ? all.slice(1) : mode === 'first' ? all.slice(0, 1) : all;
          const title = basename(f.path);
          const vecs = ps.length ? await this.embed(ps.map((p) => `title: ${title} | text: ${p.text}`), DOC_TOKENS, 'low') : [];
          if (!alive()) return;
          const items = ps.map((p, j) => ({ line: p.line, text: p.text, vector: Array.from(vecs[j]) })) as sem.Item[];
          await api.SemanticPut(root, f.path, res.size, res.mod, items, mode);
          this.indexing = { done: i + 1, total: files.length };
          const idx: { files: number; passages: number; total: number } = this.index!;
          this.index = { ...idx, files: idx.files + (f.partial ? 0 : 1), passages: idx.passages + ps.length };
          const left = Math.round(((performance.now() - t0) / (i + 1)) * (files.length - i - 1) / 60000);
          job.set(i + 1, files.length, left >= 1 ? `~${left} min left` : '');
        }
      }
    } catch (e) {
      if (run === this.indexRun) this.error = errorMessage(e);
    } finally {
      job?.end();
      if (run === this.indexRun) this.indexing = null;
      this.scheduleIdle();
    }
  }

  private async pump() {
    if (this.busy) return;
    const req = this.high.shift() ?? this.low.shift();
    if (!req) return;
    this.busy = true;
    clearTimeout(this.idleTimer);
    try {
      await this.load();
      const id = ++this.seq;
      const done = new Promise<void>((resolve) => {
        this.waiting.set(id, {
          req: {
            ...req,
            resolve: (v) => (req.resolve(v), resolve()),
            reject: (e) => (req.reject(e), resolve()),
          },
          started: performance.now(),
        });
      });
      this.post({ type: 'embed', id, texts: req.texts, maxTokens: req.maxTokens });
      await done;
    } catch (e) {
      req.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.busy = false;
      if (this.high.length || this.low.length) void this.pump();
      else this.scheduleIdle();
    }
  }

  private load(): Promise<void> {
    if (this.ready) return this.ready;
    this.model = 'loading';
    this.loadProgress = 0;
    this.ready = (async () => {
      const { default: EmbedWorker } = await import('./embedWorker?worker');
      const w = new EmbedWorker();
      this.worker = w;
      await new Promise<void>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<EmbedOut>) => {
          const m = e.data;
          if (m.type === 'ready') {
            this.model = 'ready';
            resolve();
          } else if (m.type === 'loading') {
            this.loadProgress = m.total ? m.done / m.total : 0;
          } else if (m.type === 'result') {
            const p = this.waiting.get(m.id);
            this.waiting.delete(m.id);
            if (m.tokens > 16) this.tokensPerSec = Math.round((m.tokens / Math.max(1, m.millis)) * 1000);
            const out: Float32Array[] = [];
            for (let i = 0; i < m.vectors.length / m.dims; i++) out.push(m.vectors.subarray(i * m.dims, (i + 1) * m.dims));
            p?.req.resolve(out);
          } else if (m.type === 'error') {
            if (m.id === undefined) {
              reject(new Error(m.message));
              return;
            }
            const p = this.waiting.get(m.id);
            this.waiting.delete(m.id);
            p?.req.reject(new Error(m.message));
          }
        };
        w.onerror = (e) => reject(new Error(e.message || 'embedding worker failed'));
        this.post({ type: 'init', token: sessionToken(), dims: this.info?.dims ?? 256 });
      });
    })();
    this.ready.catch((e) => {
      this.error = errorMessage(e);
      this.unload();
    });
    return this.ready;
  }

  private post(m: EmbedIn) {
    this.worker?.postMessage(m);
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.worker) return;
    const secs = settings.value.semantic?.unloadAfter || 60;
    this.idleTimer = setTimeout(() => {
      if (!this.busy && !this.indexing && !this.high.length && !this.low.length) this.unload();
    }, secs * 1000);
  }

  /** Terminate the worker, freeing the model's memory. */
  unload() {
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.model = 'unloaded';
    const err = new Error('search model unloaded');
    for (const { req } of this.waiting.values()) req.reject(err);
    this.waiting.clear();
    for (const r of [...this.high, ...this.low]) r.reject(err);
    this.high = [];
    this.low = [];
  }
}

export const semantic = new SemanticState();
