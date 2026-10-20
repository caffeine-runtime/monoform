import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { logViews, type LogView } from './views';

registerTextCommands();
const active = (): LogView | undefined => (workspace.active ? logViews.get(workspace.active.id) : undefined);
const has = () => !!active();
commands.register(
  { id: 'log.nextError', title: 'Next error', category: 'Log', shortcut: 'F8', when: has, run: () => active()?.nextError() },
  { id: 'log.prevError', title: 'Previous error', category: 'Log', shortcut: 'Shift+F8', when: has, run: () => active()?.prevError() },
  { id: 'log.follow', title: 'Follow (show new lines as the file grows)', category: 'Log', when: has, run: () => active()?.toggleFollow() },
);

export { default } from './LogModule.svelte';
