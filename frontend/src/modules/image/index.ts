import { commands, type Command } from '../../core/commands';
import { t } from '../../core/i18n';
import { activeImage, type ImageController } from './editors';

const has = () => !!activeImage();
const edit = () => !!activeImage()?.editable();
const run = (fn: (c: ImageController) => void) => () => {
  const c = activeImage();
  if (c) fn(c);
};

const cmds: Command[] = [
  { id: 'image.fit', title: t('Fit to window'), category: t('Image'), shortcut: ['0', 'Mod+0'], when: has, run: run((c) => c.fit()) },
  { id: 'image.actual', title: t('Actual size'), category: t('Image'), shortcut: '1', when: has, run: run((c) => c.actual()) },
  { id: 'image.zoomIn', title: t('Zoom in'), category: t('Image'), shortcut: ['Mod+=', 'Mod++', '='], when: has, run: run((c) => c.zoom(1)) },
  { id: 'image.zoomOut', title: t('Zoom out'), category: t('Image'), shortcut: ['Mod+-', '-'], when: has, run: run((c) => c.zoom(-1)) },
  { id: 'image.next', title: t('Next image in folder'), category: t('Image'), shortcut: ['ArrowRight', 'PageDown'], when: has, run: run((c) => c.navigate(1)) },
  { id: 'image.prev', title: t('Previous image in folder'), category: t('Image'), shortcut: ['ArrowLeft', 'PageUp'], when: has, run: run((c) => c.navigate(-1)) },
  { id: 'image.escape', title: t('Cancel / deselect'), category: t('Image'), shortcut: 'Escape', when: has, hidden: true, run: run((c) => c.escape()) },
  { id: 'image.toolHand', title: t('Tool: hand (pan, select markup)'), category: t('Image'), shortcut: 'H', when: has, run: run((c) => c.tool('hand')) },
  { id: 'image.toolMove', title: t('Tool: move / rotate layer'), category: t('Image'), shortcut: 'V', when: edit, run: run((c) => c.tool('move')) },
  { id: 'image.toolSelect', title: t('Tool: rectangle select'), category: t('Image'), shortcut: 'M', when: edit, run: run((c) => c.tool('select')) },
  { id: 'image.toolEllipseSelect', title: t('Tool: ellipse select'), category: t('Image'), when: edit, run: run((c) => c.tool('ellipse')) },
  { id: 'image.toolLasso', title: t('Tool: lasso select'), category: t('Image'), shortcut: 'L', when: edit, run: run((c) => c.tool('lasso')) },
  { id: 'image.toolWand', title: t('Tool: magic wand'), category: t('Image'), shortcut: 'W', when: edit, run: run((c) => c.tool('wand')) },
  { id: 'image.toolObject', title: t('Tool: select object'), category: t('Image'), shortcut: 'O', when: edit, run: run((c) => c.tool('object')) },
  { id: 'image.toolCrop', title: t('Tool: crop'), category: t('Image'), shortcut: 'C', when: edit, run: run((c) => c.tool('crop')) },
  { id: 'image.toolBrush', title: t('Tool: brush'), category: t('Image'), shortcut: 'B', when: edit, run: run((c) => c.tool('brush')) },
  { id: 'image.toolEraser', title: t('Tool: eraser'), category: t('Image'), shortcut: 'E', when: edit, run: run((c) => c.tool('eraser')) },
  { id: 'image.toolArrow', title: t('Tool: arrow'), category: t('Image'), shortcut: 'A', when: edit, run: run((c) => c.tool('arrow')) },
  { id: 'image.toolRect', title: t('Tool: rectangle'), category: t('Image'), shortcut: 'R', when: edit, run: run((c) => c.tool('rect')) },
  { id: 'image.toolOval', title: t('Tool: ellipse'), category: t('Image'), when: edit, run: run((c) => c.tool('oval')) },
  { id: 'image.toolText', title: t('Tool: text'), category: t('Image'), shortcut: 'T', when: edit, run: run((c) => c.tool('text')) },
  { id: 'image.toolBlur', title: t('Tool: blur region'), category: t('Image'), shortcut: 'U', when: edit, run: run((c) => c.tool('blur')) },
  { id: 'image.toolPixelate', title: t('Tool: pixelate region'), category: t('Image'), shortcut: 'P', when: edit, run: run((c) => c.tool('pixelate')) },
  { id: 'image.apply', title: t('Apply crop / blur'), category: t('Image'), shortcut: 'Enter', when: edit, run: run((c) => c.apply()) },
  { id: 'image.rotateCW', title: t('Rotate clockwise'), category: t('Image'), shortcut: ']', when: edit, run: run((c) => c.rotate(true)) },
  { id: 'image.rotateCCW', title: t('Rotate counter-clockwise'), category: t('Image'), shortcut: '[', when: edit, run: run((c) => c.rotate(false)) },
  { id: 'image.rotateAngle', title: t('Rotate by angle…'), category: t('Image'), shortcut: 'Mod+Alt+R', when: edit, run: run((c) => c.rotateAngle()) },
  { id: 'image.flipH', title: t('Flip horizontally'), category: t('Image'), shortcut: 'Shift+H', when: edit, run: run((c) => c.flip(true)) },
  { id: 'image.flipV', title: t('Flip vertically'), category: t('Image'), shortcut: 'Shift+V', when: edit, run: run((c) => c.flip(false)) },
  { id: 'image.resize', title: t('Resize…'), category: t('Image'), shortcut: 'Mod+Alt+I', when: edit, run: run((c) => c.resize()) },
  { id: 'image.undo', title: t('Undo'), category: t('Image'), shortcut: 'Mod+Z', when: edit, run: run((c) => c.undo()) },
  { id: 'image.redo', title: t('Redo'), category: t('Image'), shortcut: ['Mod+Shift+Z', 'Mod+Y'], when: edit, run: run((c) => c.redo()) },
  { id: 'image.delete', title: t('Delete selected markup or pixels'), category: t('Image'), shortcut: ['Delete', 'Backspace'], when: edit, run: run((c) => c.deleteSelection()) },
  { id: 'image.copy', title: t('Copy selection'), category: t('Image'), shortcut: 'Mod+C', inInputs: false, when: edit, run: run((c) => c.copy(false)) },
  { id: 'image.copyMerged', title: t('Copy merged (all layers)'), category: t('Image'), shortcut: 'Mod+Shift+C', inInputs: false, when: edit, run: run((c) => c.copy(true)) },
  { id: 'image.cut', title: t('Cut selection'), category: t('Image'), shortcut: 'Mod+X', inInputs: false, when: edit, run: run((c) => c.cut()) },
  { id: 'image.paste', title: t('Paste as new layer'), category: t('Image'), shortcut: 'Mod+V', inInputs: false, when: edit, run: run((c) => c.paste()) },
  { id: 'image.selectAll', title: t('Select all'), category: t('Image'), shortcut: 'Mod+A', inInputs: false, when: edit, run: run((c) => c.selectAll()) },
  { id: 'image.deselect', title: t('Deselect'), category: t('Image'), shortcut: 'Mod+D', inInputs: false, when: edit, run: run((c) => c.deselect()) },
  { id: 'image.invertSelection', title: t('Invert selection'), category: t('Image'), shortcut: 'Mod+Shift+I', inInputs: false, when: edit, run: run((c) => c.invert()) },
  { id: 'image.layerFromSelection', title: t('New layer from selection'), category: t('Image'), shortcut: 'Mod+J', when: edit, run: run((c) => c.layerFromSelection()) },
  { id: 'image.newLayer', title: t('New layer'), category: t('Image'), shortcut: 'Mod+Shift+N', when: edit, run: run((c) => c.newLayer()) },
  { id: 'image.mergeDown', title: t('Merge layer down'), category: t('Image'), shortcut: 'Mod+E', when: edit, run: run((c) => c.mergeDown()) },
  { id: 'image.flatten', title: t('Flatten image'), category: t('Image'), when: edit, run: run((c) => c.flatten()) },
  { id: 'image.maskAdd', title: t('Mask: add to layer (from the selection, if any)'), category: t('Image'), when: edit, run: run((c) => c.mask('add')) },
  { id: 'image.maskEdit', title: t('Mask: paint on the mask / the pixels'), category: t('Image'), shortcut: 'Mod+Alt+M', when: edit, run: run((c) => c.mask('edit')) },
  { id: 'image.maskSwap', title: t('Mask: brush hides / shows'), category: t('Image'), shortcut: 'X', when: edit, run: run((c) => c.mask('swap')) },
  { id: 'image.maskHide', title: t('Mask: hide the selection'), category: t('Image'), when: edit, run: run((c) => c.mask('hide')) },
  { id: 'image.maskShow', title: t('Mask: show the selection'), category: t('Image'), when: edit, run: run((c) => c.mask('show')) },
  { id: 'image.maskInvert', title: t('Mask: invert'), category: t('Image'), when: edit, run: run((c) => c.mask('invert')) },
  { id: 'image.maskToggle', title: t('Mask: turn off / on'), category: t('Image'), when: edit, run: run((c) => c.mask('toggle')) },
  { id: 'image.maskApply', title: t('Mask: apply (erase what it hides)'), category: t('Image'), when: edit, run: run((c) => c.mask('apply')) },
  { id: 'image.maskDelete', title: t('Mask: delete'), category: t('Image'), when: edit, run: run((c) => c.mask('delete')) },
  { id: 'image.removeBackground', title: t('Remove background'), category: t('Image'), when: edit, run: run((c) => c.removeBackground()) },
  { id: 'image.selectSubject', title: t('Select subject'), category: t('Image'), when: edit, run: run((c) => c.selectSubject()) },
  { id: 'image.removeObject', title: t('Remove object (fill the gap)'), category: t('Image'), when: edit, run: run((c) => c.removeObject()) },
  { id: 'image.saveCopy', title: t('Save a copy (keep original)'), category: t('Image'), shortcut: 'Mod+Alt+S', when: edit, run: run((c) => c.saveCopy()) },
  { id: 'image.saveLayers', title: t('Save with layers (.ora)…'), category: t('Image'), when: edit, run: run((c) => c.saveLayers()) },
  { id: 'image.layers', title: t('Show layers'), category: t('Image'), when: edit, run: run((c) => c.panel('layers')) },
  { id: 'image.adjust', title: t('Adjust colours (brightness, contrast, saturation…)'), category: t('Image'), when: edit, run: run((c) => c.panel('adjust')) },
];
commands.register(...cmds);

export { default } from './ImageModule.svelte';
