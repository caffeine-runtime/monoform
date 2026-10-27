export interface ModelView {
  reset: () => void;
  toggle: (which: 'wireframe' | 'lighting' | 'grid') => void;
  play: (i: number) => void;
  pause: () => void;
  /** Parts: the selected ones hidden, shown alone, the others see-through; everything shown again. */
  hide: () => void;
  only: () => void;
  seeThrough: () => void;
  showAll: () => void;
  focus: () => void;
  deselect: () => void;
  hasSelection: () => boolean;
  hasHidden: () => boolean;
}
export const modelViews = new Map<string, ModelView>();
