import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { svgViews, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? svgViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);

commands.register(
  { id: 'svg.togglePreview', title: 'Toggle preview', category: 'SVG', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(active()!.get() === 'source' ? 'split' : active()!.get() === 'split' ? 'preview' : 'source') },
  { id: 'svg.split', title: 'Source and preview', category: 'SVG', when: () => !!active(), run: set('split') },
  { id: 'svg.source', title: 'Source only', category: 'SVG', when: () => !!active(), run: set('source') },
  { id: 'svg.preview', title: 'Preview only', category: 'SVG', when: () => !!active(), run: set('preview') },
  { id: 'svg.exportPng', title: 'Export as PNG…', category: 'SVG', when: () => !!active(), run: () => active()?.exportPng() },
);

export { default } from './SvgModule.svelte';
