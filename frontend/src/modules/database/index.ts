import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { dbViews, type DbView } from './views';

const active = () => (workspace.active ? dbViews.get(workspace.active.id) : undefined);
const inData = () => active()?.pane() === 'data';
const run = (f: (v: DbView) => void) => () => {
  const v = active();
  if (v) f(v);
};

commands.register(
  { id: 'db.undo', title: 'Undo', category: 'Database', shortcut: 'Mod+Z', inInputs: false, hidden: true, when: inData, run: run((v) => v.undo()) },
  { id: 'db.redo', title: 'Redo', category: 'Database', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: inData, run: run((v) => v.redo()) },
  { id: 'db.addRow', title: 'Add row', category: 'Database', when: inData, run: run((v) => v.addRow()) },
  { id: 'db.deleteRows', title: 'Delete selected rows', category: 'Database', when: inData, run: run((v) => v.deleteSelected()) },
  { id: 'db.setNull', title: 'Set selected cells to NULL', category: 'Database', when: inData, run: run((v) => v.setNull()) },
  { id: 'db.run', title: 'Run SQL', category: 'Database', when: () => active()?.pane() === 'sql', run: run((v) => v.run()) },
);

export { default } from './DbModule.svelte';
