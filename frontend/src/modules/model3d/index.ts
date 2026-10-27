import { t } from '../../core/i18n';
import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { modelViews } from './views';

const active = () => (workspace.active ? modelViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const picked = () => !!active()?.hasSelection();

commands.register(
  { id: 'model.reset', title: t('Reset view'), category: '3D', shortcut: ['0', 'Home'], when: has, run: () => active()?.reset() },
  { id: 'model.wireframe', title: t('Toggle wireframe'), category: '3D', shortcut: 'W', when: has, run: () => active()?.toggle('wireframe') },
  { id: 'model.lighting', title: t('Toggle lighting'), category: '3D', shortcut: 'L', when: has, run: () => active()?.toggle('lighting') },
  { id: 'model.grid', title: t('Toggle floor grid'), category: '3D', shortcut: 'G', when: has, run: () => active()?.toggle('grid') },
  { id: 'model.playPause', title: t('Play / pause animation'), category: '3D', shortcut: 'Space', when: has, run: () => active()?.pause() },
  { id: 'model.hide', title: t('Hide selected parts'), category: '3D', shortcut: 'H', when: picked, run: () => active()?.hide() },
  { id: 'model.only', title: t('Show only the selected parts'), category: '3D', shortcut: 'I', when: picked, run: () => active()?.only() },
  { id: 'model.seeThrough', title: t('See-through other parts'), category: '3D', shortcut: 'X', when: picked, run: () => active()?.seeThrough() },
  { id: 'model.focus', title: t('Zoom to selected parts'), category: '3D', shortcut: 'F', when: picked, run: () => active()?.focus() },
  { id: 'model.showAll', title: t('Show all parts'), category: '3D', shortcut: 'Alt+H', when: () => !!active()?.hasHidden(), run: () => active()?.showAll() },
  { id: 'model.deselect', title: t('Deselect'), category: '3D', shortcut: 'Escape', hidden: true, when: picked, run: () => active()?.deselect() },
);

export { default } from './ModelModule.svelte';
