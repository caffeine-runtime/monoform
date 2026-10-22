import { commands } from '../../core/commands';
import { activeCsv } from './controllers';
import { t } from '../../core/i18n';

commands.register(
  { id: 'csv.filter', title: t('Filter rows'), category: t('Table'), shortcut: 'Mod+Shift+L', when: () => !!activeCsv(), run: () => activeCsv()?.focusFilter() },
  { id: 'csv.addRow', title: t('Add row'), category: t('Table'), shortcut: 'Mod+Enter', when: () => !!activeCsv(), run: () => activeCsv()?.addRow() },
  { id: 'csv.deleteRow', title: t('Delete current row'), category: t('Table'), shortcut: 'Mod+Shift+Backspace', when: () => !!activeCsv(), run: () => activeCsv()?.deleteRow() },
);

export { default } from './CsvModule.svelte';
