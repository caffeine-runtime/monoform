import { commands } from '../../core/commands';
import { activeCsv } from './controllers';

commands.register(
  { id: 'csv.filter', title: 'Filter rows', category: 'Table', shortcut: 'Mod+Shift+L', when: () => !!activeCsv(), run: () => activeCsv()?.focusFilter() },
  { id: 'csv.addRow', title: 'Add row', category: 'Table', shortcut: 'Mod+Enter', when: () => !!activeCsv(), run: () => activeCsv()?.addRow() },
  { id: 'csv.deleteRow', title: 'Delete current row', category: 'Table', shortcut: 'Mod+Shift+Backspace', when: () => !!activeCsv(), run: () => activeCsv()?.deleteRow() },
);

export { default } from './CsvModule.svelte';
