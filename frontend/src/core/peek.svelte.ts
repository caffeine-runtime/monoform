// Quick peek: the app was started with --peek to show one file in a small
// window of its own (pictures opened from Explorer, the "Quick peek with Hold
// It All" verb). Edit hands the file to the full editor, which opens it with
// everything (session, panels, tools), and closes the peek.
import { api } from './backend';
import { toastError } from './ui.svelte';
import { workspace } from './tabs.svelte';

class Peek {
  on = $state(false);

  async expand() {
    const p = workspace.active?.filePath;
    if (!this.on || !p) return;
    try {
      await api.OpenInEditor([p]);
    } catch (e) {
      toastError(e, 'Could not open the editor');
    }
  }
}

export const peek = new Peek();
