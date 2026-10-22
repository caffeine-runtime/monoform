import { t } from '../../core/i18n';
import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { videoViews, type VideoView } from './views';
import { dropHandlers } from '../../core/drop';

const active = () => (workspace.active ? videoViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const run = (f: (v: VideoView) => void) => () => {
  const v = active();
  if (v) f(v);
};

commands.register(
  { id: 'video.playPause', title: t('Play / pause'), category: t('Video'), shortcut: ['Space', 'K'], when: has, run: run((v) => v.toggle()) },
  { id: 'video.frameBack', title: t('Previous frame'), category: t('Video'), shortcut: ',', when: has, run: run((v) => v.frame(-1)) },
  { id: 'video.frameForward', title: t('Next frame'), category: t('Video'), shortcut: '.', when: has, run: run((v) => v.frame(1)) },
  { id: 'video.back', title: t('Back 5 seconds'), category: t('Video'), shortcut: ['ArrowLeft', 'J'], when: has, run: run((v) => v.skip(-5)) },
  { id: 'video.forward', title: t('Forward 5 seconds'), category: t('Video'), shortcut: ['ArrowRight'], when: has, run: run((v) => v.skip(5)) },
  { id: 'video.home', title: t('Go to start'), category: t('Video'), shortcut: 'Home', when: has, run: run((v) => v.home()) },
  { id: 'video.end', title: t('Go to end'), category: t('Video'), shortcut: 'End', when: has, run: run((v) => v.end()) },
  { id: 'video.setIn', title: t('Mark selection start (in)'), category: t('Video'), shortcut: 'I', when: has, run: run((v) => v.edit('setIn')) },
  { id: 'video.setOut', title: t('Mark selection end (out)'), category: t('Video'), shortcut: 'O', when: has, run: run((v) => v.edit('setOut')) },
  { id: 'video.cut', title: t('Cut out selection'), category: t('Video'), shortcut: ['Delete', 'Backspace'], inInputs: false, when: has, run: run((v) => v.edit('cut')) },
  { id: 'video.keep', title: t('Keep only selection (trim)'), category: t('Video'), shortcut: 'T', when: has, run: run((v) => v.edit('keep')) },
  { id: 'video.rotate', title: t('Rotate 90° clockwise'), category: t('Video'), shortcut: 'R', when: has, run: run((v) => v.edit('rotate')) },
  { id: 'video.removeAudio', title: t('Remove audio track (when saving)'), category: t('Video'), when: has, run: run((v) => v.edit('removeAudio')) },
  { id: 'video.selectAll', title: t('Select all'), category: t('Video'), shortcut: 'Mod+A', inInputs: false, when: has, run: run((v) => v.edit('selectAll')) },
  { id: 'video.clearSel', title: t('Clear selection'), category: t('Video'), shortcut: 'Escape', when: has, run: run((v) => v.edit('clearSel')) },
  { id: 'video.restoreAll', title: t('Restore all removed parts'), category: t('Video'), when: has, run: run((v) => v.edit('restoreAll')) },
  { id: 'video.undo', title: t('Undo'), category: t('Video'), shortcut: 'Mod+Z', inInputs: false, when: has, run: run((v) => v.edit('undo')) },
  { id: 'video.redo', title: t('Redo'), category: t('Video'), shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, when: has, run: run((v) => v.edit('redo')) },
  { id: 'video.fullscreen', title: t('Full screen'), category: t('Video'), shortcut: 'F', when: has, run: run((v) => v.fullscreen()) },
  { id: 'video.snapshot', title: t('Save current frame as PNG…'), category: t('Video'), shortcut: 'P', when: has, run: run((v) => v.snapshot()) },
  { id: 'video.mute', title: t('Mute / unmute playback'), category: t('Video'), shortcut: 'M', when: has, run: run((v) => v.mute()) },
  { id: 'video.loop', title: t('Loop selection'), category: t('Video'), shortcut: 'L', when: has, run: run((v) => v.toggleLoop()) },
);

// Images dropped from the OS onto the picture become overlays.
dropHandlers.unshift((x, y, paths) => active()?.dropImages(paths, x, y) ?? false);

export { default } from './VideoModule.svelte';
