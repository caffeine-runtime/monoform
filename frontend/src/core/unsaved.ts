// Unsaved work when Monoform is about to go away (quitting, restarting for an
// update): one question that names the files, with saving them as the main
// answer. Saving goes tab by tab (a new document asks where); if one isn't
// saved — cancelled, or it failed — Monoform stays open on that tab.
import { api } from './backend';
import { t, tn } from './i18n';
import { basename, dirname } from './paths';
import { settings } from './settings.svelte';
import { fileCard, workspace, type Tab } from './tabs.svelte';
import { ui, type DialogItem } from './ui.svelte';

/** A dialog row per tab: its name and the folder it is in ("Not saved yet" for a new document). */
export function unsavedItems(tabs: Tab[]): DialogItem[] {
  return tabs.map((tab) => {
    const path = tab.filePath ?? tab.path;
    const fresh = !!tab.scratch || tab.source.kind === 'untitled';
    return { id: tab.id, label: tab.title, detail: fresh ? t('Not saved yet') : path ? basename(dirname(path)) || dirname(path) : undefined, tip: fresh ? undefined : tab.subtitle || path };
  });
}

/** Save the tabs one after another, each shown while it saves; false (and a note) at the first one that isn't saved. */
export async function saveEach(tabs: Tab[], stopped: (name: string) => string): Promise<boolean> {
  for (const tab of tabs) {
    if (!tab.dirty || !workspace.tabs.includes(tab)) continue;
    workspace.activate(tab);
    if (!(await workspace.save(tab)) || tab.dirty) {
      ui.toast(stopped(tab.title), 'warning');
      return false;
    }
  }
  return true;
}

/** The answer to "save before going?": go on, or stay (cancelled, a tab chosen from the list, or not everything saved). */
async function settle(r: { button: string; value?: string }, dirty: Tab[], stopped: (name: string) => string): Promise<boolean> {
  if (r.button === 'item') {
    const tab = dirty.find((x) => x.id === r.value);
    if (tab) workspace.activate(tab);
    return false;
  }
  if (r.button === 'save') return saveEach(dirty, stopped);
  return r.button === 'discard';
}

/**
 * Closing the window with unsaved tabs (Go asks through app:confirm-quit):
 * Save all and quit (Enter), Cancel (Esc), or Quit without saving, set apart.
 * `quit` closes the window for good (stubbed in self-tests).
 */
export async function confirmQuit(quit: () => unknown = () => api.ConfirmQuit()): Promise<boolean> {
  const dirty = workspace.tabs.filter((tab) => tab.dirty);
  if (dirty.length) {
    const one = dirty.length === 1 ? dirty[0] : null;
    const r = await ui.ask({
      title: t('Save changes before quitting?'),
      file: one ? fileCard(one) : undefined,
      message: one ? t('Your changes will be lost if you don’t save them.') : tn('{n} file has changes that aren’t saved:', '{n} files have changes that aren’t saved:', dirty.length),
      items: one ? undefined : unsavedItems(dirty),
      buttons: [
        { id: 'discard', label: t('Quit without saving'), danger: true, aside: true },
        { id: 'cancel', label: t('Cancel') },
        { id: 'save', label: one ? t('Save and quit') : t('Save all and quit'), primary: true },
      ],
    });
    if (!(await settle(r, dirty, (name) => t('Monoform stays open: {name} isn’t saved.', { name })))) return false;
  }
  await settings.flush();
  void quit();
  return true;
}

/** Before restarting into a new version: save the unsaved tabs, or stay. */
export async function saveBeforeRestart(): Promise<boolean> {
  const dirty = workspace.tabs.filter((tab) => tab.dirty);
  if (!dirty.length) return true;
  const one = dirty.length === 1 ? dirty[0] : null;
  const r = await ui.ask({
    title: t('Save changes before restarting?'),
    file: one ? fileCard(one) : undefined,
    message: one ? t('Monoform restarts to install the new version.') : tn('{n} file has changes that aren’t saved:', '{n} files have changes that aren’t saved:', dirty.length),
    items: one ? undefined : unsavedItems(dirty),
    footnote: one ? undefined : t('Monoform restarts to install the new version.'),
    buttons: [
      { id: 'cancel', label: t('Cancel') },
      { id: 'save', label: one ? t('Save and restart') : t('Save all and restart'), primary: true },
    ],
  });
  return settle(r, dirty, (name) => t('Not restarting: {name} isn’t saved.', { name }));
}
