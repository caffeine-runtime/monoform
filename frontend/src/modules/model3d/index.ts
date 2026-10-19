import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { modelViews } from './views';

const active = () => (workspace.active ? modelViews.get(workspace.active.id) : undefined);
const has = () => !!active();

commands.register(
  { id: 'model.reset', title: 'Reset view', category: '3D', shortcut: ['0', 'Home'], when: has, run: () => active()?.reset() },
  { id: 'model.wireframe', title: 'Toggle wireframe', category: '3D', shortcut: 'W', when: has, run: () => active()?.toggle('wireframe') },
  { id: 'model.lighting', title: 'Toggle lighting', category: '3D', shortcut: 'L', when: has, run: () => active()?.toggle('lighting') },
  { id: 'model.grid', title: 'Toggle floor grid', category: '3D', shortcut: 'G', when: has, run: () => active()?.toggle('grid') },
  { id: 'model.playPause', title: 'Play / pause animation', category: '3D', shortcut: 'Space', when: has, run: () => active()?.pause() },
);

export { default } from './ModelModule.svelte';
