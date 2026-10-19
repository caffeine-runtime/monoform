export type ViewMode = 'source' | 'split' | 'preview';
export interface SvgView {
  get: () => ViewMode;
  set: (v: ViewMode) => void;
  exportPng: () => void;
  fit: () => void;
}
export const svgViews = new Map<string, SvgView>();
