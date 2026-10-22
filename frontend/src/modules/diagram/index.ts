import { commands } from '../../core/commands';
import { t } from '../../core/i18n';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { diagramViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? diagramViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'diagram.togglePreview', title: t('Toggle preview'), category: t('Diagram'), shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'diagram.split', title: t('Source and drawing'), category: t('Diagram'), when: () => !!active(), run: set('split') },
  { id: 'diagram.source', title: t('Source only'), category: t('Diagram'), when: () => !!active(), run: set('source') },
  { id: 'diagram.preview', title: t('Drawing only'), category: t('Diagram'), when: () => !!active(), run: set('preview') },
);

export { default } from './DiagramModule.svelte';
