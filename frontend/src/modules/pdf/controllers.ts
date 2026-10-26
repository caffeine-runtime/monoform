import { workspace } from '../../core/tabs.svelte';

export interface PdfController {
  zoom(dir: 1 | -1 | 0): void;
  fit(mode: 'page-width' | 'page-fit'): void;
  tool(t: 'none' | 'highlight' | 'marker' | 'freetext' | 'ink' | 'shape' | 'eraser'): void;
  find(): void;
  findNext(prev: boolean): void;
  goto(): void;
  rotate(deg: number): void;
  deletePages(): void;
  extract(): void;
  merge(): void;
  split(): void;
  toggleThumbs(): void;
  escape(): boolean;
  sign(): void;
  redact(): void;
  compress(): void;
  exportImages(): void;
  insertPaper(paper: 'blank' | 'lined' | 'grid' | 'dotted'): void;
}

export const pdfControllers = new Map<string, PdfController>();

export function activePdf(): PdfController | undefined {
  const t = workspace.active;
  return t ? pdfControllers.get(t.id) : undefined;
}
