export type VideoOp = 'cut' | 'keep' | 'setIn' | 'setOut' | 'rotate' | 'removeAudio' | 'undo' | 'redo' | 'selectAll' | 'clearSel';

export interface VideoView {
  toggle: () => void;
  frame: (dir: 1 | -1) => void;
  skip: (seconds: number) => void;
  home: () => void;
  end: () => void;
  edit: (op: VideoOp) => void;
  fullscreen: () => void;
  snapshot: () => void;
  mute: () => void;
  toggleLoop: () => void;
}
export const videoViews = new Map<string, VideoView>();
