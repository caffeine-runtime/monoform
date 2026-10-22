import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { t } from '../../core/i18n';
import { compareViews, type CompareView } from './views';

const active = (): CompareView | undefined => (workspace.active ? compareViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const run = (f: (v: CompareView) => void) => () => {
  const v = active();
  if (v) f(v);
};

commands.register(
  { id: 'compare.next', title: t('Next change'), category: t('Compare'), shortcut: ['F7', 'Alt+ArrowDown'], when: has, run: run((v) => v.next()) },
  { id: 'compare.prev', title: t('Previous change'), category: t('Compare'), shortcut: ['Shift+F7', 'Alt+ArrowUp'], when: has, run: run((v) => v.prev()) },
  { id: 'compare.swap', title: t('Swap left and right'), category: t('Compare'), when: has, run: run((v) => v.swap()) },
  { id: 'compare.refresh', title: t('Compare again'), category: t('Compare'), when: has, run: run((v) => v.refresh()) },
);

export { default } from './CompareModule.svelte';
