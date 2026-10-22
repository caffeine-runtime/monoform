// Optional image models (better subject selection, object removal): what is
// installed, and installing/removing them. Nothing is downloaded without the
// user agreeing to it in a dialog that names the size and the sources.
import { api, type AIPack } from './backend';
import { jobs } from './jobs.svelte';
import { formatBytes } from './paths';
import { toastError, ui } from './ui.svelte';
import { t } from './i18n';

class AIModels {
  packs = $state<AIPack[]>([]);
  /** Packs downloading now, with how far each is (0–1); several can download at once. */
  progress = $state<Record<string, number>>({});
  private inflight = new Map<string, Promise<boolean>>();

  busy(id: string): boolean {
    return id in this.progress;
  }

  /** Supported packs not installed and not downloading yet. */
  get missing(): AIPack[] {
    return this.packs.filter((p) => p.supported && !p.installed && !this.busy(p.id));
  }

  /** What downloading these together transfers (the shared runtime once). */
  downloadSize(list: AIPack[]): number {
    return list.reduce((n, p) => n + p.download - p.runtime, 0) + Math.max(0, ...list.map((p) => p.runtime));
  }

  async refresh() {
    try {
      this.packs = await api.AIPacks();
    } catch (e) {
      toastError(e);
    }
  }

  pack(id: string): AIPack | undefined {
    return this.packs.find((p) => p.id === id);
  }

  async installed(id: string): Promise<boolean> {
    await this.refresh();
    return !!this.pack(id)?.installed;
  }

  /**
   * Download a pack after asking. `why` says what the user tried to do (when
   * offered from a feature rather than from Settings). Resolves true once
   * the pack is installed.
   */
  async install(id: string, why = ''): Promise<boolean> {
    const running = this.inflight.get(id);
    if (running) return running;
    await this.refresh();
    const p = this.pack(id);
    if (!p) return false;
    if (p.installed) return true;
    if (!p.supported) {
      ui.toast(t("{name} isn't available on this computer's system.", { name: p.name }), 'warning');
      return false;
    }
    const r = await ui.ask({
      title: t('Download {name}?', { name: p.name }),
      message: `${why ? why + ' ' : ''}${p.purpose} ${t("It's a one-time download of {size} ({disk} on disk) from huggingface.co and nuget.org; after that everything runs on this computer, offline. You can remove it in Settings › AI models.", { size: formatBytes(p.download), disk: formatBytes(p.disk) })}`,
      details: [t('Model: {model} ({license}) — {source}', { model: p.model, license: p.license, source: p.source.split('@')[0] }), t('Runs with ONNX Runtime (MIT, Microsoft)')],
      buttons: [
        { id: 'cancel', label: t('Not now') },
        { id: 'ok', label: t('Download {size}', { size: formatBytes(p.download) }), primary: true },
      ],
    });
    if (r.button !== 'ok') return false;
    return this.download(p);
  }

  /** Download every pack not installed yet, at the same time, after one question. */
  async installAll(): Promise<boolean> {
    await this.refresh();
    const todo = this.missing;
    if (!todo.length) return true;
    const size = formatBytes(this.downloadSize(todo));
    const r = await ui.ask({
      title: t('Download all AI models?'),
      message: `${todo.map((p) => p.purpose).join(' ')} ${t("It's a one-time download of {size} from huggingface.co and nuget.org; after that everything runs on this computer, offline. You can remove them in Settings › AI models.", { size })}`,
      details: [...todo.map((p) => t('Model: {model} ({license}) — {source}', { model: p.model, license: p.license, source: p.source.split('@')[0] })), t('Runs with ONNX Runtime (MIT, Microsoft)')],
      buttons: [
        { id: 'cancel', label: t('Not now') },
        { id: 'ok', label: t('Download {size}', { size }), primary: true },
      ],
    });
    if (r.button !== 'ok') return false;
    const ok = await Promise.all(todo.map((p) => this.download(p)));
    return ok.every(Boolean);
  }

  /** One pack's download as a job (others can run alongside). */
  private download(p: AIPack): Promise<boolean> {
    const run = (async () => {
      this.progress = { ...this.progress, [p.id]: 0 };
      try {
        const done = await jobs.run(t('Downloading {name}', { name: p.name }), () => api.AIInstall(p.id), {
          onProgress: (j) => j.total > 0 && this.busy(p.id) && (this.progress = { ...this.progress, [p.id]: j.done / j.total }),
        });
        if (done.cancelled) return false;
        if (done.error) {
          ui.toast(t('Download failed: {error}', { error: done.error }), 'error');
          return false;
        }
        await this.refresh();
        const ok = !!this.pack(p.id)?.installed;
        if (ok) ui.toast(t('{name} is installed.', { name: p.name }), 'success');
        return ok;
      } finally {
        const { [p.id]: _, ...rest } = this.progress;
        this.progress = rest;
        this.inflight.delete(p.id);
      }
    })();
    this.inflight.set(p.id, run);
    return run;
  }

  async remove(id: string) {
    const p = this.pack(id);
    if (!p) return;
    const ok = await ui.confirm(t('Remove {name}?', { name: p.name }), t('This frees {size}. You can download it again any time.', { size: formatBytes(p.disk) }), t('Remove'));
    if (!ok) return;
    try {
      await api.AIRemove(id);
    } catch (e) {
      toastError(e);
    }
    await this.refresh();
  }
}

export const aiModels = new AIModels();
