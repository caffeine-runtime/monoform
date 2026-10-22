import { t } from '../../core/i18n';
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
  { id: 'audio.playPause', title: t('Play / pause'), category: t('Audio'), shortcut: 'Space', when: has, run: run((v) => v.toggle()) },
  { id: 'audio.stop', title: t('Stop'), category: t('Audio'), when: has, run: run((v) => v.stop()) },
  { id: 'audio.loop', title: t('Loop selection'), category: t('Audio'), shortcut: 'L', when: has, run: run((v) => v.toggleLoop()) },
  { id: 'audio.cut', title: t('Cut'), category: t('Audio'), shortcut: 'Mod+X', inInputs: false, when: has, run: run((v) => v.edit('cut')) },
  { id: 'audio.copy', title: t('Copy'), category: t('Audio'), shortcut: 'Mod+C', inInputs: false, when: has, run: run((v) => v.edit('copy')) },
  { id: 'audio.paste', title: t('Paste'), category: t('Audio'), shortcut: 'Mod+V', inInputs: false, when: has, run: run((v) => v.edit('paste')) },
  { id: 'audio.delete', title: t('Delete selection'), category: t('Audio'), shortcut: ['Delete', 'Backspace'], inInputs: false, when: has, run: run((v) => v.edit('delete')) },
  { id: 'audio.trim', title: t('Trim to selection'), category: t('Audio'), shortcut: 'T', when: has, run: run((v) => v.edit('trim')) },
  { id: 'audio.silence', title: t('Silence selection'), category: t('Audio'), when: has, run: run((v) => v.edit('silence')) },
  { id: 'audio.fadeIn', title: t('Fade in'), category: t('Audio'), shortcut: 'I', when: has, run: run((v) => v.edit('fadeIn')) },
  { id: 'audio.fadeOut', title: t('Fade out'), category: t('Audio'), shortcut: 'O', when: has, run: run((v) => v.edit('fadeOut')) },
  { id: 'audio.gain', title: t('Change volume…'), category: t('Audio'), shortcut: 'G', when: has, run: run((v) => v.edit('gain')) },
  { id: 'audio.normalize', title: t('Normalize…'), category: t('Audio'), shortcut: 'N', when: has, run: run((v) => v.edit('normalize')) },
  { id: 'audio.selectAll', title: t('Select all'), category: t('Audio'), shortcut: 'Mod+A', inInputs: false, when: has, run: run((v) => v.edit('selectAll')) },
  { id: 'audio.undo', title: t('Undo'), category: t('Audio'), shortcut: 'Mod+Z', inInputs: false, when: has, run: run((v) => v.edit('undo')) },
  { id: 'audio.redo', title: t('Redo'), category: t('Audio'), shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, when: has, run: run((v) => v.edit('redo')) },
  { id: 'audio.zoomIn', title: t('Zoom in'), category: t('Audio'), shortcut: ['=', '+', 'Mod+='], when: has, run: run((v) => v.zoom(1)) },
  { id: 'audio.zoomOut', title: t('Zoom out'), category: t('Audio'), shortcut: ['-', 'Mod+-'], when: has, run: run((v) => v.zoom(-1)) },
  { id: 'audio.zoomFit', title: t('Zoom to fit'), category: t('Audio'), shortcut: ['0', 'Mod+0'], when: has, run: run((v) => v.zoom(0)) },
  { id: 'audio.back', title: t('Back 1 second'), category: t('Audio'), shortcut: 'ArrowLeft', when: has, run: run((v) => v.nudge(-1, false)) },
  { id: 'audio.forward', title: t('Forward 1 second'), category: t('Audio'), shortcut: 'ArrowRight', when: has, run: run((v) => v.nudge(1, false)) },
  { id: 'audio.selBack', title: t('Extend selection back'), category: t('Audio'), shortcut: 'Shift+ArrowLeft', when: has, run: run((v) => v.nudge(-1, true)) },
  { id: 'audio.selForward', title: t('Extend selection forward'), category: t('Audio'), shortcut: 'Shift+ArrowRight', when: has, run: run((v) => v.nudge(1, true)) },
  { id: 'audio.home', title: t('Go to start'), category: t('Audio'), shortcut: 'Home', when: has, run: run((v) => v.home(false)) },
  { id: 'audio.end', title: t('Go to end'), category: t('Audio'), shortcut: 'End', when: has, run: run((v) => v.end(false)) },
  { id: 'audio.selHome', title: t('Select to start'), category: t('Audio'), shortcut: 'Shift+Home', when: has, run: run((v) => v.home(true)) },
  { id: 'audio.selEnd', title: t('Select to end'), category: t('Audio'), shortcut: 'Shift+End', when: has, run: run((v) => v.end(true)) },
);

export { default } from './AudioModule.svelte';
