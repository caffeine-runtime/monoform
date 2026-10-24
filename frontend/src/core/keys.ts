// Keyboard shortcut parsing and matching. Shortcuts are written like
// "Mod+Shift+S" where Mod is Cmd on macOS and Ctrl elsewhere.

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface KeyCombo {
  key: string; // normalized key name, lower case ("s", "tab", "arrowleft", "f2", "=")
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  plus: '+',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  pgup: 'pageup',
  pgdn: 'pagedown',
};

export function parseShortcut(s: string, mac = isMac): KeyCombo {
  const parts = s.split('+').map((p) => p.trim());
  // "Mod++" means the plus key
  if (s.endsWith('++')) {
    parts.splice(parts.length - 2, 2, '+');
  }
  const combo: KeyCombo = { key: '', ctrl: false, meta: false, alt: false, shift: false };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'mod') {
      if (mac) combo.meta = true;
      else combo.ctrl = true;
    } else if (p === 'ctrl' || p === 'control') combo.ctrl = true;
    else if (p === 'cmd' || p === 'meta') combo.meta = true;
    else if (p === 'alt' || p === 'option') combo.alt = true;
    else if (p === 'shift') combo.shift = true;
    else combo.key = KEY_ALIASES[p] ?? p;
  }
  return combo;
}

/** Normalize a KeyboardEvent key, using `code` for letters/digits so Shift and layouts don't matter. */
export function eventKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (e.code?.startsWith('Key')) return e.code.slice(3).toLowerCase();
  if (e.code?.startsWith('Digit')) return e.code.slice(5);
  if (e.code === 'Equal') return '=';
  if (e.code === 'Minus') return '-';
  if (e.code === 'Comma') return ',';
  if (e.code === 'Period') return '.';
  if (e.code === 'Slash') return '/';
  if (e.code === 'Backslash') return '\\';
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';
  if (e.code === 'Semicolon') return ';';
  if (e.code === 'Quote') return "'";
  return (e.key || '').toLowerCase();
}

export function matches(combo: KeyCombo, e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  let key = eventKey(e);
  // Allow "Mod+=" and "Mod++" to both match the = / + key.
  if (combo.key === '+' && key === '=') key = '+';
  return (
    key === combo.key &&
    e.ctrlKey === combo.ctrl &&
    e.metaKey === combo.meta &&
    e.altKey === combo.alt &&
    (e.shiftKey === combo.shift || (combo.key === '+' && !combo.shift))
  );
}

/** Human-readable shortcut for menus and the palette. */
export function formatShortcut(s: string, mac = isMac): string {
  const c = parseShortcut(s, mac);
  const keyName = (k: string): string => {
    const names: Record<string, string> = {
      arrowleft: '←',
      arrowright: '→',
      arrowup: '↑',
      arrowdown: '↓',
      escape: 'Esc',
      tab: 'Tab',
      enter: mac ? '↩' : 'Enter',
      backspace: mac ? '⌫' : 'Backspace',
      delete: 'Del',
      ' ': 'Space',
      pageup: 'PgUp',
      pagedown: 'PgDn',
    };
    return names[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
  };
  if (mac) {
    return (c.ctrl ? '⌃' : '') + (c.alt ? '⌥' : '') + (c.shift ? '⇧' : '') + (c.meta ? '⌘' : '') + keyName(c.key);
  }
  const mods = [c.ctrl && 'Ctrl', c.meta && 'Win', c.alt && 'Alt', c.shift && 'Shift'].filter(Boolean);
  return [...mods, keyName(c.key)].join('+');
}
