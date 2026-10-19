import { workspace } from '../../core/tabs.svelte';

export interface DataController {
  view(v: string): void;
  pretty(): void;
  minify(): void;
  copyPath(): void;
  expandAll(): void;
  collapseAll(): void;
}
export const dataControllers = new Map<string, DataController>();
export function activeData(): DataController | undefined {
  const t = workspace.active;
  return t ? dataControllers.get(t.id) : undefined;
}
