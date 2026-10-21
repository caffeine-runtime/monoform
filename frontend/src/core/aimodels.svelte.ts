// Optional image models (better subject selection, object removal): what is
// installed, and installing/removing them. Nothing is downloaded without the
// user agreeing to it in a dialog that names the size and the sources.
import { api, type AIPack } from './backend';
import { jobs } from './jobs.svelte';
import { formatBytes } from './paths';
import { toastError, ui } from './ui.svelte';

class AIModels {
  packs = $state<AIPack[]>([]);
  busy = $state<string | null>(null);

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
    await this.refresh();
    const p = this.pack(id);
    if (!p) return false;
    if (p.installed) return true;
    if (!p.supported) {
      ui.toast(`${p.name} isn't available on this computer's system.`, 'warning');
      return false;
    }
    const r = await ui.ask({
      title: `Download ${p.name}?`,
      message: `${why ? why + ' ' : ''}${p.purpose} It's a one-time download of ${formatBytes(p.download)} (${formatBytes(p.disk)} on disk) from huggingface.co and nuget.org; after that everything runs on this computer, offline. You can remove it in Settings › AI models.`,
      details: [`Model: ${p.model} (${p.license}) — ${p.source.split('@')[0]}`, 'Runs with ONNX Runtime (MIT, Microsoft)'],
      buttons: [
        { id: 'cancel', label: 'Not now' },
        { id: 'ok', label: `Download ${formatBytes(p.download)}`, primary: true },
      ],
    });
    if (r.button !== 'ok') return false;
    this.busy = id;
    try {
      const done = await jobs.run(`Downloading ${p.name}`, () => api.AIInstall(id));
      if (done.cancelled) return false;
      if (done.error) {
        ui.toast(`Download failed: ${done.error}`, 'error');
        return false;
      }
      await this.refresh();
      const ok = !!this.pack(id)?.installed;
      if (ok) ui.toast(`${p.name} is installed.`, 'success');
      return ok;
    } finally {
      this.busy = null;
    }
  }

  async remove(id: string) {
    const p = this.pack(id);
    if (!p) return;
    const ok = await ui.confirm(`Remove ${p.name}?`, `This frees ${formatBytes(p.disk)}. You can download it again any time.`, 'Remove');
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
