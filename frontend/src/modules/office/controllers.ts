import { workspace } from '../../core/tabs.svelte';

export interface OfficeController {
  insertRow?(): void;
  deleteRow?(): void;
  bold?(): void;
  italic?(): void;
  underline?(): void;
  style?(s: string): void;
  link?(): void;
  /** Whether the caret is in the page, so Ctrl+B / Ctrl+K are the document's ("link" also needs a .docx). */
  ownsKey?(k: 'bold' | 'link'): boolean;
}
export const officeControllers = new Map<string, OfficeController>();
export function activeOffice(): OfficeController | undefined {
  const t = workspace.active;
  return t ? officeControllers.get(t.id) : undefined;
}
