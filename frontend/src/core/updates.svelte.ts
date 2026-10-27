// New versions: a few seconds after start the main window asks GitHub for the
// newest release (one request, no data about this computer; Settings ›
// About turns it off). When there is one, a popup offers to download and
// install it (what changed is a link to the release page): the package is
// checked against the release's SHA256SUMS, unsaved work is saved first, then
// Monoform restarts as the new version (Go: internal/update, App.Update*).
import { api, type BootInfo } from './backend';
import { t } from './i18n';
import { jobs } from './jobs.svelte';
import { formatBytes } from './paths';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { saveBeforeRestart } from './unsaved';
import type { app } from '../wailsjs/go/models';

type Info = app.UpdateInfo;

class Updates {
  /** What the last check found. */
  info = $state<Info | null>(null);
  checking = $state(false);
  error = $state('');
  /** The downloaded package, once it is here. */
  downloaded = $state('');

  /** Look for a new version; `quiet` (at startup) shows nothing unless there is one not skipped. */
  async check(quiet = false): Promise<Info | null> {
    if (this.checking) return null;
    this.checking = true;
    this.error = '';
    try {
      const info = await api.UpdateCheck();
      this.info = info;
      if (!info.available) {
        if (!quiet) ui.toast(t('Monoform is up to date ({version}).', { version: info.current }), 'success');
        return info;
      }
      if (quiet && settings.value.updateSkip === info.version) return info;
      void this.offer(info);
      return info;
    } catch (e) {
      this.error = String((e as Error)?.message ?? e);
      if (!quiet) ui.toast(t('Couldn’t check for a new version: {error}', { error: this.error }), 'error');
      return null;
    } finally {
      this.checking = false;
    }
  }

  /** The "new version" popup. */
  async offer(info: Info): Promise<void> {
    const manual = info.install === 'manual';
    const r = await ui.ask({
      title: info.nightly ? t('Nightly build {version} is available', { version: info.version }) : t('Monoform {version} is available', { version: info.version }),
      message: manual ? t('This copy can’t update itself where it is installed: get the new version from its download page.') : t('A restart is required, but your tabs will come back.'),
      footnote: manual ? t('Current version {current}', { current: info.current }) : t('Current version {current} · {size} download', { current: info.current, size: formatBytes(info.size) }),
      // What changed is on the release page, for whoever wants it.
      link: manual ? undefined : { label: t('What’s new'), run: () => void api.UpdateOpenRelease() },
      buttons: [
        { id: 'skip', label: t('Skip this version'), aside: true },
        { id: 'later', label: t('Later') },
        { id: 'go', label: manual ? t('Open the download page') : t('Download and install'), primary: true },
      ],
    });
    if (r.button === 'skip') settings.update((s) => (s.updateSkip = info.version));
    if (r.button !== 'go') return;
    if (manual) return void api.UpdateOpenRelease();
    await this.install(info);
  }

  /** Download (with progress), save unsaved work, then install and restart. */
  async install(info: Info): Promise<boolean> {
    if (!this.downloaded) {
      const done = await jobs.run<string>(t('Downloading Monoform {version}', { version: info.version }), () => api.UpdateDownload());
      if (done.cancelled) return false;
      if (done.error || !done.result) {
        ui.toast(t('The download failed: {error}', { error: done.error ?? '' }), 'error', { label: t('Open the download page'), run: () => void api.UpdateOpenRelease() });
        return false;
      }
      this.downloaded = done.result;
    }
    if (!(await saveBeforeRestart())) return false;
    await settings.flush();
    try {
      await api.UpdateInstall(this.downloaded);
      return true;
    } catch (e) {
      ui.toast(t('Couldn’t install the update: {error}', { error: String((e as Error)?.message ?? e) }), 'error', { label: t('Open the download page'), run: () => void api.UpdateOpenRelease() });
      return false;
    }
  }
}

export const updates = new Updates();

/** At startup (main window only, not in self-tests or the Store build): look quietly after a few seconds, unless turned off. */
export function checkAtStartup(info: BootInfo, mainWindow: boolean): void {
  if (!mainWindow || info.testScript || info.store || settings.value.updateCheckOff) return;
  setTimeout(() => void updates.check(true), 4000);
}
