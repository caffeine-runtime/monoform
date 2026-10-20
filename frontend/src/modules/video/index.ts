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
  { id: 'video.playPause', title: 'Play / pause', category: 'Video', shortcut: ['Space', 'K'], when: has, run: run((v) => v.toggle()) },
  { id: 'video.frameBack', title: 'Previous frame', category: 'Video', shortcut: ',', when: has, run: run((v) => v.frame(-1)) },
  { id: 'video.frameForward', title: 'Next frame', category: 'Video', shortcut: '.', when: has, run: run((v) => v.frame(1)) },
  { id: 'video.back', title: 'Back 5 seconds', category: 'Video', shortcut: ['ArrowLeft', 'J'], when: has, run: run((v) => v.skip(-5)) },
  { id: 'video.forward', title: 'Forward 5 seconds', category: 'Video', shortcut: ['ArrowRight'], when: has, run: run((v) => v.skip(5)) },
  { id: 'video.home', title: 'Go to start', category: 'Video', shortcut: 'Home', when: has, run: run((v) => v.home()) },
  { id: 'video.end', title: 'Go to end', category: 'Video', shortcut: 'End', when: has, run: run((v) => v.end()) },
  { id: 'video.setIn', title: 'Mark selection start (in)', category: 'Video', shortcut: 'I', when: has, run: run((v) => v.edit('setIn')) },
  { id: 'video.setOut', title: 'Mark selection end (out)', category: 'Video', shortcut: 'O', when: has, run: run((v) => v.edit('setOut')) },
  { id: 'video.cut', title: 'Cut out selection', category: 'Video', shortcut: ['Delete', 'Backspace'], inInputs: false, when: has, run: run((v) => v.edit('cut')) },
  { id: 'video.keep', title: 'Keep only selection (trim)', category: 'Video', shortcut: 'T', when: has, run: run((v) => v.edit('keep')) },
  { id: 'video.rotate', title: 'Rotate 90° clockwise', category: 'Video', shortcut: 'R', when: has, run: run((v) => v.edit('rotate')) },
  { id: 'video.removeAudio', title: 'Remove audio track (when saving)', category: 'Video', when: has, run: run((v) => v.edit('removeAudio')) },
  { id: 'video.selectAll', title: 'Select all', category: 'Video', shortcut: 'Mod+A', inInputs: false, when: has, run: run((v) => v.edit('selectAll')) },
  { id: 'video.clearSel', title: 'Clear selection', category: 'Video', shortcut: 'Escape', when: has, run: run((v) => v.edit('clearSel')) },
  { id: 'video.restoreAll', title: 'Restore all removed parts', category: 'Video', when: has, run: run((v) => v.edit('restoreAll')) },
  { id: 'video.undo', title: 'Undo', category: 'Video', shortcut: 'Mod+Z', inInputs: false, when: has, run: run((v) => v.edit('undo')) },
  { id: 'video.redo', title: 'Redo', category: 'Video', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, when: has, run: run((v) => v.edit('redo')) },
  { id: 'video.fullscreen', title: 'Full screen', category: 'Video', shortcut: 'F', when: has, run: run((v) => v.fullscreen()) },
  { id: 'video.snapshot', title: 'Save current frame as PNG…', category: 'Video', shortcut: 'P', when: has, run: run((v) => v.snapshot()) },
  { id: 'video.mute', title: 'Mute / unmute playback', category: 'Video', shortcut: 'M', when: has, run: run((v) => v.mute()) },
  { id: 'video.loop', title: 'Loop selection', category: 'Video', shortcut: 'L', when: has, run: run((v) => v.toggleLoop()) },
);

// Images dropped from the OS onto the picture become overlays.
dropHandlers.unshift((x, y, paths) => active()?.dropImages(paths, x, y) ?? false);

export { default } from './VideoModule.svelte';
