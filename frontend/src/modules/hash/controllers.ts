import { workspace } from '../../core/tabs.svelte';

export interface HashController {
  setFile(p: string): void;
  pick(): void;
}
export const hashControllers = new Map<string, HashController>();
export function activeHash(): HashController | undefined {
  const t = workspace.active;
  return t ? hashControllers.get(t.id) : undefined;
}
