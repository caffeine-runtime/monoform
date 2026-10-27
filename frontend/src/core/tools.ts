// Tool entry points that exist before their module loads.
import { api } from './backend';
import { commands } from './commands';
import { basename, dirname, extname, join, stem } from './paths';
import { toastError, ui } from './ui.svelte';
import { workspace } from './tabs.svelte';
import { semantic } from './semantic/semantic.svelte';
import { treeMenuContributions } from '../shell/treeActions';
import type { MenuItem } from './ui.svelte';
import { t } from './i18n';
import { convertPaths, knownTargets } from './convert.svelte';
import { boot } from './boot';

const CHECKSUM_EXT = ['sha256', 'sha1', 'md5', 'sha512', 'b3', 'sha256sum', 'md5sum', 'sha1sum', 'sha512sum'];

/** Take a screenshot and open it in the image editor (to add arrows, boxes, text, blur…). */
export async function takeScreenshot(mode: 'region' | 'screen', delay = 0) {
  try {
    const r = await api.ScreenCapture(mode, delay, false);
    if (!r.path) return; // cancelled
    // When only the whole screen could be taken, start with Crop.
    await workspace.openPath(r.path, { state: mode === 'region' && !r.interactive ? { tool: 'crop' } : undefined });
    const done = mode === 'region' && !r.interactive ? t('Took the whole screen: drag the part to keep and press Enter.') : t('Saved to {folder}. Add arrows, boxes or text, blur private parts, then save.', { folder: dirname(r.path) });
    ui.toast(done, 'success'); // i18n-ignore: message translated above
  } catch (e) {
    toastError(e, t('Screenshot failed'));
  }
}

/** A screen recording that just finished: opened in the video editor, with where it was saved. */
export async function openRecordings(paths: string[]) {
  for (const p of paths) {
    await workspace.openPath(p);
    ui.toast(t('Screen recording saved to {folder}. Trim or cut it here.', { folder: dirname(p) }), 'success', { label: t('Show in folder'), run: () => void api.ShowInFolder(p) });
  }
}

/** Screen recording runs in a window of its own (Windows: the webview can record the screen there). */
export function canRecordScreen(): boolean {
  return boot.platform === 'windows' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
}

/** Pick a colour anywhere on the screen: a temporary shot opened with the colour picker. */
export async function pickScreenColour() {
  try {
    const r = await api.ScreenCapture('screen', 0, true);
    if (!r.path) return;
    await workspace.openPath(r.path, { state: { tool: 'picker', panel: 'colours' } });
    ui.toast(t('Click anywhere in the picture to pick its colour.'), 'info');
  } catch (e) {
    toastError(e, t('Couldn’t capture the screen'));
  }
}

export function registerTools() {
  commands.register(
    { id: 'screenshot.region', title: t('Take a screenshot of an area…'), category: t('Tools'), shortcut: 'Mod+Shift+X', run: () => void takeScreenshot('region') },
    { id: 'screenshot.screen', title: t('Take a screenshot of the whole screen'), category: t('Tools'), run: () => void takeScreenshot('screen') },
    { id: 'screenshot.delayed', title: t('Take a screenshot of the whole screen in 3 seconds'), category: t('Tools'), run: () => void takeScreenshot('screen', 3) },
    { id: 'screenshot.record', title: t('Record the screen…'), category: t('Tools'), when: canRecordScreen, run: () => void api.RecordScreen().catch((e) => toastError(e, t('Couldn’t start the recorder'))) },
    { id: 'tools.pickColour', title: t('Pick a colour from the screen'), category: t('Tools'), run: () => void pickScreenColour() },
    {
      id: 'tools.hash',
      title: t('Compute file hash…'),
      category: t('Tools'),
      shortcut: 'Mod+Alt+H',
      run: (arg) => {
        const p = typeof arg === 'string' ? arg : workspace.active?.filePath;
        workspace.openTool('hash', p);
      },
    },
    {
      id: 'tools.verify',
      title: t('Verify checksum file…'),
      category: t('Tools'),
      run: async () => {
        const r = await api.OpenFilesDialog(t('Choose a checksum file (.sha256, .md5, SHA256SUMS…)'), [{ name: t('Checksum files'), patterns: '*.sha256;*.sha1;*.md5;*.sha512;*.b3;*SUMS;*.txt' }]);
        if (r?.[0]) await workspace.openPath(r[0], { moduleId: 'checksum' });
      },
    },
    { id: 'semantic.settings', title: t('Search by meaning…'), category: t('Search'), run: () => workspace.openTool('semantic') },
    {
      id: 'semantic.toggle',
      title: t('Turn search by meaning on/off'),
      category: t('Search'),
      // Turning on needs consent (download, memory), so it goes through the settings page.
      run: () => (semantic.enabled ? void semantic.disable() : workspace.openTool('semantic', undefined, { state: { consent: true } })),
    },
    {
      id: 'semantic.reindex',
      title: t('Update search-by-meaning index'),
      category: t('Search'),
      when: () => semantic.usable && !!workspace.folder,
      run: () => void semantic.indexFolder(workspace.folder!),
    },
  );
  treeMenuContributions.push((item) => {
    if (item.archive || item.isDir) return [];
    const items: MenuItem[] = [{ label: t('Compute hash…'), run: () => void workspace.openTool('hash', item.path) }];
    if (CHECKSUM_EXT.includes(extname(item.path)) || /sums$/i.test(item.name)) items.push({ label: t('Verify checksums'), run: () => void workspace.openPath(item.path, { moduleId: 'checksum' }) });
    // Convert without opening it: the Save and convert dialog for this file.
    if (knownTargets(item.path).length) items.push({ label: t('Convert…'), run: () => void convertPaths([item.path]) });
    return items;
  });
}

/** Convert an image (HEIC through the system decoder) next to the original, never overwriting. */
export async function convertImage(src: string, format: string): Promise<string | undefined> {
  const names = Array.from({ length: 50 }, (_, i) => join(dirname(src), `${stem(src)}${i ? ` (${i + 1})` : ''}.${format}`));
  const taken = await api.Exists(names);
  const dst = names[taken.indexOf(false)];
  if (!dst) return;
  try {
    await api.ConvertImage(src, dst, format);
    ui.toast(t('Saved {name}', { name: basename(dst) }), 'success', { label: t('Open'), run: () => void workspace.openPath(dst) });
    return dst;
  } catch (e) {
    toastError(e, t('Couldn’t convert the image'));
  }
}
