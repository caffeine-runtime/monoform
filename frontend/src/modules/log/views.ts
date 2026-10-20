export interface LogView {
  nextError: () => void;
  prevError: () => void;
  toggleFollow: () => void;
}
export const logViews = new Map<string, LogView>();
