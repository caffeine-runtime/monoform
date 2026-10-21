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
  { id: 'image.escape', title: 'Cancel / deselect', category: 'Image', shortcut: 'Escape', when: has, hidden: true, run: run((c) => c.escape()) },
  { id: 'image.toolHand', title: 'Tool: hand (pan, select markup)', category: 'Image', shortcut: 'H', when: has, run: run((c) => c.tool('hand')) },
  { id: 'image.toolMove', title: 'Tool: move / rotate layer', category: 'Image', shortcut: 'V', when: edit, run: run((c) => c.tool('move')) },
  { id: 'image.toolSelect', title: 'Tool: rectangle select', category: 'Image', shortcut: 'M', when: edit, run: run((c) => c.tool('select')) },
  { id: 'image.toolEllipseSelect', title: 'Tool: ellipse select', category: 'Image', when: edit, run: run((c) => c.tool('ellipse')) },
  { id: 'image.toolLasso', title: 'Tool: lasso select', category: 'Image', shortcut: 'L', when: edit, run: run((c) => c.tool('lasso')) },
  { id: 'image.toolWand', title: 'Tool: magic wand', category: 'Image', shortcut: 'W', when: edit, run: run((c) => c.tool('wand')) },
  { id: 'image.toolObject', title: 'Tool: select object', category: 'Image', shortcut: 'O', when: edit, run: run((c) => c.tool('object')) },
  { id: 'image.toolCrop', title: 'Tool: crop', category: 'Image', shortcut: 'C', when: edit, run: run((c) => c.tool('crop')) },
  { id: 'image.toolBrush', title: 'Tool: brush', category: 'Image', shortcut: 'B', when: edit, run: run((c) => c.tool('brush')) },
  { id: 'image.toolEraser', title: 'Tool: eraser', category: 'Image', shortcut: 'E', when: edit, run: run((c) => c.tool('eraser')) },
  { id: 'image.toolArrow', title: 'Tool: arrow', category: 'Image', shortcut: 'A', when: edit, run: run((c) => c.tool('arrow')) },
  { id: 'image.toolRect', title: 'Tool: rectangle', category: 'Image', shortcut: 'R', when: edit, run: run((c) => c.tool('rect')) },
  { id: 'image.toolOval', title: 'Tool: ellipse', category: 'Image', when: edit, run: run((c) => c.tool('oval')) },
  { id: 'image.toolText', title: 'Tool: text', category: 'Image', shortcut: 'T', when: edit, run: run((c) => c.tool('text')) },
  { id: 'image.toolBlur', title: 'Tool: blur region', category: 'Image', shortcut: 'U', when: edit, run: run((c) => c.tool('blur')) },
  { id: 'image.toolPixelate', title: 'Tool: pixelate region', category: 'Image', shortcut: 'P', when: edit, run: run((c) => c.tool('pixelate')) },
  { id: 'image.apply', title: 'Apply crop / blur', category: 'Image', shortcut: 'Enter', when: edit, run: run((c) => c.apply()) },
  { id: 'image.rotateCW', title: 'Rotate clockwise', category: 'Image', shortcut: ']', when: edit, run: run((c) => c.rotate(true)) },
  { id: 'image.rotateCCW', title: 'Rotate counter-clockwise', category: 'Image', shortcut: '[', when: edit, run: run((c) => c.rotate(false)) },
  { id: 'image.rotateAngle', title: 'Rotate by angle…', category: 'Image', shortcut: 'Mod+Alt+R', when: edit, run: run((c) => c.rotateAngle()) },
  { id: 'image.flipH', title: 'Flip horizontally', category: 'Image', shortcut: 'Shift+H', when: edit, run: run((c) => c.flip(true)) },
  { id: 'image.flipV', title: 'Flip vertically', category: 'Image', shortcut: 'Shift+V', when: edit, run: run((c) => c.flip(false)) },
  { id: 'image.resize', title: 'Resize…', category: 'Image', shortcut: 'Mod+Alt+I', when: edit, run: run((c) => c.resize()) },
  { id: 'image.undo', title: 'Undo', category: 'Image', shortcut: 'Mod+Z', when: edit, run: run((c) => c.undo()) },
  { id: 'image.redo', title: 'Redo', category: 'Image', shortcut: ['Mod+Shift+Z', 'Mod+Y'], when: edit, run: run((c) => c.redo()) },
  { id: 'image.delete', title: 'Delete selected markup or pixels', category: 'Image', shortcut: ['Delete', 'Backspace'], when: edit, run: run((c) => c.deleteSelection()) },
  { id: 'image.copy', title: 'Copy selection', category: 'Image', shortcut: 'Mod+C', inInputs: false, when: edit, run: run((c) => c.copy(false)) },
  { id: 'image.copyMerged', title: 'Copy merged (all layers)', category: 'Image', shortcut: 'Mod+Shift+C', inInputs: false, when: edit, run: run((c) => c.copy(true)) },
  { id: 'image.cut', title: 'Cut selection', category: 'Image', shortcut: 'Mod+X', inInputs: false, when: edit, run: run((c) => c.cut()) },
  { id: 'image.paste', title: 'Paste as new layer', category: 'Image', shortcut: 'Mod+V', inInputs: false, when: edit, run: run((c) => c.paste()) },
  { id: 'image.selectAll', title: 'Select all', category: 'Image', shortcut: 'Mod+A', inInputs: false, when: edit, run: run((c) => c.selectAll()) },
  { id: 'image.deselect', title: 'Deselect', category: 'Image', shortcut: 'Mod+D', inInputs: false, when: edit, run: run((c) => c.deselect()) },
  { id: 'image.invertSelection', title: 'Invert selection', category: 'Image', shortcut: 'Mod+Shift+I', inInputs: false, when: edit, run: run((c) => c.invert()) },
  { id: 'image.layerFromSelection', title: 'New layer from selection', category: 'Image', shortcut: 'Mod+J', when: edit, run: run((c) => c.layerFromSelection()) },
  { id: 'image.newLayer', title: 'New layer', category: 'Image', shortcut: 'Mod+Shift+N', when: edit, run: run((c) => c.newLayer()) },
  { id: 'image.mergeDown', title: 'Merge layer down', category: 'Image', shortcut: 'Mod+E', when: edit, run: run((c) => c.mergeDown()) },
  { id: 'image.flatten', title: 'Flatten image', category: 'Image', when: edit, run: run((c) => c.flatten()) },
  { id: 'image.maskAdd', title: 'Mask: add to layer (from the selection, if any)', category: 'Image', when: edit, run: run((c) => c.mask('add')) },
  { id: 'image.maskEdit', title: 'Mask: paint on the mask / the pixels', category: 'Image', shortcut: 'Mod+Alt+M', when: edit, run: run((c) => c.mask('edit')) },
  { id: 'image.maskSwap', title: 'Mask: brush hides / shows', category: 'Image', shortcut: 'X', when: edit, run: run((c) => c.mask('swap')) },
  { id: 'image.maskHide', title: 'Mask: hide the selection', category: 'Image', when: edit, run: run((c) => c.mask('hide')) },
  { id: 'image.maskShow', title: 'Mask: show the selection', category: 'Image', when: edit, run: run((c) => c.mask('show')) },
  { id: 'image.maskInvert', title: 'Mask: invert', category: 'Image', when: edit, run: run((c) => c.mask('invert')) },
  { id: 'image.maskToggle', title: 'Mask: turn off / on', category: 'Image', when: edit, run: run((c) => c.mask('toggle')) },
  { id: 'image.maskApply', title: 'Mask: apply (erase what it hides)', category: 'Image', when: edit, run: run((c) => c.mask('apply')) },
  { id: 'image.maskDelete', title: 'Mask: delete', category: 'Image', when: edit, run: run((c) => c.mask('delete')) },
  { id: 'image.removeBackground', title: 'Remove background', category: 'Image', when: edit, run: run((c) => c.removeBackground()) },
  { id: 'image.selectSubject', title: 'Select subject', category: 'Image', when: edit, run: run((c) => c.selectSubject()) },
  { id: 'image.saveCopy', title: 'Save a copy (keep original)', category: 'Image', shortcut: 'Mod+Alt+S', when: edit, run: run((c) => c.saveCopy()) },
  { id: 'image.saveLayers', title: 'Save with layers (.ora)…', category: 'Image', when: edit, run: run((c) => c.saveLayers()) },
  { id: 'image.layers', title: 'Show layers', category: 'Image', when: edit, run: run((c) => c.panel('layers')) },
  { id: 'image.adjust', title: 'Adjust colours (brightness, contrast, saturation…)', category: 'Image', when: edit, run: run((c) => c.panel('adjust')) },
];
commands.register(...cmds);

export { default } from './ImageModule.svelte';
