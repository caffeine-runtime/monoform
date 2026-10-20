import { commands, type Command } from '../../core/commands';
import { activePdf, type PdfController } from './controllers';

const has = () => !!activePdf();
const run = (fn: (c: PdfController) => void) => () => {
  const c = activePdf();
  if (c) fn(c);
};

const cmds: Command[] = [
  { id: 'pdf.zoomIn', title: 'Zoom in', category: 'PDF', shortcut: ['Mod+=', 'Mod++'], when: has, run: run((c) => c.zoom(1)) },
  { id: 'pdf.zoomOut', title: 'Zoom out', category: 'PDF', shortcut: 'Mod+-', when: has, run: run((c) => c.zoom(-1)) },
  { id: 'pdf.zoomReset', title: 'Actual size', category: 'PDF', shortcut: 'Mod+0', when: has, run: run((c) => c.zoom(0)) },
  { id: 'pdf.fitWidth', title: 'Fit width', category: 'PDF', when: has, run: run((c) => c.fit('page-width')) },
  { id: 'pdf.fitPage', title: 'Fit page', category: 'PDF', when: has, run: run((c) => c.fit('page-fit')) },
  { id: 'pdf.findNext', title: 'Find next', category: 'PDF', shortcut: ['F3', 'Mod+G'], when: has, run: run((c) => c.findNext(false)) },
  { id: 'pdf.findPrev', title: 'Find previous', category: 'PDF', shortcut: ['Shift+F3', 'Mod+Shift+G'], when: has, run: run((c) => c.findNext(true)) },
  { id: 'pdf.goto', title: 'Go to page…', category: 'PDF', shortcut: 'Ctrl+G', when: has, run: run((c) => c.goto()) },
  { id: 'pdf.thumbs', title: 'Toggle page thumbnails', category: 'PDF', when: has, run: run((c) => c.toggleThumbs()) },
  { id: 'pdf.select', title: 'Tool: select text', category: 'PDF', when: has, run: run((c) => c.tool('none')) },
  { id: 'pdf.highlight', title: 'Tool: highlight', category: 'PDF', when: has, run: run((c) => c.tool('highlight')) },
  { id: 'pdf.freetext', title: 'Tool: text comment', category: 'PDF', when: has, run: run((c) => c.tool('freetext')) },
  { id: 'pdf.ink', title: 'Tool: draw', category: 'PDF', when: has, run: run((c) => c.tool('ink')) },
  { id: 'pdf.rotateCW', title: 'Rotate selected pages clockwise', category: 'PDF', when: has, run: run((c) => c.rotate(90)) },
  { id: 'pdf.rotateCCW', title: 'Rotate selected pages counter-clockwise', category: 'PDF', when: has, run: run((c) => c.rotate(-90)) },
  { id: 'pdf.delete', title: 'Delete selected pages', category: 'PDF', when: has, run: run((c) => c.deletePages()) },
  { id: 'pdf.extract', title: 'Extract pages to new PDF…', category: 'PDF', when: has, run: run((c) => c.extract()) },
  { id: 'pdf.merge', title: 'Append PDFs…', category: 'PDF', when: has, run: run((c) => c.merge()) },
  { id: 'pdf.split', title: 'Split into files…', category: 'PDF', when: has, run: run((c) => c.split()) },
  { id: 'pdf.sign', title: 'Sign…', category: 'PDF', when: has, run: run((c) => c.sign()) },
  { id: 'pdf.redact', title: 'Tool: redact (remove content under boxes)', category: 'PDF', when: has, run: run((c) => c.redact()) },
  { id: 'pdf.compress', title: 'Compress…', category: 'PDF', when: has, run: run((c) => c.compress()) },
  { id: 'pdf.exportImages', title: 'Export pages as images…', category: 'PDF', when: has, run: run((c) => c.exportImages()) },
  { id: 'pdf.escape', title: 'Back to select tool', category: 'PDF', shortcut: 'Escape', hidden: true, when: has, run: run((c) => c.escape()) },
];
commands.register(...cmds);

export { default } from './PdfModule.svelte';
