// Core commands: files, tabs, view and tools. Modules add their own when loaded.
import { api } from './backend';
import { commands } from './commands';
import { formatShortcut } from './keys';
import { settings } from './settings.svelte';
import { sidebar } from './sidebar.svelte';
import { workspace } from './tabs.svelte';
import { theme } from './theme.svelte';
import { tree } from './tree.svelte';
import { toastError, ui } from './ui.svelte';

export async function openFilesDialog() {
  try {
    const paths = await api.OpenFilesDialog('Open', []);
    for (const p of paths ?? []) await workspace.openPath(p);
  } catch (e) {
    toastError(e);
  }
}

export async function openFolderDialog() {
  try {
    const p = await api.OpenFolderDialog('Open folder');
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
    { id: 'app.palette', title: 'Show all commands', category: 'View', shortcut: ['Mod+K', 'Mod+Shift+P'], run: () => (ui.paletteOpen ? (ui.paletteOpen = false) : ui.openPalette()) },
    { id: 'file.quickOpen', title: 'Go to file…', category: 'File', shortcut: 'Mod+P', run: () => ui.openPalette('') },
    { id: 'file.open', title: 'Open file…', category: 'File', shortcut: 'Mod+O', run: openFilesDialog },
    { id: 'file.openFolder', title: 'Open folder…', category: 'File', shortcut: 'Mod+Shift+O', run: openFolderDialog },
    { id: 'file.new', title: 'New text file', category: 'File', shortcut: 'Mod+N', run: () => workspace.newUntitled('text') },
    { id: 'file.save', title: 'Save', category: 'File', shortcut: 'Mod+S', when: hasTab, run: () => workspace.save() },
    { id: 'file.saveAs', title: 'Save as…', category: 'File', shortcut: 'Mod+Shift+S', when: hasTab, run: () => workspace.save(workspace.active, true) },
    {
      id: 'file.saveAll',
      title: 'Save all',
      category: 'File',
      shortcut: 'Mod+Alt+S',
      run: async () => {
        for (const t of workspace.tabs) if (t.dirty) await workspace.save(t);
      },
    },
    { id: 'file.revert', title: 'Revert file (reload from disk)', category: 'File', when: hasFile, run: () => workspace.active && workspace.reloadTab(workspace.active) },
    {
      id: 'file.pin',
      title: 'Pin / unpin current file',
      category: 'File',
      when: hasFile,
      run: () => settings.togglePin(workspace.active!.filePath!),
    },
    {
      id: 'file.copyPath',
      title: 'Copy path of current file',
      category: 'File',
      when: () => !!workspace.active?.path,
      run: () => navigator.clipboard.writeText(workspace.active!.path!).then(() => ui.toast('Path copied', 'success')),
    },
    {
      id: 'file.reveal',
      title: 'Reveal current file in sidebar',
      category: 'File',
      when: () => hasFile() && !!workspace.folder,
      run: async () => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.mode = 'files';
        await tree.reveal(workspace.folder, workspace.active!.filePath!);
      },
    },
    { id: 'folder.close', title: 'Close folder', category: 'File', when: () => !!workspace.folder, run: () => workspace.closeFolder() },
    { id: 'folder.refresh', title: 'Refresh folder', category: 'File', when: () => !!workspace.folder, run: () => tree.refreshAll() },

    { id: 'tab.close', title: 'Close tab', category: 'Tabs', shortcut: 'Mod+W', when: hasTab, run: () => workspace.active && workspace.close(workspace.active) },
    { id: 'tab.closeOthers', title: 'Close other tabs', category: 'Tabs', when: hasTab, run: () => workspace.closeAll(workspace.active ?? undefined) },
    { id: 'tab.closeAll', title: 'Close all tabs', category: 'Tabs', when: hasTab, run: () => workspace.closeAll() },
    { id: 'tab.next', title: 'Next tab', category: 'Tabs', shortcut: ['Ctrl+Tab', 'Ctrl+PageDown', 'Mod+Alt+ArrowRight'], when: hasTab, run: () => workspace.cycle(1) },
    { id: 'tab.prev', title: 'Previous tab', category: 'Tabs', shortcut: ['Ctrl+Shift+Tab', 'Ctrl+PageUp', 'Mod+Alt+ArrowLeft'], when: hasTab, run: () => workspace.cycle(-1) },
    { id: 'tab.reopen', title: 'Reopen closed tab', category: 'Tabs', shortcut: 'Mod+Shift+T', run: () => workspace.reopenClosed() },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab.goto${i + 1}`,
      title: `Go to tab ${i + 1}`,
      category: 'Tabs',
      shortcut: `Mod+${i + 1}`,
      hidden: true,
      run: () => (i === 8 ? workspace.activateIndex(workspace.tabs.length - 1) : workspace.activateIndex(i)),
    })),

    { id: 'edit.find', title: 'Find', category: 'Edit', shortcut: 'Mod+F', when: () => !!workspace.active?.handlers.find, run: () => workspace.active?.handlers.find?.() },
    {
      id: 'search.inFolder',
      title: 'Find in folder…',
      category: 'Edit',
      shortcut: 'Mod+Shift+F',
      run: (arg) => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.searchRoot = typeof arg === 'string' ? arg : workspace.folder;
        sidebar.mode = 'search';
        queueMicrotask(() => document.querySelector<HTMLInputElement>('#folder-search')?.focus());
      },
    },

    { id: 'view.toggleSidebar', title: 'Toggle sidebar', category: 'View', shortcut: 'Mod+B', run: () => settings.update((s) => (s.sidebarVisible = !s.sidebarVisible)) },
    { id: 'view.showFiles', title: 'Show files', category: 'View', shortcut: 'Mod+Shift+E', run: () => {
        settings.update((s) => (s.sidebarVisible = true));
        sidebar.mode = 'files';
      } },
    { id: 'view.toggleTheme', title: 'Toggle dark / light theme', category: 'View', shortcut: 'Mod+Alt+T', run: () => theme.toggle() },
    { id: 'view.themeSystem', title: 'Theme: follow system', category: 'View', run: () => theme.set('system') },
    { id: 'view.themeDark', title: 'Theme: dark', category: 'View', run: () => theme.set('dark') },
    { id: 'view.themeLight', title: 'Theme: light', category: 'View', run: () => theme.set('light') },
    { id: 'view.toggleHidden', title: 'Show / hide hidden files', category: 'View', run: () => settings.update((s) => (s.showHidden = !s.showHidden)) },
    {
      id: 'help.shortcuts',
      title: 'Keyboard shortcuts',
      category: 'Help',
      shortcut: 'Mod+/',
      run: async () => {
        const lines = commands
          .all()
          .filter((c) => c.shortcut && !c.hidden)
          .map((c) => `${formatShortcut(commands.shortcutOf(c.id)!)}  —  ${c.category ? c.category + ': ' : ''}${c.title}`);
        await ui.ask({ title: 'Keyboard shortcuts', details: lines, buttons: [{ id: 'ok', label: 'Close', primary: true }] });
      },
    },
  );
}
