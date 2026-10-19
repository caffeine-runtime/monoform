// The command registry. Every user-facing action is a command; the palette,
// menus and keyboard shortcuts all read from here, so a new module only has
// to register commands to be fully keyboard-accessible.
import { matches, parseShortcut, type KeyCombo } from './keys';

export interface Command {
  id: string;
  title: string;
  /** Group shown in the palette and menus, e.g. "File", "View", "Image". */
  category?: string;
  /** One shortcut or several (first is displayed). Uses "Mod" for Cmd/Ctrl. */
  shortcut?: string | string[];
  /** Only available (palette, shortcuts) when this returns true. */
  when?: () => boolean;
  run: (arg?: unknown) => unknown;
  /** Hide from the palette (still runs via shortcut). */
  hidden?: boolean;
  /** Let the shortcut run even when focus is in a text field/editor. Defaults to true for Mod/Alt combos. */
  inInputs?: boolean;
}

interface Binding {
  combo: KeyCombo;
  cmd: Command;
}

export class CommandRegistry {
  private cmds = new Map<string, Command>();
  private bindings: Binding[] = [];
  private listeners = new Set<() => void>();
  private mac: boolean;

  constructor(mac?: boolean) {
    this.mac = mac ?? (typeof navigator !== 'undefined' && /Mac/.test(navigator.platform));
  }

  /** Register commands; returns a function that unregisters them. */
  register(...cmds: Command[]): () => void {
    for (const c of cmds) {
      this.cmds.set(c.id, c);
    }
    this.rebuild();
    return () => {
      for (const c of cmds) if (this.cmds.get(c.id) === c) this.cmds.delete(c.id);
      this.rebuild();
    };
  }

  get(id: string): Command | undefined {
    return this.cmds.get(id);
  }

  /** All commands available in the current context, in registration order. */
  available(): Command[] {
    return [...this.cmds.values()].filter((c) => !c.hidden && this.enabled(c));
  }

  all(): Command[] {
    return [...this.cmds.values()];
  }

  enabled(c: Command): boolean {
    try {
      return !c.when || c.when();
    } catch {
      return false;
    }
  }

  /** Run a command by id. Returns false if it is unknown or unavailable. */
  execute(id: string, arg?: unknown): boolean {
    const c = this.cmds.get(id);
    if (!c || !this.enabled(c)) return false;
    void Promise.resolve()
      .then(() => c.run(arg))
      .catch((e) => this.onError?.(e, c));
    return true;
  }

  onError?: (e: unknown, c: Command) => void;

  /**
   * Find the command bound to a keyboard event. Later registrations win, so
   * a module can override a core shortcut while it is active (via `when`).
   */
  match(e: KeyboardEvent, inInput: boolean): Command | undefined {
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const b = this.bindings[i];
      if (!matches(b.combo, e)) continue;
      const modded = b.combo.ctrl || b.combo.meta || b.combo.alt || /^f\d+$/.test(b.combo.key);
      const allowInInput = b.cmd.inInputs ?? modded;
      if (inInput && !allowInInput) continue;
      if (!this.enabled(b.cmd)) continue;
      return b.cmd;
    }
    return undefined;
  }

  /** Handle a keydown; returns true when a command ran. */
  handleKey(e: KeyboardEvent, inInput: boolean): boolean {
    const c = this.match(e, inInput);
    if (!c) return false;
    e.preventDefault();
    e.stopPropagation();
    this.execute(c.id);
    return true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  shortcutOf(id: string): string | undefined {
    const s = this.cmds.get(id)?.shortcut;
    return Array.isArray(s) ? s[0] : s;
  }

  private rebuild() {
    this.bindings = [];
    for (const c of this.cmds.values()) {
      const list = c.shortcut ? (Array.isArray(c.shortcut) ? c.shortcut : [c.shortcut]) : [];
      for (const s of list) this.bindings.push({ combo: parseShortcut(s, this.mac), cmd: c });
    }
    for (const l of this.listeners) l();
  }
}

export const commands = new CommandRegistry();
