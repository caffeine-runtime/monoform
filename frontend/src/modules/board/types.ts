// What the board canvas (BoardCanvas.svelte) needs from a drawing format:
// Excalidraw and draw.io each implement it over their own file structure,
// changing only what an edit touches so the rest of the file is kept.

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'line' | 'draw';

export interface BoardItem {
  id: string;
  box: Box;
  /** Lines and arrows are resized by their points, not a box. */
  linear?: boolean;
  /** Can carry text (double-click edits it). */
  text?: boolean;
}

export interface BoardStyle {
  stroke: string;
  fill: string; // '' = none
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  /** Excalidraw only. */
  fillStyle?: 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
  roughness?: number;
  /** Sharp or rounded corners (rectangles, diamonds, connectors). */
  edges?: 'sharp' | 'round';
}

export interface TextEdit {
  box: Box;
  text: string;
  fontSize: number;
  font: string;
  align: 'left' | 'center' | 'right';
  color: string;
  /** Elements whose drawn text the edit box replaces while it is open. */
  hide?: string[];
}

export interface CreateOptions {
  /** Shapes under the start/end of a new arrow or line (to connect them). */
  startId?: string;
  endId?: string;
  /** Freehand points (absolute). */
  points?: Pt[];
}

export interface BoardAdapter {
  readonly tools: Tool[];
  /** Style controls this format has (fillStyle / roughness are Excalidraw's). */
  readonly styleKeys: (keyof BoardStyle)[];
  background(): string;
  /** Selectable items, bottom to top. */
  items(): BoardItem[];
  item(id: string): BoardItem | undefined;
  /** SVG for everything (each item a <g data-id="…">), in drawing coordinates. */
  render(): string;
  bounds(): Box;
  /** Items selected together with these (groups, bound text). */
  expand(ids: string[]): string[];
  move(ids: string[], dx: number, dy: number): void;
  resize(id: string, box: Box): void;
  textEdit(id: string): TextEdit | null;
  setText(id: string, text: string): void;
  create(tool: Tool, a: Pt, b: Pt, opts?: CreateOptions): string | null;
  remove(ids: string[]): void;
  duplicate(ids: string[]): string[];
  style(ids: string[]): BoardStyle;
  setStyle(ids: string[], s: Partial<BoardStyle>): void;
  reorder(ids: string[], where: 'front' | 'back'): void;
  serialize(): string;
  load(text: string): void;
}

export type Measure = (text: string, font: string) => number;

export function union(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function randomId(n = 20): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const v of r) s += a[v & 63];
  return s;
}
