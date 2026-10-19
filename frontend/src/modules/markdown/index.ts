import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { markdownViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? markdownViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'markdown.togglePreview', title: 'Toggle preview', category: 'Markdown', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'markdown.split', title: 'Source and preview', category: 'Markdown', when: () => !!active(), run: set('split') },
  { id: 'markdown.source', title: 'Source only', category: 'Markdown', when: () => !!active(), run: set('source') },
  { id: 'markdown.preview', title: 'Preview only', category: 'Markdown', when: () => !!active(), run: set('preview') },
);

export { default } from './MarkdownModule.svelte';
