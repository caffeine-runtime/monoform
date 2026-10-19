import { commands } from '../../core/commands';
import { registerTextCommands } from '../text/commands';
import { activeData } from './dataControllers';

registerTextCommands();
const has = () => !!activeData();
commands.register(
  { id: 'data.tree', title: 'Show tree', category: 'Data', shortcut: 'Mod+Alt+1', when: has, run: () => activeData()?.view('tree') },
  { id: 'data.raw', title: 'Show raw text', category: 'Data', shortcut: 'Mod+Alt+2', when: has, run: () => activeData()?.view('raw') },
  { id: 'data.json', title: 'Show YAML as JSON', category: 'Data', shortcut: 'Mod+Alt+3', when: has, run: () => activeData()?.view('json') },
  { id: 'data.pretty', title: 'Format (pretty-print)', category: 'Data', shortcut: 'Mod+Shift+I', when: has, run: () => activeData()?.pretty() },
  { id: 'data.minify', title: 'Minify', category: 'Data', when: has, run: () => activeData()?.minify() },
  { id: 'data.copyPath', title: 'Copy path of selected node', category: 'Data', when: has, run: () => activeData()?.copyPath() },
  { id: 'data.expandAll', title: 'Expand all', category: 'Data', when: has, run: () => activeData()?.expandAll() },
  { id: 'data.collapseAll', title: 'Collapse all', category: 'Data', when: has, run: () => activeData()?.collapseAll() },
);

export { default } from './DataModule.svelte';
