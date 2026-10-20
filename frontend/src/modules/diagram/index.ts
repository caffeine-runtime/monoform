import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { diagramViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? diagramViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'diagram.togglePreview', title: 'Toggle preview', category: 'Diagram', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'diagram.split', title: 'Source and drawing', category: 'Diagram', when: () => !!active(), run: set('split') },
  { id: 'diagram.source', title: 'Source only', category: 'Diagram', when: () => !!active(), run: set('source') },
  { id: 'diagram.preview', title: 'Drawing only', category: 'Diagram', when: () => !!active(), run: set('preview') },
);

export { default } from './DiagramModule.svelte';
