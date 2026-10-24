// Per-tab controllers for image commands.
import { workspace } from '../../core/tabs.svelte';
import type { ModifyOp } from './vision/selmodify';
import type { WarpMode } from './warp';

export type MaskOp = 'add' | 'edit' | 'invert' | 'toggle' | 'apply' | 'delete' | 'hide' | 'show' | 'swap';

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
  canvasSize(): void;
  warp(mode: WarpMode): void;
  perspectiveCrop(): void;
  rotateAngle(): void;
  transformSelection(): void;
  rotateLayer(deg: number): void;
  rotateLayerAngle(): void;
  rotateView(deg: number, reset?: boolean): void;
  copy(merged: boolean): void;
  cut(): void;
  paste(): void;
  selectAll(): void;
  deselect(): void;
  invert(): void;
  modifySelection(op: ModifyOp): void;
  layerFromSelection(): void;
  newLayer(): void;
  mergeDown(): void;
  flatten(): void;
  mask(op: MaskOp): void;
  removeBackground(): void;
  openCleanup(): void;
  selectSubject(): void;
  removeObject(): void;
  saveCopy(): void;
  saveLayers(): void;
  panel(p: 'layers' | 'adjust'): void;
  editable(): boolean;
}

export const imageControllers = new Map<string, ImageController>();

export function activeImage(): ImageController | undefined {
  const t = workspace.active;
  return t ? imageControllers.get(t.id) : undefined;
}
