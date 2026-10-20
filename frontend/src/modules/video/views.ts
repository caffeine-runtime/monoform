export type VideoOp = 'cut' | 'keep' | 'setIn' | 'setOut' | 'rotate' | 'removeAudio' | 'undo' | 'redo' | 'selectAll' | 'clearSel' | 'restoreAll';

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
  /** Images dropped from the OS at window point (x, y); true when handled. */
  dropImages: (paths: string[], x: number, y: number) => boolean;
}
export const videoViews = new Map<string, VideoView>();
