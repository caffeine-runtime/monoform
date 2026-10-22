import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { t } from '../../core/i18n';
import { registerTextCommands } from '../text/commands';
import { markdownViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? markdownViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'markdown.togglePreview', title: t('Toggle preview'), category: 'Markdown', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'markdown.split', title: t('Source and preview'), category: 'Markdown', when: () => !!active(), run: set('split') },
  { id: 'markdown.source', title: t('Source only'), category: 'Markdown', when: () => !!active(), run: set('source') },
  { id: 'markdown.preview', title: t('Preview only'), category: 'Markdown', when: () => !!active(), run: set('preview') },
);

export { default } from './MarkdownModule.svelte';
