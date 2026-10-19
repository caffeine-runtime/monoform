import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { htmlViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? htmlViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'html.togglePreview', title: 'Toggle page / source', category: 'HTML', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'html.split', title: 'Source and page', category: 'HTML', when: () => !!active(), run: set('split') },
  { id: 'html.source', title: 'Source only', category: 'HTML', when: () => !!active(), run: set('source') },
  { id: 'html.preview', title: 'Page only', category: 'HTML', when: () => !!active(), run: set('preview') },
  { id: 'html.reload', title: 'Reload page', category: 'HTML', shortcut: 'F5', when: () => !!active(), run: () => active()?.reload() },
);

export { default } from './HtmlModule.svelte';
