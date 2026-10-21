// Reactive settings mirror. Changes are persisted to Go (atomic JSON write)
// with a short debounce.
import { api, type Settings } from './backend';

class SettingsState {
  value = $state<Settings>({
    version: 1,
    theme: 'system',
    recents: [],
    recentFolders: [],
    pinned: [],
    sidebarVisible: true,
    sidebarWidth: 260,
    showHidden: false,
    wordWrap: false,
    fontSize: 14,
    uiScale: 1,
    minimapOff: false,
    showWhitespace: false,
    pathBarOff: false,
    panelsHidden: false,
    session: { folder: '', tabs: [], active: 0, expanded: [] },
  } as unknown as Settings);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;

  init(s: Settings) {
    this.value = s;
    this.ready = true;
  }

  /** Mutate settings and schedule a save. */
  update(fn: (s: Settings) => void) {
    fn(this.value);
    this.schedule();
  }

  schedule(delay = 400) {
    if (!this.ready) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.ready) return;
    try {
      await api.SaveSettings($state.snapshot(this.value) as Settings);
    } catch (e) {
      console.error('saving settings failed', e);
    }
  }

  addRecent(path: string) {
    if (this.value.recentsOff) return;
    this.update((s) => {
      s.recents = [path, ...s.recents.filter((p) => p !== path)].slice(0, 30);
    });
  }

  removeRecent(path: string) {
    this.update((s) => {
      s.recents = s.recents.filter((p) => p !== path);
    });
  }

  clearRecents() {
    this.update((s) => {
      s.recents = [];
    });
  }

  removeRecentFolder(path: string) {
    this.update((s) => {
      s.recentFolders = s.recentFolders.filter((p) => p !== path);
    });
  }

  clearRecentFolders() {
    this.update((s) => {
      s.recentFolders = [];
    });
  }

  /** Turning recents off also forgets the current lists. */
  setRecentsOff(off: boolean) {
    this.update((s) => {
      s.recentsOff = off;
      if (off) {
        s.recents = [];
        s.recentFolders = [];
      }
    });
  }

  addRecentFolder(path: string) {
    if (this.value.recentsOff) return;
    this.update((s) => {
      s.recentFolders = [path, ...s.recentFolders.filter((p) => p !== path)].slice(0, 10);
    });
  }

  isPinned(path: string): boolean {
    return this.value.pinned.includes(path);
  }

  togglePin(path: string) {
    this.update((s) => {
      s.pinned = s.pinned.includes(path) ? s.pinned.filter((p) => p !== path) : [...s.pinned, path];
    });
  }
}

export const settings = new SettingsState();
