export interface CompareView {
  next: () => void;
  prev: () => void;
  swap: () => void;
  refresh: () => void;
}
export const compareViews = new Map<string, CompareView>();
