// More than one window: a tab can move to a window of its own (a second app
// process opened on that file; see App.NewWindow in Go).
import { api } from './backend';
import { workspace, type Tab } from './tabs.svelte';
import { toastError, ui } from './ui.svelte';

/** Open the tab's file in a new window (at a screen point, if given) and close it here. */
export async function moveToNewWindow(t: Tab, at?: { x: number; y: number }): Promise<boolean> {
  const path = t.filePath;
  if (!path) {
    ui.toast('Only files can move to a window of their own.', 'info');
    return false;
  }
  if (t.dirty) {
    const r = await ui.ask({
      title: 'Save changes first?',
      message: `${t.title} has unsaved changes. The new window opens the file as it is saved.`,
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save and move', primary: true },
      ],
    });
    if (r.button !== 'save' || !(await workspace.save(t))) return false;
  }
  try {
    await api.NewWindow([path], Math.round(at?.x ?? -1), Math.round(at?.y ?? -1));
  } catch (e) {
    toastError(e, 'Couldn’t open a new window');
    return false;
  }
  await workspace.close(t, { force: true });
  return true;
}
