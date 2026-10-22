// Changing the interface language: saved in the settings, then the window
// reloads in it (tabs and the folder come back from the session). With
// unsaved changes the reload waits for the next start instead.
import { boot } from './boot';
import { language, pickLanguage, t, type Lang } from './i18n';
import { settings } from './settings.svelte';
import { workspace } from './tabs.svelte';
import { ui } from './ui.svelte';

/** "" follows the system. */
export async function chooseLanguage(id: Lang | ''): Promise<void> {
  if ((settings.value.language ?? '') === id) return;
  settings.update((s) => (s.language = id));
  await settings.flush();
  if (pickLanguage(id, boot.systemLanguages) === language()) return;
  if (workspace.dirtyCount) {
    ui.toast(t('The new language is used from the next start (some tabs have unsaved changes).'), 'info');
    return;
  }
  location.reload();
}

/** The system's language among ours, for "Like my computer (Polski)". */
export function systemLanguage(): Lang {
  return pickLanguage('', boot.systemLanguages);
}
