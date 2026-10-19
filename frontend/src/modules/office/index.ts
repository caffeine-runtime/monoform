import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { activeOffice } from './controllers';

const isDoc = () => workspace.active?.moduleId === 'doc' && !!activeOffice();
const isSheet = () => workspace.active?.moduleId === 'sheet' && !!activeOffice();
commands.register(
  { id: 'doc.heading1', title: 'Heading 1', category: 'Document', shortcut: 'Mod+Alt+1', when: isDoc, run: () => activeOffice()?.style?.('h1') },
  { id: 'doc.heading2', title: 'Heading 2', category: 'Document', shortcut: 'Mod+Alt+2', when: isDoc, run: () => activeOffice()?.style?.('h2') },
  { id: 'doc.heading3', title: 'Heading 3', category: 'Document', shortcut: 'Mod+Alt+3', when: isDoc, run: () => activeOffice()?.style?.('h3') },
  { id: 'doc.normal', title: 'Normal text', category: 'Document', shortcut: 'Mod+Alt+0', when: isDoc, run: () => activeOffice()?.style?.('p') },
  { id: 'doc.bold', title: 'Bold', category: 'Document', when: isDoc, run: () => activeOffice()?.bold?.() },
  { id: 'doc.italic', title: 'Italic', category: 'Document', when: isDoc, run: () => activeOffice()?.italic?.() },
  { id: 'doc.underline', title: 'Underline', category: 'Document', when: isDoc, run: () => activeOffice()?.underline?.() },
  { id: 'sheet.insertRow', title: 'Insert row above', category: 'Spreadsheet', shortcut: 'Mod+Shift+=', when: isSheet, run: () => activeOffice()?.insertRow?.() },
  { id: 'sheet.deleteRow', title: 'Delete row', category: 'Spreadsheet', shortcut: 'Mod+Shift+-', when: isSheet, run: () => activeOffice()?.deleteRow?.() },
);
