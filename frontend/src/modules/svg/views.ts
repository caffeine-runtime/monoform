export type ViewMode = 'design' | 'source' | 'split' | 'preview';
export interface SvgView {
  get: () => ViewMode;
  set: (v: ViewMode) => void;
  exportPng: () => void;
  fit: () => void;
  /** Design view operations (keyboard commands). */
  design: (op: 'delete' | 'duplicate' | 'deselect' | 'undo' | 'redo' | `nudge:${number},${number}` | `tool:${string}`) => void;
  hasSelection: () => boolean;
}
export const svgViews = new Map<string, SvgView>();
