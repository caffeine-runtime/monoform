export type ViewMode = 'source' | 'split' | 'preview';
export const markdownViews = new Map<string, { get: () => ViewMode; set: (v: ViewMode) => void }>();
