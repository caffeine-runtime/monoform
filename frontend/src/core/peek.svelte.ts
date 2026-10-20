// Quick peek: the app was started with --peek to show one file in a small
// window. "Open in editor" turns it into the full editor (and brings back the
// session that peeking left alone).
import { api } from './backend';
import { settings } from './settings.svelte';
import { workspace } from './tabs.svelte';

class Peek {
  on = $state(false);

  async expand() {
    if (!this.on) return;
    const keep = workspace.active;
    this.on = false;
    void api.ExpandWindow();
    // Bring back the tabs of the last session (peeking didn't save over them).
    const session = settings.value.session;
    if (session?.tabs?.length) {
      const open = new Set(workspace.tabs.map((t) => t.path));
      const tabs = session.tabs.filter((t) => !t.path || !open.has(t.path));
      await workspace.restore({ ...session, tabs, active: -1, split: undefined });
    }
    if (keep) {
      await workspace.setPreview(keep, false);
      workspace.activate(keep);
    }
  }
}

export const peek = new Peek();
