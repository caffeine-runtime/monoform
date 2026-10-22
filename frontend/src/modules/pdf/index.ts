import { commands, type Command } from '../../core/commands';
import { activePdf, type PdfController } from './controllers';
import { t } from '../../core/i18n';

const has = () => !!activePdf();
const run = (fn: (c: PdfController) => void) => () => {
  const c = activePdf();
  if (c) fn(c);
};

const cmds: Command[] = [
  { id: 'pdf.zoomIn', title: t('Zoom in'), category: 'PDF', shortcut: ['Mod+=', 'Mod++'], when: has, run: run((c) => c.zoom(1)) },
  { id: 'pdf.zoomOut', title: t('Zoom out'), category: 'PDF', shortcut: 'Mod+-', when: has, run: run((c) => c.zoom(-1)) },
  { id: 'pdf.zoomReset', title: t('Actual size'), category: 'PDF', shortcut: 'Mod+0', when: has, run: run((c) => c.zoom(0)) },
  { id: 'pdf.fitWidth', title: t('Fit width'), category: 'PDF', when: has, run: run((c) => c.fit('page-width')) },
  { id: 'pdf.fitPage', title: t('Fit page'), category: 'PDF', when: has, run: run((c) => c.fit('page-fit')) },
  { id: 'pdf.findNext', title: t('Find next'), category: 'PDF', shortcut: ['F3', 'Mod+G'], when: has, run: run((c) => c.findNext(false)) },
  { id: 'pdf.findPrev', title: t('Find previous'), category: 'PDF', shortcut: ['Shift+F3', 'Mod+Shift+G'], when: has, run: run((c) => c.findNext(true)) },
  { id: 'pdf.goto', title: t('Go to page…'), category: 'PDF', shortcut: 'Ctrl+G', when: has, run: run((c) => c.goto()) },
  { id: 'pdf.thumbs', title: t('Toggle page thumbnails'), category: 'PDF', when: has, run: run((c) => c.toggleThumbs()) },
  { id: 'pdf.select', title: t('Tool: {name}', { name: t('select text', {}, 'tool') }), category: 'PDF', when: has, run: run((c) => c.tool('none')) },
  { id: 'pdf.highlight', title: t('Tool: {name}', { name: t('highlight', {}, 'tool') }), category: 'PDF', when: has, run: run((c) => c.tool('highlight')) },
  { id: 'pdf.freetext', title: t('Tool: {name}', { name: t('text comment', {}, 'tool') }), category: 'PDF', when: has, run: run((c) => c.tool('freetext')) },
  { id: 'pdf.ink', title: t('Tool: {name}', { name: t('draw', {}, 'tool') }), category: 'PDF', when: has, run: run((c) => c.tool('ink')) },
  { id: 'pdf.rotateCW', title: t('Rotate selected pages clockwise'), category: 'PDF', when: has, run: run((c) => c.rotate(90)) },
  { id: 'pdf.rotateCCW', title: t('Rotate selected pages counter-clockwise'), category: 'PDF', when: has, run: run((c) => c.rotate(-90)) },
  { id: 'pdf.delete', title: t('Delete selected pages'), category: 'PDF', when: has, run: run((c) => c.deletePages()) },
  { id: 'pdf.extract', title: t('Extract pages to new PDF…'), category: 'PDF', when: has, run: run((c) => c.extract()) },
  { id: 'pdf.merge', title: t('Append PDFs…'), category: 'PDF', when: has, run: run((c) => c.merge()) },
  { id: 'pdf.split', title: t('Split into files…'), category: 'PDF', when: has, run: run((c) => c.split()) },
  { id: 'pdf.sign', title: t('Sign…'), category: 'PDF', when: has, run: run((c) => c.sign()) },
  { id: 'pdf.redact', title: t('Tool: {name}', { name: t('redact (remove content under boxes)', {}, 'tool') }), category: 'PDF', when: has, run: run((c) => c.redact()) },
  { id: 'pdf.compress', title: t('Compress…'), category: 'PDF', when: has, run: run((c) => c.compress()) },
  { id: 'pdf.exportImages', title: t('Export pages as images…'), category: 'PDF', when: has, run: run((c) => c.exportImages()) },
  { id: 'pdf.escape', title: t('Back to select tool'), category: 'PDF', shortcut: 'Escape', hidden: true, when: has, run: run((c) => c.escape()) },
];
commands.register(...cmds);

export { default } from './PdfModule.svelte';
