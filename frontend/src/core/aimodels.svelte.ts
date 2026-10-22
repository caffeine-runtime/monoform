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
    this.busy = id;
    try {
      const done = await jobs.run(t('Downloading {name}', { name: p.name }), () => api.AIInstall(id));
      if (done.cancelled) return false;
      if (done.error) {
        ui.toast(t('Download failed: {error}', { error: done.error }), 'error');
        return false;
      }
      await this.refresh();
      const ok = !!this.pack(id)?.installed;
      if (ok) ui.toast(t('{name} is installed.', { name: p.name }), 'success');
      return ok;
    } finally {
      this.busy = null;
    }
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
