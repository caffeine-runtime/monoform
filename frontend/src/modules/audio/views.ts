export interface AudioView {
  toggle: () => void;
  stop: () => void;
  edit: (op: 'cut' | 'copy' | 'paste' | 'delete' | 'trim' | 'silence' | 'fadeIn' | 'fadeOut' | 'gain' | 'normalize' | 'selectAll' | 'undo' | 'redo') => void;
  zoom: (dir: 1 | -1 | 0) => void;
  nudge: (seconds: number, extend: boolean) => void;
  home: (extend: boolean) => void;
  end: (extend: boolean) => void;
  toggleLoop: () => void;
}
export const audioViews = new Map<string, AudioView>();
