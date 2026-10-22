// The open folder's notes with their links and headings (indexed in Go,
// unchanged files remembered there), shared by every Markdown tab. A note
// outside the open folder uses its own folder.
import { api } from '../../core/backend';
import { dirname } from '../../core/paths';
import { workspace } from '../../core/tabs.svelte';
import type { IndexedNote } from './links';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** The folder whose notes link to each other: the open folder if the note is in it. */
export function vaultOf(path: string): string {
  const f = workspace.folder;
  if (f && norm(path).toLowerCase().startsWith(norm(f).toLowerCase() + '/')) return f;
  return dirname(path);
}

class NoteIndex {
  root = $state('');
  notes = $state.raw<IndexedNote[]>([]);
  truncated = $state(false);
  /** Bumped after every load (the same notes may come back as new objects). */
  version = $state(0);
  private loaded = 0;
  private pending: Promise<void> | null = null;
  private pendingRoot = '';

  paths(): string[] {
    return this.notes.map((n) => n.path);
  }

  get(path: string): IndexedNote | undefined {
    const p = norm(path);
    return this.notes.find((n) => norm(n.path) === p);
  }

  /** Index `root` (again if it is older than `maxAge` ms). */
  load(root: string, maxAge = 3000): Promise<void> {
    if (!root) return Promise.resolve();
    if (this.pending && this.pendingRoot === root) return this.pending;
    if (root === this.root && performance.now() - this.loaded < maxAge) return Promise.resolve();
    this.pendingRoot = root;
    this.pending = api
      .NoteIndex(root)
      .then((idx) => {
        if (this.pendingRoot !== root) return;
        this.root = root;
        this.notes = (idx.notes ?? []) as unknown as IndexedNote[];
        this.truncated = idx.truncated;
        this.loaded = performance.now();
        this.version++;
      })
      .catch((e) => console.warn('note index', e))
      .finally(() => {
        if (this.pendingRoot === root) this.pending = null;
      });
    return this.pending;
  }

  /** Re-read after a note was saved or created. */
  refresh(root = this.root): Promise<void> {
    return this.load(root, 0);
  }
}

export const noteIndex = new NoteIndex();
