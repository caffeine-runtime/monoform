import { workspace } from '../../core/tabs.svelte';

export interface CsvController {
  addRow(): void;
  deleteRow(): void;
  focusFilter(): void;
}
export const csvControllers = new Map<string, CsvController>();
export function activeCsv(): CsvController | undefined {
  const t = workspace.active;
  return t ? csvControllers.get(t.id) : undefined;
}
