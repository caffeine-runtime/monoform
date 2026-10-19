// Per-tab controllers for image commands.
import { workspace } from '../../core/tabs.svelte';

export interface ImageController {
  fit(): void;
  actual(): void;
  zoom(dir: 1 | -1): void;
  tool(t: string): void;
  rotate(cw: boolean): void;
  flip(h: boolean): void;
  undo(): void;
  redo(): void;
  apply(): void;
  escape(): void;
  deleteSelection(): void;
  navigate(dir: 1 | -1): void;
  resize(): void;
  editable(): boolean;
}

export const imageControllers = new Map<string, ImageController>();

export function activeImage(): ImageController | undefined {
  const t = workspace.active;
  return t ? imageControllers.get(t.id) : undefined;
}
