import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { t } from '../../core/i18n';
import { activeOffice } from './controllers';

const isDoc = () => workspace.active?.moduleId === 'doc' && !!activeOffice();
// While typing in the page, Ctrl+B and Ctrl+K are Word's (bold, link), not the sidebar and the palette.
const owns = (k: 'bold' | 'link') => () => isDoc() && !!activeOffice()?.ownsKey?.(k);
const isSheet = () => workspace.active?.moduleId === 'sheet' && !!activeOffice();
commands.register(
  { id: 'doc.heading1', title: t('Heading 1'), category: t('Document'), shortcut: 'Mod+Alt+1', when: isDoc, run: () => activeOffice()?.style?.('h1') },
  { id: 'doc.heading2', title: t('Heading 2'), category: t('Document'), shortcut: 'Mod+Alt+2', when: isDoc, run: () => activeOffice()?.style?.('h2') },
  { id: 'doc.heading3', title: t('Heading 3'), category: t('Document'), shortcut: 'Mod+Alt+3', when: isDoc, run: () => activeOffice()?.style?.('h3') },
  { id: 'doc.normal', title: t('Normal text'), category: t('Document'), shortcut: 'Mod+Alt+0', when: isDoc, run: () => activeOffice()?.style?.('p') },
  { id: 'doc.bold', title: t('Bold'), category: t('Document'), when: isDoc, run: () => activeOffice()?.bold?.() },
  { id: 'doc.italic', title: t('Italic'), category: t('Document'), when: isDoc, run: () => activeOffice()?.italic?.() },
  { id: 'doc.underline', title: t('Underline'), category: t('Document'), when: isDoc, run: () => activeOffice()?.underline?.() },
  { id: 'doc.boldKey', title: t('Bold'), category: t('Document'), shortcut: 'Mod+B', hidden: true, when: owns('bold'), run: () => activeOffice()?.bold?.() },
  { id: 'doc.linkKey', title: t('Insert link'), category: t('Document'), shortcut: 'Mod+K', hidden: true, when: owns('link'), run: () => activeOffice()?.link?.() },
  { id: 'sheet.insertRow', title: t('Insert row above'), category: t('Spreadsheet'), shortcut: 'Mod+Shift+=', when: isSheet, run: () => activeOffice()?.insertRow?.() },
  { id: 'sheet.deleteRow', title: t('Delete row'), category: t('Spreadsheet'), shortcut: 'Mod+Shift+-', when: isSheet, run: () => activeOffice()?.deleteRow?.() },
);
