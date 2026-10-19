export type ViewMode = 'source' | 'split' | 'preview';
export interface HtmlView {
  get: () => ViewMode;
  set: (v: ViewMode) => void;
  reload: () => void;
}
export const htmlViews = new Map<string, HtmlView>();
