// Tabs and the workspace: which files are open, which one is active, and how
// a file is routed to a module.
import { api, errorMessage, fileUrl, readFile, saveFile, endpoint, type Body, type Entry, type SessionTab } from './backend';
import { modules } from './modules';
import { basename, dirname } from './paths';
import { settings } from './settings.svelte';
import { ui, toastError } from './ui.svelte';

export type TabSource =
  | { kind: 'file'; path: string }
  | { kind: 'archive-entry'; path: string; entry: string }
  | { kind: 'tool'; tool: string; path?: string }
  | { kind: 'untitled'; name: string };

/** Fields modules can show in the status bar. */
export interface StatusFields {
  position?: string;
  encoding?: string;
  eol?: string;
  info?: string;
  /** Overrides the file type label. */
  type?: string;
}

/** Hooks a module registers for its tab. */
export interface TabHandlers {
  /** Save to the current path. Return false if cancelled. */
  save?: () => Promise<boolean | void>;
  /** Save to a new path chosen by the module (usually via a dialog). */
  saveAs?: () => Promise<boolean | void>;
  find?: () => void;
  /** Reload content from disk after an external change. */
  reload?: () => Promise<void> | void;
  /** Called when the tab becomes visible again. */
  onShow?: () => void;
  /** Module state persisted in the session (view mode, scroll position...). */
  getState?: () => unknown;
  focus?: () => void;
}

let seq = 0;

export class Tab {
  readonly id = `tab-${++seq}`;
  source = $state<TabSource>({ kind: 'untitled', name: '' });
  moduleId = $state('');
  dirty = $state(false);
  readOnly = $state(false);
  /** Set when the file changed or vanished on disk while open. */
  external = $state<null | 'changed' | 'deleted'>(null);
  status = $state<StatusFields>({});
  size = $state<number | null>(null);
  /** Has this tab's module been mounted (it stays mounted while open). */
  mounted = $state(false);
  /** Module state restored from the session. */
  restoredState: unknown = undefined;
  /** Line to reveal after opening (search results, links). */
  reveal = $state<{ line?: number; col?: number; text?: string } | null>(null);
  handlers: TabHandlers = {};

  constructor(source: TabSource, moduleId: string) {
    this.source = source;
    this.moduleId = moduleId;
    this.readOnly = source.kind === 'archive-entry';
  }

  get path(): string | undefined {
    const s = this.source;
    return s.kind === 'file' || s.kind === 'archive-entry' ? s.path : s.kind === 'tool' ? s.path : undefined;
  }

  /** Path for files on disk (undefined for archive entries / untitled). */
  get filePath(): string | undefined {
    return this.source.kind === 'file' ? this.source.path : undefined;
  }

  get title(): string {
    const s = this.source;
    switch (s.kind) {
      case 'file':
        return basename(s.path);
      case 'archive-entry':
        return basename(s.entry);
      case 'tool':
        return modules.get(s.tool)?.name ?? s.tool;
      case 'untitled':
        return s.name;
    }
  }

  get subtitle(): string {
    const s = this.source;
    if (s.kind === 'file') return s.path;
    if (s.kind === 'archive-entry') return `${s.entry} — in ${basename(s.path)}`;
    return '';
  }

  /** Name used for type detection (entry name inside archives). */
  get name(): string {
    const s = this.source;
    return s.kind === 'archive-entry' ? s.entry : s.kind === 'untitled' ? s.name : (this.path ?? '');
  }

  /** URL that streams this tab's bytes (file or archive entry). */
  url(): string {
    const s = this.source;
    if (s.kind === 'file') return fileUrl(s.path);
    if (s.kind === 'archive-entry') return endpoint('archive/entry', { archive: s.path, entry: s.entry });
    if (s.kind === 'tool' && s.path) return fileUrl(s.path);
    throw new Error('this tab has no backing file');
  }

  /** Read the tab's bytes. */
  async read(signal?: AbortSignal): Promise<ArrayBuffer> {
    if (this.source.kind === 'file') return readFile(this.source.path, signal);
    const res = await fetch(this.url(), { signal });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.arrayBuffer();
  }

  /** Write bytes to the tab's file (atomic). */
  async write(data: Body, path = this.filePath): Promise<Entry> {
    if (!path) throw new Error('no path to save to');
    const e = await saveFile(path, data);
    this.size = e.size;
    return e;
  }

  /** Point the tab at a new file after "Save As". */
  retarget(path: string) {
    const old = this.filePath;
    if (old === path) return;
    if (old) void api.UnwatchFile(old);
    this.source = { kind: 'file', path };
    this.readOnly = false;
    void api.WatchFile(path);
    settings.addRecent(path);
    workspace.touch();
  }
}

export interface OpenOptions {
  activate?: boolean;
  moduleId?: string;
  reveal?: Tab['reveal'];
  state?: unknown;
  /** Don't add to recents (session restore). */
  quiet?: boolean;
}

class Workspace {
  tabs = $state<Tab[]>([]);
  activeId = $state<string | null>(null);
  folder = $state<string>('');
  /** Bumped whenever something worth persisting in the session changes. */
  version = $state(0);
  closed: TabSource[] = [];
  private untitledSeq = 0;

  active = $derived<Tab | null>(this.tabs.find((t) => t.id === this.activeId) ?? null);
  dirtyCount = $derived(this.tabs.filter((t) => t.dirty).length);

  touch() {
    this.version++;
  }

  findByPath(path: string): Tab | undefined {
    return this.tabs.find((t) => t.source.kind === 'file' && t.source.path === path);
  }

  /** Decide which module handles a file: extension first, then sniffing in Go. */
  async moduleFor(name: string, path?: string): Promise<string> {
    const byExt = modules.forPath(name);
    if (byExt) return byExt.id;
    if (path) {
      try {
        const info = await api.DetectType(path);
        // Checksum lists like SHA256SUMS have no extension and a text MIME.
        if (info.kind === 'checksum' && modules.get('checksum')) return 'checksum';
        const m = modules.forMime(info.mime);
        if (m) return m.id;
        if (info.kind === 'binary') return 'binary';
      } catch {
        /* fall through */
      }
    }
    return 'text';
  }

  async openPath(path: string, opts: OpenOptions = {}): Promise<Tab | undefined> {
    const existing = this.findByPath(path);
    if (existing) {
      if (opts.reveal) existing.reveal = opts.reveal;
      if (opts.activate !== false) this.activate(existing);
      return existing;
    }
    let entry: Entry | undefined;
    try {
      entry = await api.Stat(path);
    } catch (e) {
      toastError(e, `Can't open ${basename(path)}`);
      settings.removeRecent(path);
      return;
    }
    if (entry.isDir) {
      await this.openFolder(path);
      return;
    }
    const moduleId = opts.moduleId ?? (await this.moduleFor(path, path));
    const tab = new Tab({ kind: 'file', path }, moduleId);
    tab.size = entry.size;
    tab.reveal = opts.reveal ?? null;
    tab.restoredState = opts.state;
    this.add(tab, opts.activate !== false);
    void api.WatchFile(path).catch(() => {});
    if (!opts.quiet) settings.addRecent(path);
    return tab;
  }

  async openArchiveEntry(archive: string, entry: string, opts: OpenOptions = {}): Promise<Tab> {
    const existing = this.tabs.find((t) => t.source.kind === 'archive-entry' && t.source.path === archive && t.source.entry === entry);
    if (existing) {
      this.activate(existing);
      return existing;
    }
    const moduleId = opts.moduleId ?? (await this.moduleFor(entry));
    const tab = new Tab({ kind: 'archive-entry', path: archive, entry }, moduleId);
    tab.restoredState = opts.state;
    this.add(tab, opts.activate !== false);
    return tab;
  }

  openTool(tool: string, path?: string, opts: OpenOptions = {}): Tab {
    const existing = this.tabs.find((t) => t.source.kind === 'tool' && t.source.tool === tool && (!path || t.source.path === path));
    if (existing) {
      if (path && existing.source.kind === 'tool') existing.source = { kind: 'tool', tool, path };
      this.activate(existing);
      return existing;
    }
    const tab = new Tab({ kind: 'tool', tool, path }, tool);
    tab.restoredState = opts.state;
    this.add(tab, opts.activate !== false);
    return tab;
  }

  newUntitled(moduleId = 'text'): Tab {
    const tab = new Tab({ kind: 'untitled', name: `Untitled-${++this.untitledSeq}` }, moduleId);
    this.add(tab, true);
    return tab;
  }

  private add(tab: Tab, activate: boolean) {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    const at = idx >= 0 ? idx + 1 : this.tabs.length;
    this.tabs.splice(at, 0, tab);
    if (activate || !this.activeId) this.activate(tab);
    this.touch();
  }

  activate(tab: Tab) {
    this.activeId = tab.id;
    tab.mounted = true;
    this.touch();
    queueMicrotask(() => tab.handlers.onShow?.());
  }

  activateIndex(i: number) {
    const t = this.tabs[i];
    if (t) this.activate(t);
  }

  cycle(delta: number) {
    if (!this.tabs.length) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
  }

  move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) return;
    const [t] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, t);
    this.touch();
  }

  /** Close a tab, asking to save if it has unsaved changes. */
  async close(tab: Tab, opts: { force?: boolean } = {}): Promise<boolean> {
    if (tab.dirty && !opts.force) {
      this.activate(tab);
      const r = await ui.ask({
        title: `Save changes to ${tab.title}?`,
        message: 'Your changes will be lost if you don’t save them.',
        buttons: [
          { id: 'discard', label: 'Don’t save', danger: true },
          { id: 'cancel', label: 'Cancel' },
          { id: 'save', label: 'Save', primary: true },
        ],
      });
      if (r.button === 'cancel') return false;
      if (r.button === 'save') {
        const ok = await this.save(tab);
        if (!ok) return false;
      }
    }
    const idx = this.tabs.indexOf(tab);
    if (idx < 0) return true;
    this.tabs.splice(idx, 1);
    if (tab.filePath) void api.UnwatchFile(tab.filePath);
    if (tab.source.kind !== 'untitled') this.closed.push($state.snapshot(tab.source) as TabSource);
    if (this.activeId === tab.id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = null;
      if (next) this.activate(next);
    }
    this.touch();
    return true;
  }

  async closeAll(except?: Tab): Promise<void> {
    for (const t of [...this.tabs]) {
      if (t === except) continue;
      if (!(await this.close(t))) return;
    }
  }

  async reopenClosed() {
    const s = this.closed.pop();
    if (!s) return;
    if (s.kind === 'file') await this.openPath(s.path);
    else if (s.kind === 'archive-entry') await this.openArchiveEntry(s.path, s.entry);
    else if (s.kind === 'tool') this.openTool(s.tool, s.path);
  }

  async save(tab: Tab | null = this.active, as = false): Promise<boolean> {
    if (!tab) return false;
    const h = as || tab.source.kind === 'untitled' || tab.readOnly ? (tab.handlers.saveAs ?? tab.handlers.save) : tab.handlers.save;
    if (!h) {
      ui.toast('This tab has nothing to save.');
      return false;
    }
    try {
      const r = await h();
      if (r === false) return false;
      tab.external = null;
      return true;
    } catch (e) {
      toastError(e, 'Save failed');
      return false;
    }
  }

  async openFolder(path: string) {
    this.folder = path;
    settings.addRecentFolder(path);
    this.touch();
  }

  closeFolder() {
    this.folder = '';
    this.touch();
  }

  /** Session snapshot for settings.session. */
  snapshot(expanded: string[]) {
    const tabs: SessionTab[] = [];
    for (const t of this.tabs) {
      const s = t.source;
      if (s.kind === 'untitled') continue;
      let state: string | undefined;
      try {
        const st = t.handlers.getState?.() ?? t.restoredState;
        if (st !== undefined) state = JSON.stringify(st);
      } catch {
        /* ignore */
      }
      tabs.push({
        kind: s.kind,
        path: s.kind === 'tool' ? (s.path ?? '') : s.path,
        entry: s.kind === 'archive-entry' ? s.entry : '',
        tool: s.kind === 'tool' ? s.tool : '',
        module: t.moduleId,
        state: state ?? '',
        pinned: false,
      } as SessionTab);
    }
    const persisted = this.tabs.filter((t) => t.source.kind !== 'untitled');
    const active = Math.max(0, persisted.findIndex((t) => t.id === this.activeId));
    return { folder: this.folder, tabs, active, expanded };
  }

  /** Recreate tabs from the session without loading their contents. */
  async restore(session: { folder: string; tabs: SessionTab[]; active: number }) {
    if (session.folder) this.folder = session.folder;
    const paths = session.tabs.map((t) => t.path ?? '');
    let exists: boolean[] = paths.map(() => true);
    try {
      exists = await api.Exists(paths);
    } catch {
      /* assume they exist */
    }
    let activeTab: Tab | undefined;
    session.tabs.forEach((st, i) => {
      if (st.kind !== 'tool' && !exists[i]) return;
      let state: unknown;
      try {
        state = st.state ? JSON.parse(st.state) : undefined;
      } catch {
        state = undefined;
      }
      const path = st.path ?? '';
      let source: TabSource;
      if (st.kind === 'archive-entry') source = { kind: 'archive-entry', path, entry: st.entry ?? '' };
      else if (st.kind === 'tool') source = { kind: 'tool', tool: st.tool ?? '', path: path || undefined };
      else source = { kind: 'file', path };
      const moduleId = st.module && modules.get(st.module) ? st.module : (modules.forPath(source.kind === 'archive-entry' ? source.entry : path)?.id ?? 'text');
      const tab = new Tab(source, moduleId);
      tab.restoredState = state;
      this.tabs.push(tab);
      if (source.kind === 'file') void api.WatchFile(source.path).catch(() => {});
      if (i === session.active) activeTab = tab;
    });
    const first = activeTab ?? this.tabs[0];
    if (first) this.activate(first);
  }

  /** Handle an fs:changed event for open files. */
  onExternalChange(path: string, op: string) {
    for (const t of this.tabs) {
      if (t.filePath !== path) continue;
      t.external = op === 'remove' || op === 'rename' ? 'deleted' : 'changed';
    }
  }

  async reloadTab(tab: Tab) {
    if (tab.filePath) {
      try {
        const e = await api.Stat(tab.filePath);
        tab.size = e.size;
      } catch (e) {
        toastError(e);
        return;
      }
    }
    tab.external = null;
    try {
      await tab.handlers.reload?.();
    } catch (e) {
      ui.toast(`Reload failed: ${errorMessage(e)}`, 'error');
    }
  }

  dirOfActive(): string | undefined {
    const p = this.active?.filePath;
    return p ? dirname(p) : this.folder || undefined;
  }
}

export const workspace = new Workspace();
