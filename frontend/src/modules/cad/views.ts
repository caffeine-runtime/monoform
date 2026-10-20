export type CadTool = 'select' | 'pan' | 'line' | 'polyline' | 'rect' | 'circle' | 'arc' | 'text' | 'measure' | 'move' | 'copy' | 'rotate' | 'scale';
export type CadOp = 'undo' | 'redo' | 'delete' | 'selectAll' | 'escape' | 'enter' | 'backspace' | 'fit' | 'zoomIn' | 'zoomOut' | 'snap' | 'grid' | 'ortho' | 'exportSvg' | 'exportPng' | 'duplicate';
export interface CadView {
  tool: (t: CadTool) => void;
  op: (o: CadOp) => void;
  editable: () => boolean;
}
export const cadViews = new Map<string, CadView>();
