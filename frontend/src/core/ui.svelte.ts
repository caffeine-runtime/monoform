// Transient UI: toasts and modal dialogs, driven by promises so any code can
// `await confirm(...)` without owning a component.

import { t } from './i18n';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
}

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  /** When set, the dialog shows a text input with this initial value. */
  input?: { value: string; placeholder?: string; selectStem?: boolean };
  /** Optional list shown under the message (e.g. file names). */
  details?: string[];
  resolve: (r: { button: string; value?: string }) => void;
}

export interface PickItem {
  id: string;
  label: string;
  detail?: string;
}

export interface PickRequest {
  title: string;
  items: PickItem[];
  resolve: (id: string | null) => void;
}

class UIState {
  toasts = $state<Toast[]>([]);
  picker = $state<PickRequest | null>(null);
  dialog = $state<DialogRequest | null>(null);
  paletteOpen = $state(false);
  /** The first-run welcome is showing. */
  firstRun = $state(false);
  paletteQuery = $state('');
  private seq = 0;

  toast(message: string, kind: ToastKind = 'info', action?: Toast['action'], ms?: number) { // i18n-ignore
    const id = ++this.seq;
    this.toasts = [...this.toasts, { id, kind, message, action }];
    setTimeout(() => this.dismiss(id), ms ?? (kind === 'error' ? 7000 : 3500));
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** Show a dialog; resolves with the clicked button id ("cancel" on Escape). */
  ask(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<{ button: string; value?: string }> { // i18n-ignore
    return new Promise((resolve) => {
      const prev = this.dialog;
      if (prev) prev.resolve({ button: 'cancel' });
      this.dialog = {
        ...req,
        id: ++this.seq,
        resolve: (r) => {
          this.dialog = null;
          resolve(r);
        },
      };
    });
  }

  async confirm(title: string, message: string, ok = t('OK'), danger = false): Promise<boolean> {
    const r = await this.ask({
      title,
      message,
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'ok', label: ok, primary: !danger, danger },
      ],
    });
    return r.button === 'ok';
  }

  async prompt(title: string, value = '', ok = t('OK'), selectStem = false): Promise<string | null> {
    const r = await this.ask({
      title,
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'ok', label: ok, primary: true },
      ],
      input: { value, selectStem },
    });
    return r.button === 'ok' ? (r.value ?? '') : null;
  }

  /** Quick-pick list (like the palette) resolving to the chosen id or null. */
  pick(title: string, items: PickItem[]): Promise<string | null> {
    return new Promise((resolve) => {
      this.picker?.resolve(null);
      this.picker = {
        title,
        items,
        resolve: (id) => {
          this.picker = null;
          resolve(id);
        },
      };
    });
  }

  openPalette(query = '') {
    this.paletteQuery = query;
    this.paletteOpen = true;
  }
}

export const ui = new UIState();

export function toastError(e: unknown, prefix = '') {
  const msg = e instanceof Error ? e.message : String(e);
  ui.toast(prefix ? `${prefix}: ${msg}` : msg, 'error');
}

export interface MenuItem {
  label?: string;
  shortcut?: string;
  run?: () => unknown;
  disabled?: boolean;
  separator?: boolean;
  /** A submenu (opens on hover, click or →). */
  items?: MenuItem[];
  /** An on/off option: shown with a check mark when on (the label names the thing). */
  checked?: boolean;
  /** A compact control on one row, in place of a list of items. */
  control?: MenuControl;
}

/** Theme (System/Light/Dark), interface size and text size sliders, split layouts. */
export type MenuControl = 'theme' | 'uiScale' | 'fontSize' | 'split';

class MenuState {
  open = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  show(e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) {
    if ('preventDefault' in e) e.preventDefault();
    this.open = { x: e.clientX, y: e.clientY, items };
  }
  close() {
    this.open = null;
  }
}

export const menu = new MenuState();
