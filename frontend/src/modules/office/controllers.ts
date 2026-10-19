import { workspace } from '../../core/tabs.svelte';

export interface OfficeController {
  insertRow?(): void;
  deleteRow?(): void;
  bold?(): void;
  italic?(): void;
  underline?(): void;
  style?(s: string): void;
}
export const officeControllers = new Map<string, OfficeController>();
export function activeOffice(): OfficeController | undefined {
  const t = workspace.active;
  return t ? officeControllers.get(t.id) : undefined;
}
