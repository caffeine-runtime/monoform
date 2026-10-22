import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { logViews, type LogView } from './views';
import { t } from '../../core/i18n';

registerTextCommands();
const active = (): LogView | undefined => (workspace.active ? logViews.get(workspace.active.id) : undefined);
const has = () => !!active();
commands.register(
  { id: 'log.nextError', title: t('Next error'), category: t('Log'), shortcut: 'F8', when: has, run: () => active()?.nextError() },
  { id: 'log.prevError', title: t('Previous error'), category: t('Log'), shortcut: 'Shift+F8', when: has, run: () => active()?.prevError() },
  { id: 'log.follow', title: t('Follow (show new lines as the file grows)'), category: t('Log'), when: has, run: () => active()?.toggleFollow() },
);

export { default } from './LogModule.svelte';
