import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { dbViews, type DbView } from './views';
import { t } from '../../core/i18n';

const active = () => (workspace.active ? dbViews.get(workspace.active.id) : undefined);
const inData = () => active()?.pane() === 'data';
const run = (f: (v: DbView) => void) => () => {
  const v = active();
  if (v) f(v);
};

commands.register(
  { id: 'db.undo', title: t('Undo'), category: t('Database'), shortcut: 'Mod+Z', inInputs: false, hidden: true, when: inData, run: run((v) => v.undo()) },
  { id: 'db.redo', title: t('Redo'), category: t('Database'), shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: inData, run: run((v) => v.redo()) },
  { id: 'db.addRow', title: t('Add row'), category: t('Database'), when: inData, run: run((v) => v.addRow()) },
  { id: 'db.deleteRows', title: t('Delete selected rows'), category: t('Database'), when: inData, run: run((v) => v.deleteSelected()) },
  { id: 'db.setNull', title: t('Set selected cells to NULL'), category: t('Database'), when: inData, run: run((v) => v.setNull()) },
  { id: 'db.run', title: t('Run SQL'), category: t('Database'), when: () => active()?.pane() === 'sql', run: run((v) => v.run()) },
);

export { default } from './DbModule.svelte';
