import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { audioViews, type AudioView } from './views';

const active = () => (workspace.active ? audioViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const run = (f: (v: AudioView) => void) => () => {
  const v = active();
  if (v) f(v);
};

commands.register(
  { id: 'audio.playPause', title: 'Play / pause', category: 'Audio', shortcut: 'Space', when: has, run: run((v) => v.toggle()) },
  { id: 'audio.stop', title: 'Stop', category: 'Audio', when: has, run: run((v) => v.stop()) },
  { id: 'audio.loop', title: 'Loop selection', category: 'Audio', shortcut: 'L', when: has, run: run((v) => v.toggleLoop()) },
  { id: 'audio.cut', title: 'Cut', category: 'Audio', shortcut: 'Mod+X', inInputs: false, when: has, run: run((v) => v.edit('cut')) },
  { id: 'audio.copy', title: 'Copy', category: 'Audio', shortcut: 'Mod+C', inInputs: false, when: has, run: run((v) => v.edit('copy')) },
  { id: 'audio.paste', title: 'Paste', category: 'Audio', shortcut: 'Mod+V', inInputs: false, when: has, run: run((v) => v.edit('paste')) },
  { id: 'audio.delete', title: 'Delete selection', category: 'Audio', shortcut: ['Delete', 'Backspace'], inInputs: false, when: has, run: run((v) => v.edit('delete')) },
  { id: 'audio.trim', title: 'Trim to selection', category: 'Audio', shortcut: 'T', when: has, run: run((v) => v.edit('trim')) },
  { id: 'audio.silence', title: 'Silence selection', category: 'Audio', when: has, run: run((v) => v.edit('silence')) },
  { id: 'audio.fadeIn', title: 'Fade in', category: 'Audio', shortcut: 'I', when: has, run: run((v) => v.edit('fadeIn')) },
  { id: 'audio.fadeOut', title: 'Fade out', category: 'Audio', shortcut: 'O', when: has, run: run((v) => v.edit('fadeOut')) },
  { id: 'audio.gain', title: 'Change volume…', category: 'Audio', shortcut: 'G', when: has, run: run((v) => v.edit('gain')) },
  { id: 'audio.normalize', title: 'Normalize…', category: 'Audio', shortcut: 'N', when: has, run: run((v) => v.edit('normalize')) },
  { id: 'audio.selectAll', title: 'Select all', category: 'Audio', shortcut: 'Mod+A', inInputs: false, when: has, run: run((v) => v.edit('selectAll')) },
  { id: 'audio.undo', title: 'Undo', category: 'Audio', shortcut: 'Mod+Z', inInputs: false, when: has, run: run((v) => v.edit('undo')) },
  { id: 'audio.redo', title: 'Redo', category: 'Audio', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, when: has, run: run((v) => v.edit('redo')) },
  { id: 'audio.zoomIn', title: 'Zoom in', category: 'Audio', shortcut: ['=', '+', 'Mod+='], when: has, run: run((v) => v.zoom(1)) },
  { id: 'audio.zoomOut', title: 'Zoom out', category: 'Audio', shortcut: ['-', 'Mod+-'], when: has, run: run((v) => v.zoom(-1)) },
  { id: 'audio.zoomFit', title: 'Zoom to fit', category: 'Audio', shortcut: ['0', 'Mod+0'], when: has, run: run((v) => v.zoom(0)) },
  { id: 'audio.back', title: 'Back 1 second', category: 'Audio', shortcut: 'ArrowLeft', when: has, run: run((v) => v.nudge(-1, false)) },
  { id: 'audio.forward', title: 'Forward 1 second', category: 'Audio', shortcut: 'ArrowRight', when: has, run: run((v) => v.nudge(1, false)) },
  { id: 'audio.selBack', title: 'Extend selection back', category: 'Audio', shortcut: 'Shift+ArrowLeft', when: has, run: run((v) => v.nudge(-1, true)) },
  { id: 'audio.selForward', title: 'Extend selection forward', category: 'Audio', shortcut: 'Shift+ArrowRight', when: has, run: run((v) => v.nudge(1, true)) },
  { id: 'audio.home', title: 'Go to start', category: 'Audio', shortcut: 'Home', when: has, run: run((v) => v.home(false)) },
  { id: 'audio.end', title: 'Go to end', category: 'Audio', shortcut: 'End', when: has, run: run((v) => v.end(false)) },
  { id: 'audio.selHome', title: 'Select to start', category: 'Audio', shortcut: 'Shift+Home', when: has, run: run((v) => v.home(true)) },
  { id: 'audio.selEnd', title: 'Select to end', category: 'Audio', shortcut: 'Shift+End', when: has, run: run((v) => v.end(true)) },
);

export { default } from './AudioModule.svelte';
