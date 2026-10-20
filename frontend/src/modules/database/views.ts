export interface DbView {
  undo: () => void;
  redo: () => void;
  addRow: () => void;
  deleteSelected: () => void;
  setNull: () => void;
  run: () => void;
  pane: () => 'data' | 'structure' | 'sql';
}
export const dbViews = new Map<string, DbView>();
