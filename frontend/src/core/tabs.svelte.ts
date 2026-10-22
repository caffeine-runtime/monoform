// Tabs and the workspace: which files are open, which one is active, and how
// a file is routed to a module.
import { makeSplit, without, type Split, type SplitLayout } from './split';
import { api, errorMessage, fileUrl, readFile, saveFile, endpoint, type Body, type Entry, type SessionTab } from './backend';
import { modules } from './modules';
import { basename, dirname, extname, join } from './paths';
import { settings } from './settings.svelte';
import { ui, toastError, type MenuItem } from './ui.svelte';
import { t } from './i18n';
import type { Accepts, Transfer } from './transfer.svelte';

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
  /** Word and character counts (documents and notes). */
  counts?: string;
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
  /** What can be pasted or dropped here (images, text, files) and how it is taken. */
  accept?: Accepts;
  /** What Ctrl+C or a drag out of this view carries (the selection, the picture…). */
  give?: () => Transfer | null | Promise<Transfer | null>;
  /** The view's own right-click items for what is under the pointer (a table cell, a shape…); see core/contextMenu.ts. */
  contextMenu?: (e: MouseEvent) => MenuItem[] | null;
}

let seq = 0;

/** The start page shown as a tab ("new tab"). */
const isStart = (t: Tab) => t.source.kind === 'tool' && t.source.tool === 'start';

export class Tab {
  readonly id = `tab-${++seq}`;
  source = $state<TabSource>({ kind: 'untitled', name: '' });
  moduleId = $state('');
  private changed = $state(false);
  /**
   * A new document that isn't saved anywhere yet (pasted into an empty tab):
   * its name. The content lives in a temp file; Save asks where to keep it.
   */
  scratch = $state<string | null>(null);
  /** Unsaved changes — always true for a scratch document until it is saved. */
  get dirty(): boolean {
    return this.changed || !!this.scratch;
  }
  set dirty(v: boolean) {
    this.changed = v;
  }
  readOnly = $state(false);
  /** Preview mode: a file on disk shown read-only until the user chooses Edit. */
  preview = $state(false);
  /** Bumped to remount the module (switching between preview and editing). */
  mountKey = $state(0);
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
    if (this.scratch) return this.scratch;
    const s = this.source;
    switch (s.kind) {
      case 'file':
        return basename(s.path);
      case 'archive-entry':
        return basename(s.entry);
      case 'tool':
        if (s.tool === 'history' && s.path) return t('History · {name}', { name: basename(s.path) });
        return modules.get(s.tool)?.name ?? s.tool;
      case 'untitled':
        return s.name;
    }
  }

  get subtitle(): string {
    if (this.scratch) return t('Not saved yet');
    const s = this.source;
    if (s.kind === 'file') return s.path;
    if (s.kind === 'archive-entry') return t('{entry} — in {archive}', { entry: s.entry, archive: basename(s.path) });
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
    throw new Error(t('this tab has no backing file'));
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
    if (!path) throw new Error(t('no path to save to'));
    const e = await saveFile(path, data);
    this.size = e.size;
    return e;
  }

  /** Point the tab at a new file after "Save As". */
  retarget(path: string) {
    const old = this.filePath;
    if (old === path) return;
    if (this.scratch && old) {
      // Saved somewhere real: the temp copy goes.
      this.scratch = null;
      void api.RemoveTemp(old);
    }
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
  /** Open read-only until the user chooses Edit (default: the setting). */
  preview?: boolean;
  moduleId?: string;
  reveal?: Tab['reveal'];
  state?: unknown;
  /** Don't add to recents (session restore). */
  quiet?: boolean;
}

class Workspace {
  tabs = $state<Tab[]>([]);
  /** The focused tab (in split view: the focused pane's tab). */
  activeId = $state<string | null>(null);
  /** Split view: tabs shown side by side, or null for one tab. */
  split = $state<Split | null>(null);
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

  /** Is the tab on screen (the active one, or a pane of the split)? */
  isShown(id: string): boolean {
    return this.split ? this.split.panes.includes(id) : this.activeId === id;
  }

  /** Change the split; panes get mounted and told they're shown (their size changed). */
  setSplit(s: Split | null) {
    this.split = s;
    for (const id of s?.panes ?? []) {
      const t = this.tabs.find((x) => x.id === id);
      if (t) t.mounted = true;
    }
    if (s && this.activeId && !s.panes.includes(this.activeId)) this.activeId = s.panes[0];
    this.touch();
    this.notifyShown();
  }

  /** Split the window: the focused tab plus the next tabs. */
  splitView(layout: SplitLayout, count: number): boolean {
    if (!this.activeId) return false;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const others = [...this.tabs.slice(i + 1), ...this.tabs.slice(0, i)].map((t) => t.id);
    const s = makeSplit(layout, count, this.activeId, this.split, others);
    if (!s) return false;
    this.setSplit(s);
    return true;
  }

  private notifyShown() {
    queueMicrotask(() => {
      for (const t of this.tabs) if (this.isShown(t.id)) t.handlers.onShow?.();
    });
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
      toastError(e, t("Can't open {name}", { name: basename(path) }));
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
    if (opts.preview ?? settings.value.openInPreview) tab.preview = tab.readOnly = true;
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
    // History is one tab per file plus one for all files; other tools reuse their tab.
    const same = (p?: string) => (tool === 'history' ? (p ?? '') === (path ?? '') : !path || p === path);
    const existing = this.tabs.find((t) => t.source.kind === 'tool' && t.source.tool === tool && same(t.source.path));
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

  /** Switch a file tab between preview (read-only) and editing; its view is rebuilt. */
  async setPreview(tab: Tab, on: boolean): Promise<boolean> {
    if (tab.source.kind !== 'file' || tab.preview === on) return false;
    if (on && tab.dirty) {
      const r = await ui.ask({
        title: t('Save changes first?'),
        message: t('{name} has unsaved changes. Preview mode shows the file as it is on disk.', { name: tab.title }),
        buttons: [
          { id: 'cancel', label: t('Cancel') },
          { id: 'discard', label: t('Discard changes'), danger: true },
          { id: 'save', label: t('Save') },
        ],
      });
      if (r.button === 'cancel') return false;
      if (r.button === 'save' && !(await this.save(tab))) return false;
      tab.dirty = false;
    }
    tab.preview = on;
    tab.readOnly = on;
    tab.restoredState = undefined;
    tab.mountKey++;
    return true;
  }

  newUntitled(moduleId = 'text'): Tab {
    const tab = new Tab({ kind: 'untitled', name: t('Untitled-{n}', { n: String(++this.untitledSeq) }) }, moduleId);
    this.add(tab, true);
    return tab;
  }

  private add(tab: Tab, activate: boolean) {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    // Opening something from a "new tab" (the start page) puts it in that tab's place.
    const start = activate && idx >= 0 && isStart(this.tabs[idx]) && !isStart(tab) ? this.tabs[idx] : null;
    if (start) {
      this.tabs.splice(idx, 1, tab);
      if (this.split?.panes.includes(start.id)) this.split = { ...this.split, panes: this.split.panes.map((p) => (p === start.id ? tab.id : p)) };
      this.activate(tab);
      this.touch();
      return;
    }
    const at = idx >= 0 ? idx + 1 : this.tabs.length;
    this.tabs.splice(at, 0, tab);
    if (activate || !this.activeId) this.activate(tab);
    this.touch();
  }

  activate(tab: Tab) {
    // In split view, a tab that isn't shown takes the focused pane's place.
    const s = this.split;
    if (s && !s.panes.includes(tab.id)) {
      const at = Math.max(0, s.panes.indexOf(this.activeId ?? ''));
      const panes = [...s.panes];
      panes[at] = tab.id;
      this.split = { ...s, panes };
    }
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
        title: t('Save changes to {name}?', { name: tab.title }),
        message: t('Your changes will be lost if you don’t save them.'),
        buttons: [
          { id: 'discard', label: t('Don’t save'), danger: true },
          { id: 'cancel', label: t('Cancel') },
          { id: 'save', label: t('Save'), primary: true },
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
    if (tab.scratch && tab.filePath) void api.RemoveTemp(tab.filePath);
    else if (tab.source.kind !== 'untitled') this.closed.push($state.snapshot(tab.source) as TabSource);
    const wasSplit = this.split;
    this.split = without(this.split, tab.id);
    if (this.activeId === tab.id) {
      // Focus a remaining pane, else the neighbouring tab.
      const pane = wasSplit?.panes.find((p) => p !== tab.id && this.tabs.some((t) => t.id === p));
      const next = (pane && this.tabs.find((t) => t.id === pane)) || this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = null;
      if (next) this.activate(next);
    }
    if (wasSplit !== this.split) this.notifyShown();
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
    if (tab.scratch) return this.saveScratch(tab);
    const h = as || tab.source.kind === 'untitled' || tab.readOnly ? (tab.handlers.saveAs ?? tab.handlers.save) : tab.handlers.save;
    if (!h) {
      ui.toast(t('This tab has nothing to save.'));
      return false;
    }
    try {
      const r = await h();
      if (r === false) return false;
      tab.external = null;
      return true;
    } catch (e) {
      toastError(e, t('Save failed'));
      return false;
    }
  }

  /**
   * Open a temp file as a new, unsaved document called `name` (what was
   * pasted into an empty tab): it opens in the editor for its kind.
   */
  async openScratch(temp: string, name: string): Promise<Tab | undefined> {
    const tab = await this.openPath(temp, { quiet: true, preview: false });
    if (tab) tab.scratch = name;
    return tab;
  }

  /**
   * First save of a scratch document: ask where, let its editor write the
   * temp copy (in whatever way it saves), then copy that into place and point
   * the tab there.
   */
  private async saveScratch(tab: Tab): Promise<boolean> {
    const name = tab.scratch!;
    const ext = extname(name);
    let dest = await api.SaveFileDialog(t('Save as'), this.folder ? join(this.folder, name) : name, [{ name: ext.toUpperCase(), patterns: `*.${ext}` }]);
    if (!dest) return false;
    if (extname(dest) !== ext) dest += `.${ext}`;
    try {
      const h = tab.handlers.save;
      if (h && (await h()) === false) return false;
      const src = tab.filePath;
      if (!src) return false;
      await api.CopyFile(src, dest);
      tab.retarget(dest);
      tab.dirty = false;
      tab.external = null;
      return true;
    } catch (e) {
      toastError(e, t('Save failed'));
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
      if (s.kind === 'untitled' || t.scratch) continue;
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
    const persisted = this.tabs.filter((t) => t.source.kind !== 'untitled' && !t.scratch);
    const active = Math.max(0, persisted.findIndex((t) => t.id === this.activeId));
    const panes = this.split?.panes.map((id) => persisted.findIndex((t) => t.id === id)).filter((i) => i >= 0) ?? [];
    const split = this.split && panes.length >= 2 ? { layout: this.split.layout, panes, x: this.split.x, y: this.split.y } : undefined;
    return { folder: this.folder, tabs, active, expanded, split };
  }

  /** Recreate tabs from the session without loading their contents. */
  async restore(session: { folder: string; tabs: SessionTab[]; active: number; split?: { layout: string; panes: number[]; x: number; y: number } }) {
    if (session.folder) this.folder = session.folder;
    const paths = session.tabs.map((t) => t.path ?? '');
    let exists: boolean[] = paths.map(() => true);
    try {
      exists = await api.Exists(paths);
    } catch {
      /* assume they exist */
    }
    let activeTab: Tab | undefined;
    const byIndex = new Map<number, Tab>();
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
      byIndex.set(i, tab);
    });
    const sp = session.split;
    const panes = (sp?.panes ?? []).map((i) => byIndex.get(i)?.id).filter((x): x is string => !!x);
    if (sp && panes.length >= 2) this.setSplit({ layout: sp.layout as SplitLayout, panes, x: sp.x || 0.5, y: sp.y || 0.5 });
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
      ui.toast(t('Reload failed: {error}', { error: errorMessage(e) }), 'error');
    }
  }

  dirOfActive(): string | undefined {
    const p = this.active?.filePath;
    return p ? dirname(p) : this.folder || undefined;
  }
}

export const workspace = new Workspace();
