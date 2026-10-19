// Which panel the sidebar shows.
class SidebarState {
  mode = $state<'files' | 'search'>('files');
  /** Folder the search panel searches (defaults to the open folder). */
  searchRoot = $state('');
}
export const sidebar = new SidebarState();
