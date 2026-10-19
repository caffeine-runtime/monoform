export interface ModelView {
  reset: () => void;
  toggle: (which: 'wireframe' | 'lighting' | 'grid') => void;
  play: (i: number) => void;
  pause: () => void;
}
export const modelViews = new Map<string, ModelView>();
