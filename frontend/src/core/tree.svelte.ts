// Sidebar file tree state. Directories load lazily on expand; other
// expandable kinds (archives) plug in through registerExpander.
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api, type Entry } from './backend';
import { settings } from './settings.svelte';
import { toastError } from './ui.svelte';
import { t } from './i18n';

export interface TreeItem {
  /** Unique key: the path for files on disk. */
  id: string;
  name: string;
  isDir: boolean;
  /** Can be expanded (directories, archives). */
  expandable: boolean;
  kind: string;
  size: number;
  hidden?: boolean;
  /** File system path (for files/dirs on disk and for the archive itself). */
  path: string;
  /** Set for items inside an archive. */
  archive?: string;
  entry?: string;
}

export interface TreeRow {
  item: TreeItem;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export type Expander = (item: TreeItem) => Promise<TreeItem[]>;

export function entryToItem(e: Entry): TreeItem {
  return {
    id: e.path,
    name: e.name,
    isDir: e.isDir,
    expandable: e.isDir || tree.canExpand(e.kind),
    kind: e.isDir ? 'dir' : e.kind,
    size: e.size,
    hidden: e.hidden,
    path: e.path,
  };
}

class TreeState {
  children = new SvelteMap<string, TreeItem[]>();
  expanded = new SvelteSet<string>();
  loading = new SvelteSet<string>();
  selected = $state<string | null>(null);
  private items = new Map<string, TreeItem>();
  private expanders = new Map<string, Expander>();
  private watched = new Set<string>();

  registerExpander(kind: string, fn: Expander) {
    this.expanders.set(kind, fn);
  }

  canExpand(kind: string): boolean {
    return this.expanders.has(kind);
  }

  item(id: string): TreeItem | undefined {
    return this.items.get(id);
  }

  async loadChildren(item: TreeItem): Promise<void> {
    this.loading.add(item.id);
    try {
      let kids: TreeItem[];
      if (item.isDir && !item.archive) {
        const entries = await api.ListDir(item.path);
        kids = entries.map(entryToItem);
        if (!this.watched.has(item.path)) {
          this.watched.add(item.path);
          void api.WatchDir(item.path).catch(() => {});
        }
      } else {
        const ex = this.expanders.get(item.archive ? 'archive-dir' : item.kind);
        kids = ex ? await ex(item) : [];
      }
      for (const k of kids) this.items.set(k.id, k);
      this.children.set(item.id, kids);
    } catch (e) {
      toastError(e, t("Can't list {name}", { name: item.name }));
      this.expanded.delete(item.id);
    } finally {
      this.loading.delete(item.id);
    }
  }

  async setRoot(path: string, expanded: string[] = []) {
    this.reset();
    if (!path) return;
    const root: TreeItem = { id: path, name: path, isDir: true, expandable: true, kind: 'dir', size: 0, path };
    this.items.set(path, root);
    this.expanded.add(path);
    await this.loadChildren(root);
    // Re-open previously expanded directories (in order, parents first).
    for (const id of expanded) {
      const it = this.items.get(id);
      if (it && it.isDir && !it.archive) {
        this.expanded.add(id);
        await this.loadChildren(it);
      }
    }
  }

  reset() {
    for (const p of this.watched) void api.UnwatchDir(p).catch(() => {});
    this.watched.clear();
    this.children.clear();
    this.expanded.clear();
    this.items.clear();
    this.selected = null;
  }

  async toggle(item: TreeItem, open?: boolean) {
    const isOpen = this.expanded.has(item.id);
    const want = open ?? !isOpen;
    if (want === isOpen) return;
    if (want) {
      this.expanded.add(item.id);
      if (!this.children.has(item.id)) await this.loadChildren(item);
    } else {
      this.expanded.delete(item.id);
    }
    settings.schedule();
  }

  collapseAll(root: string) {
    for (const id of [...this.expanded]) if (id !== root) this.expanded.delete(id);
  }

  /** Reload a directory listing after a change on disk. */
  async refreshDir(path: string) {
    const it = this.items.get(path);
    if (it && this.children.has(path)) await this.loadChildren(it);
  }

  async refreshAll() {
    for (const id of [...this.children.keys()]) {
      const it = this.items.get(id);
      if (it && it.isDir && !it.archive) await this.loadChildren(it);
    }
  }

  /** Flattened visible rows below root. */
  rows(root: string, showHidden: boolean): TreeRow[] {
    const out: TreeRow[] = [];
    const walk = (id: string, depth: number) => {
      const kids = this.children.get(id);
      if (!kids) return;
      for (const k of kids) {
        if (k.hidden && !showHidden) continue;
        const expanded = this.expanded.has(k.id);
        out.push({ item: k, depth, expanded, loading: this.loading.has(k.id) });
        if (expanded) walk(k.id, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }

  /** Expanded directories to persist in the session. */
  expandedList(root: string): string[] {
    return [...this.expanded].filter((id) => id !== root && !this.items.get(id)?.archive && this.items.get(id)?.kind === 'dir');
  }

  /** Expand all ancestors of path (inside root) and select it. */
  async reveal(root: string, path: string) {
    if (!path.startsWith(root)) return;
    const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
    const rel = path.slice(root.length).split(/[\\/]/).filter(Boolean);
    let cur = root.replace(/[\\/]+$/, '');
    for (let i = 0; i < rel.length - 1; i++) {
      cur = cur + sep + rel[i];
      const it = this.items.get(cur);
      if (!it) break;
      await this.toggle(it, true);
    }
    this.selected = path;
  }
}

export const tree = new TreeState();
