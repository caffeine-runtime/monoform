// Active-tab lookup for module commands: each mounted editor registers its
// controller under its tab id.
import { workspace } from '../../core/tabs.svelte';
import type { TextController } from './controller';

export const controllers = new Map<string, TextController>();

export function activeController(): TextController | undefined {
  const t = workspace.active;
  return t ? controllers.get(t.id) : undefined;
}
