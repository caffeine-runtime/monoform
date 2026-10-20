export type ViewMode = 'source' | 'split' | 'preview';
export const diagramViews = new Map<string, { get: () => ViewMode; set: (v: ViewMode) => void }>();
