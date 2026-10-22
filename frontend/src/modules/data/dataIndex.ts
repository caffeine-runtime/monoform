import { commands } from '../../core/commands';
import { registerTextCommands } from '../text/commands';
import { activeData } from './dataControllers';
import { t } from '../../core/i18n';

registerTextCommands();
const has = () => !!activeData();
commands.register(
  { id: 'data.tree', title: t('Show tree'), category: t('Data'), shortcut: 'Mod+Alt+1', when: has, run: () => activeData()?.view('tree') },
  { id: 'data.raw', title: t('Show raw text'), category: t('Data'), shortcut: 'Mod+Alt+2', when: has, run: () => activeData()?.view('raw') },
  { id: 'data.json', title: t('Show YAML as JSON'), category: t('Data'), shortcut: 'Mod+Alt+3', when: has, run: () => activeData()?.view('json') },
  { id: 'data.pretty', title: t('Format (pretty-print)'), category: t('Data'), shortcut: 'Mod+Shift+I', when: has, run: () => activeData()?.pretty() },
  { id: 'data.minify', title: t('Minify'), category: t('Data'), when: has, run: () => activeData()?.minify() },
  { id: 'data.copyPath', title: t('Copy path of selected node'), category: t('Data'), when: has, run: () => activeData()?.copyPath() },
  { id: 'data.expandAll', title: t('Expand all'), category: t('Data'), when: has, run: () => activeData()?.expandAll() },
  { id: 'data.collapseAll', title: t('Collapse all'), category: t('Data'), when: has, run: () => activeData()?.collapseAll() },
);

export { default } from './DataModule.svelte';
