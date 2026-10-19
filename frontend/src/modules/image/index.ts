import { commands, type Command } from '../../core/commands';
import { activeImage, type ImageController } from './editors';

const has = () => !!activeImage();
const edit = () => !!activeImage()?.editable();
const run = (fn: (c: ImageController) => void) => () => {
  const c = activeImage();
  if (c) fn(c);
};

const cmds: Command[] = [
  { id: 'image.fit', title: 'Fit to window', category: 'Image', shortcut: ['0', 'Mod+0'], when: has, run: run((c) => c.fit()) },
  { id: 'image.actual', title: 'Actual size', category: 'Image', shortcut: '1', when: has, run: run((c) => c.actual()) },
  { id: 'image.zoomIn', title: 'Zoom in', category: 'Image', shortcut: ['Mod+=', 'Mod++', '='], when: has, run: run((c) => c.zoom(1)) },
  { id: 'image.zoomOut', title: 'Zoom out', category: 'Image', shortcut: ['Mod+-', '-'], when: has, run: run((c) => c.zoom(-1)) },
  { id: 'image.next', title: 'Next image in folder', category: 'Image', shortcut: ['ArrowRight', 'PageDown'], when: has, run: run((c) => c.navigate(1)) },
  { id: 'image.prev', title: 'Previous image in folder', category: 'Image', shortcut: ['ArrowLeft', 'PageUp'], when: has, run: run((c) => c.navigate(-1)) },
  { id: 'image.toolHand', title: 'Tool: move / select', category: 'Image', shortcut: 'Escape', when: has, run: run((c) => c.escape()) },
  { id: 'image.toolCrop', title: 'Tool: crop', category: 'Image', shortcut: 'C', when: edit, run: run((c) => c.tool('crop')) },
  { id: 'image.toolArrow', title: 'Tool: arrow', category: 'Image', shortcut: 'A', when: edit, run: run((c) => c.tool('arrow')) },
  { id: 'image.toolRect', title: 'Tool: rectangle', category: 'Image', shortcut: 'R', when: edit, run: run((c) => c.tool('rect')) },
  { id: 'image.toolText', title: 'Tool: text', category: 'Image', shortcut: 'T', when: edit, run: run((c) => c.tool('text')) },
  { id: 'image.toolBlur', title: 'Tool: blur region', category: 'Image', shortcut: 'B', when: edit, run: run((c) => c.tool('blur')) },
  { id: 'image.toolPixelate', title: 'Tool: pixelate region', category: 'Image', shortcut: 'P', when: edit, run: run((c) => c.tool('pixelate')) },
  { id: 'image.apply', title: 'Apply crop / blur', category: 'Image', shortcut: 'Enter', when: edit, run: run((c) => c.apply()) },
  { id: 'image.rotateCW', title: 'Rotate clockwise', category: 'Image', shortcut: ']', when: edit, run: run((c) => c.rotate(true)) },
  { id: 'image.rotateCCW', title: 'Rotate counter-clockwise', category: 'Image', shortcut: '[', when: edit, run: run((c) => c.rotate(false)) },
  { id: 'image.flipH', title: 'Flip horizontally', category: 'Image', shortcut: 'Shift+H', when: edit, run: run((c) => c.flip(true)) },
  { id: 'image.flipV', title: 'Flip vertically', category: 'Image', shortcut: 'Shift+V', when: edit, run: run((c) => c.flip(false)) },
  { id: 'image.resize', title: 'Resize…', category: 'Image', shortcut: 'Mod+Alt+I', when: edit, run: run((c) => c.resize()) },
  { id: 'image.undo', title: 'Undo', category: 'Image', shortcut: 'Mod+Z', when: edit, run: run((c) => c.undo()) },
  { id: 'image.redo', title: 'Redo', category: 'Image', shortcut: ['Mod+Shift+Z', 'Mod+Y'], when: edit, run: run((c) => c.redo()) },
  { id: 'image.delete', title: 'Delete selected markup', category: 'Image', shortcut: ['Delete', 'Backspace'], when: edit, run: run((c) => c.deleteSelection()) },
];
commands.register(...cmds);

export { default } from './ImageModule.svelte';
