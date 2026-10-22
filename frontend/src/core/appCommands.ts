// Core commands: files, tabs, view and tools. Modules add their own when loaded.
import { newFileOfKind } from './newfile';
import { api } from './backend';
import { commands } from './commands';
import { formatShortcut } from './keys';
import { settings } from './settings.svelte';
import { sidebar } from './sidebar.svelte';
import { peek } from './peek.svelte';
import { moveToNewWindow } from './windows';
import { copyTransfer, describe, isEmptyTab, pasteInto } from './transfer.svelte';
import { workspace } from './tabs.svelte';
import { theme } from './theme.svelte';
import { tree } from './tree.svelte';
import { toastError, ui } from './ui.svelte';
import { t, tn } from './i18n';

export async function openFilesDialog() {
  try {
    const paths = await api.OpenFilesDialog(t('Open'), []);
    for (const p of paths ?? []) await workspace.openPath(p);
  } catch (e) {
    toastError(e);
  }
}

export async function openFolderDialog() {
  try {
    const p = await api.OpenFolderDialog(t('Open folder'));
    if (p) {
      await workspace.openFolder(p);
      settings.update((s) => (s.sidebarVisible = true));
      sidebar.mode = 'files';
    }
  } catch (e) {
    toastError(e);
  }
}

const hasTab = () => !!workspace.active;
const hasFile = () => !!workspace.active?.filePath;

export function registerAppCommands() {
  commands.register(
    { id: 'app.palette', title: t('Search files, text and commands'), category: t('View'), shortcut: ['Mod+K', 'Mod+Shift+P'], run: () => (ui.paletteOpen ? (ui.paletteOpen = false) : ui.openPalette()) },
    { id: 'file.quickOpen', title: t('Go to file…'), category: t('File'), shortcut: 'Mod+P', run: () => ui.openPalette('') },
    { id: 'file.open', title: t('Open file…'), category: t('File'), shortcut: 'Mod+O', run: openFilesDialog },
    { id: 'file.openFolder', title: t('Open folder…'), category: t('File'), shortcut: 'Mod+Shift+O', run: openFolderDialog },
    { id: 'file.new', title: t('New text file'), category: t('File'), shortcut: 'Mod+N', run: () => workspace.newUntitled('text') },
    { id: 'file.newOf', title: t('New document, spreadsheet, image…'), category: t('File'), shortcut: 'Mod+Alt+N', run: () => void newFileOfKind() },
    { id: 'file.newMarkdown', title: t('New Markdown note'), category: t('File'), run: () => void newFileOfKind(undefined, 'markdown') },
    { id: 'file.newDocx', title: t('New Word document'), category: t('File'), run: () => void newFileOfKind(undefined, 'docx') },
    { id: 'file.newXlsx', title: t('New spreadsheet'), category: t('File'), run: () => void newFileOfKind(undefined, 'xlsx') },
    { id: 'file.newImage', title: t('New image…'), category: t('File'), run: () => void newFileOfKind(undefined, 'image') },
    { id: 'file.imagesToPdf', title: t('Create PDF from images…'), category: t('File'), run: () => void import('../modules/pdf/tools').then((m) => m.imagesToPdf()) },
    { id: 'file.save', title: t('Save'), category: t('File'), shortcut: 'Mod+S', when: hasTab, run: () => workspace.save() },
    { id: 'file.saveAs', title: t('Save as…'), category: t('File'), shortcut: 'Mod+Shift+S', when: hasTab, run: () => workspace.save(workspace.active, true) },
    {
      id: 'file.saveAll',
      title: t('Save all'),
      category: t('File'),
      shortcut: 'Mod+Alt+S',
      run: async () => {
        for (const tab of workspace.tabs) if (tab.dirty) await workspace.save(tab);
      },
    },
    { id: 'file.revert', title: t('Revert file (reload from disk)'), category: t('File'), when: hasFile, run: () => workspace.active && workspace.reloadTab(workspace.active) },
    {
      id: 'file.pin',
      title: t('Pin / unpin current file'),
      category: t('File'),
      when: hasFile,
      run: () => settings.togglePin(workspace.active!.filePath!),
    },
    {
      id: 'file.copyPath',
      title: t('Copy path of current file'),
      category: t('File'),
      when: () => !!workspace.active?.path,
      run: () => navigator.clipboard.writeText(workspace.active!.path!).then(() => ui.toast(t('Path copied'), 'success')),
    },
    {
      id: 'file.reveal',
      title: t('Reveal current file in sidebar'),
      category: t('File'),
      when: () => hasFile() && !!workspace.folder,
      run: async () => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.mode = 'files';
        await tree.reveal(workspace.folder, workspace.active!.filePath!);
      },
    },
    {
      id: 'file.history',
      title: t('Show file history (earlier versions)'),
      category: t('File'),
      shortcut: 'Mod+Alt+Y',
      when: hasFile,
      run: () => workspace.openTool('history', workspace.active!.filePath!),
    },
    { id: 'history.all', title: t('File history: all files'), category: t('File'), run: () => workspace.openTool('history') },
    { id: 'folder.close', title: t('Close folder'), category: t('File'), when: () => !!workspace.folder, run: () => workspace.closeFolder() },
    { id: 'folder.refresh', title: t('Refresh folder'), category: t('File'), when: () => !!workspace.folder, run: () => tree.refreshAll() },

    { id: 'tab.close', title: t('Close tab'), category: t('Tabs'), shortcut: 'Mod+W', when: hasTab, run: () => workspace.active && workspace.close(workspace.active) },
    { id: 'tab.closeOthers', title: t('Close other tabs'), category: t('Tabs'), when: hasTab, run: () => workspace.closeAll(workspace.active ?? undefined) },
    { id: 'tab.closeAll', title: t('Close all tabs'), category: t('Tabs'), when: hasTab, run: () => workspace.closeAll() },
    { id: 'tab.next', title: t('Next tab'), category: t('Tabs'), shortcut: ['Ctrl+Tab', 'Ctrl+PageDown', 'Mod+Alt+ArrowRight'], when: hasTab, run: () => workspace.cycle(1) },
    { id: 'tab.prev', title: t('Previous tab'), category: t('Tabs'), shortcut: ['Ctrl+Shift+Tab', 'Ctrl+PageUp', 'Mod+Alt+ArrowLeft'], when: hasTab, run: () => workspace.cycle(-1) },
    { id: 'tab.reopen', title: t('Reopen closed tab'), category: t('Tabs'), shortcut: 'Mod+Shift+T', run: () => workspace.reopenClosed() },
    { id: 'tab.new', title: t('New tab'), category: t('Tabs'), shortcut: 'Mod+T', run: () => workspace.openTool('start') },
    // Copy out of / paste into views that aren't text fields (a video frame, a picture…); editors with their own copy and paste override these.
    {
      id: 'edit.copyOut',
      title: t('Copy (to paste into another tab)'),
      category: t('Edit'),
      shortcut: 'Mod+C',
      inInputs: false,
      when: () => !!workspace.active?.handlers.give && !window.getSelection()?.toString(),
      run: async () => {
        const x = await workspace.active?.handlers.give?.();
        if (!x) return;
        await copyTransfer(x);
        ui.toast(t('Copied {what}', { what: describe(x) }), 'success');
      },
    },
    { id: 'edit.pasteIn', title: t('Paste'), category: t('Edit'), shortcut: 'Mod+V', inInputs: false, when: () => !!workspace.active?.handlers.accept || isEmptyTab(workspace.active), run: () => void pasteInto() },
    { id: 'tab.newWindow', title: t('Move tab to a new window'), category: t('Tabs'), when: () => !!workspace.active?.filePath, run: () => workspace.active && void moveToNewWindow(workspace.active) },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab.goto${i + 1}`,
      title: t('Go to tab {n}', { n: i + 1 }),
      category: t('Tabs'),
      shortcut: `Mod+${i + 1}`,
      hidden: true,
      run: () => (i === 8 ? workspace.activateIndex(workspace.tabs.length - 1) : workspace.activateIndex(i)),
    })),

    { id: 'edit.find', title: t('Find'), category: t('Edit'), shortcut: 'Mod+F', when: () => !!workspace.active?.handlers.find, run: () => workspace.active?.handlers.find?.() },
    {
      id: 'search.inFolder',
      title: t('Find in folder…'),
      category: t('Edit'),
      shortcut: 'Mod+Shift+F',
      run: (arg) => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.searchRoot = typeof arg === 'string' ? arg : workspace.folder;
        sidebar.mode = 'search';
        queueMicrotask(() => document.querySelector<HTMLInputElement>('#folder-search')?.focus());
      },
    },

    {
      id: 'view.togglePreview',
      title: t('Switch between preview and editing'),
      category: t('View'),
      shortcut: 'Mod+Alt+E',
      when: () => workspace.active?.source.kind === 'file',
      run: () => void (workspace.active && workspace.setPreview(workspace.active, !workspace.active.preview)),
    },
    { id: 'view.previewByDefault', title: t('Open files in preview mode (on/off)'), category: t('View'), run: () => settings.update((s) => (s.openInPreview = !s.openInPreview)) },
    { id: 'peek.expand', title: t('Open in the full editor'), category: t('View'), when: () => peek.on, run: () => void peek.expand() },
    { id: 'view.toggleSidebar', title: t('Toggle sidebar'), category: t('View'), shortcut: 'Mod+B', run: () => settings.update((s) => (s.sidebarVisible = !s.sidebarVisible)) },
    { id: 'view.togglePathBar', title: t('Show / hide the path bar'), category: t('View'), run: () => settings.update((s) => (s.pathBarOff = !s.pathBarOff)) },
    {
      id: 'view.togglePanels',
      title: t('Show / hide side panels (layers, adjustments, …)'),
      category: t('View'),
      shortcut: 'Mod+Alt+B',
      run: () => settings.update((s) => (s.panelsHidden = !s.panelsHidden)),
    },
    { id: 'file.showInFolder', title: t('Show current file in the system file manager'), category: t('File'), when: () => !!workspace.active?.filePath, run: () => api.ShowInFolder(workspace.active!.filePath!).catch((e: unknown) => toastError(e)) },
    { id: 'view.showFiles', title: t('Show files'), category: t('View'), shortcut: 'Mod+Shift+E', run: () => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.mode = 'files';
      } },
    { id: 'app.settings', title: t('Settings'), category: t('View'), shortcut: 'Mod+,', run: () => workspace.openTool('settings') },
    { id: 'view.splitColumns', title: t('Split view: two side by side'), category: t('View'), shortcut: 'Mod+\\', run: () => split('columns', 2) },
    { id: 'view.splitRows', title: t('Split view: two stacked'), category: t('View'), run: () => split('rows', 2) },
    { id: 'view.splitThree', title: t('Split view: three'), category: t('View'), run: () => split('grid', 3) },
    { id: 'view.splitGrid', title: t('Split view: four (grid)'), category: t('View'), run: () => split('grid', 4) },
    { id: 'view.unsplit', title: t('Split view: one tab'), category: t('View'), when: () => !!workspace.split, run: () => workspace.setSplit(null) },
    { id: 'view.nextPane', title: t('Split view: focus next pane'), category: t('View'), shortcut: 'Mod+Alt+]', when: () => !!workspace.split, run: () => focusPane(1) },
    { id: 'view.prevPane', title: t('Split view: focus previous pane'), category: t('View'), shortcut: 'Mod+Alt+[', when: () => !!workspace.split, run: () => focusPane(-1) },
    { id: 'view.uiBigger', title: t('Interface: larger'), category: t('View'), shortcut: ['Mod+Alt+=', 'Mod+Alt+Shift+='], run: () => scaleUI(1) },
    { id: 'view.uiSmaller', title: t('Interface: smaller'), category: t('View'), shortcut: 'Mod+Alt+-', run: () => scaleUI(-1) },
    { id: 'view.uiReset', title: t('Interface: normal size (100%)'), category: t('View'), run: () => scaleUI(0) },
    { id: 'view.toggleTheme', title: t('Toggle dark / light theme'), category: t('View'), shortcut: 'Mod+Alt+T', run: () => theme.toggle() },
    { id: 'view.themeSystem', title: t('Theme: follow system'), category: t('View'), run: () => theme.set('system') },
    { id: 'view.themeDark', title: t('Theme: dark'), category: t('View'), run: () => theme.set('dark') },
    { id: 'view.themeLight', title: t('Theme: light'), category: t('View'), run: () => theme.set('light') },
    { id: 'view.toggleHidden', title: t('Show / hide hidden files'), category: t('View'), run: () => settings.update((s) => (s.showHidden = !s.showHidden)) },
    {
      id: 'help.welcome',
      title: t('Welcome'),
      category: t('Help'),
      run: () => (ui.firstRun = true),
    },
    { id: 'help.updates', title: t('Check for updates…'), category: t('Help'), run: () => void import('./updates.svelte').then((m) => m.updates.check(false)) },
    {
      id: 'help.shortcuts',
      title: t('Keyboard shortcuts'),
      category: t('Help'),
      shortcut: 'Mod+/',
      run: async () => {
        const lines = commands
          .all()
          .filter((c) => c.shortcut && !c.hidden)
          .map((c) => `${formatShortcut(commands.shortcutOf(c.id)!)}  —  ${c.category ? c.category + ': ' : ''}${c.title}`);
        await ui.ask({ title: t('Keyboard shortcuts'), details: lines, buttons: [{ id: 'ok', label: t('Close'), primary: true }] });
      },
    },
  );
}

/** Interface size steps (Settings → Interface size). */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

function scaleUI(dir: 1 | -1 | 0) {
  const cur = settings.value.uiScale || 1;
  let next = 1;
  if (dir > 0) next = UI_SCALES.find((v) => v > cur + 1e-3) ?? UI_SCALES[UI_SCALES.length - 1];
  else if (dir < 0) next = [...UI_SCALES].reverse().find((v) => v < cur - 1e-3) ?? UI_SCALES[0];
  settings.update((s) => (s.uiScale = next));
  ui.toast(t('Interface size {pct}%', { pct: Math.round(next * 100) }), 'info', undefined, 1500);
}

function split(layout: 'columns' | 'rows' | 'grid', count: number) {
  // Mod+\ toggles: pressing it again in a two-pane split goes back to one tab.
  const s = workspace.split;
  if (s && s.layout === layout && s.panes.length === count) return workspace.setSplit(null);
  if (!workspace.splitView(layout, count)) ui.toast(count > 2 ? tn('Open {n} tab to split the view.', 'Open {n} tabs to split the view.', count) : t('Open another tab to split the view.'), 'info');
}

function focusPane(dir: 1 | -1) {
  const s = workspace.split;
  if (!s) return;
  const i = s.panes.indexOf(workspace.activeId ?? '');
  const id = s.panes[(i + dir + s.panes.length) % s.panes.length];
  const t = workspace.tabs.find((x) => x.id === id);
  if (t) workspace.activate(t);
}
