// More than one window: a tab can move to a window of its own (a second app
// process opened on that file; see App.NewWindow in Go).
import { api } from './backend';
import { workspace, type Tab } from './tabs.svelte';
import { toastError, ui } from './ui.svelte';
import { t } from './i18n';

/** Open the tab's file in a new window (at a screen point, if given) and close it here. */
export async function moveToNewWindow(tab: Tab, at?: { x: number; y: number }): Promise<boolean> {
  const path = tab.filePath;
  if (!path) {
    ui.toast(t('Only files can move to a window of their own.'), 'info');
    return false;
  }
  if (tab.dirty) {
    const r = await ui.ask({
      title: t('Save changes first?'),
      message: t('{name} has unsaved changes. The new window opens the file as it is saved.', { name: tab.title }),
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'save', label: t('Save and move'), primary: true },
      ],
    });
    if (r.button !== 'save' || !(await workspace.save(tab))) return false;
  }
  try {
    await api.NewWindow([path], Math.round(at?.x ?? -1), Math.round(at?.y ?? -1));
  } catch (e) {
    toastError(e, t('Couldn’t open a new window'));
    return false;
  }
  await workspace.close(tab, { force: true });
  return true;
}
