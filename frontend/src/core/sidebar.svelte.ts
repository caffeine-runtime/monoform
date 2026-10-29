// Which panel the sidebar shows.
import { settings } from './settings.svelte';

class SidebarState {
  mode = $state<'files' | 'search'>('files');
  /** Folder the search panel searches (defaults to the open folder). */
  searchRoot = $state('');
  /** Show the sidebar at full width (to show files or a search in it). */
  show() {
    settings.update((s) => {
      s.sidebarVisible = true;
      s.sidebarCompact = false;
    });
  }
}
export const sidebar = new SidebarState();
