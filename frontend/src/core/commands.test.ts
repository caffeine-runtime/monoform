import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './commands';
import { formatShortcut, parseShortcut, matches } from './keys';

function key(k: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const code = /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : '';
  return {
    key: k,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    ...opts,
  } as unknown as KeyboardEvent;
}

describe('keys', () => {
  it('maps Mod to Cmd on mac and Ctrl elsewhere', () => {
    expect(parseShortcut('Mod+S', true)).toMatchObject({ key: 's', meta: true, ctrl: false });
    expect(parseShortcut('Mod+S', false)).toMatchObject({ key: 's', meta: false, ctrl: true });
  });
  it('matches events by physical key', () => {
    const c = parseShortcut('Mod+Shift+P', false);
    expect(matches(c, key('P', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches(c, key('p', { ctrlKey: true }))).toBe(false);
  });
  it('matches ; and \' by physical key, whatever the layout types', () => {
    expect(matches(parseShortcut("Mod+'", false), key('ä', { code: 'Quote', ctrlKey: true }))).toBe(true);
    expect(matches(parseShortcut('Mod+Shift+;', false), key(':', { code: 'Semicolon', ctrlKey: true, shiftKey: true }))).toBe(true);
  });
  it('formats for display', () => {
    expect(formatShortcut('Mod+Shift+S', true)).toBe('⇧⌘S');
    expect(formatShortcut('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatShortcut('Ctrl+Tab', false)).toBe('Ctrl+Tab');
    expect(formatShortcut('Alt+Left', false)).toBe('Alt+←');
  });
});

describe('CommandRegistry', () => {
  it('registers, lists and unregisters', () => {
    const r = new CommandRegistry(false);
    const off = r.register({ id: 'a', title: 'A', run() {} }, { id: 'b', title: 'B', run() {}, hidden: true });
    expect(r.available().map((c) => c.id)).toEqual(['a']);
    off();
    expect(r.all()).toEqual([]);
  });

  it('respects when()', async () => {
    const r = new CommandRegistry(false);
    let on = false;
    const run = vi.fn();
    r.register({ id: 'x', title: 'X', when: () => on, run });
    expect(r.execute('x')).toBe(false);
    on = true;
    expect(r.execute('x')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalled();
  });

  it('dispatches shortcuts, later registrations win', async () => {
    const r = new CommandRegistry(false);
    const core = vi.fn();
    const mod = vi.fn();
    r.register({ id: 'core.find', title: 'Find', shortcut: 'Mod+F', run: core });
    let active = true;
    r.register({ id: 'pdf.find', title: 'Find in PDF', shortcut: 'Mod+F', when: () => active, run: mod });
    expect(r.handleKey(key('f', { ctrlKey: true }), false)).toBe(true);
    await new Promise((res) => setTimeout(res));
    expect(mod).toHaveBeenCalledTimes(1);
    active = false;
    r.handleKey(key('f', { ctrlKey: true }), false);
    await new Promise((res) => setTimeout(res));
    expect(core).toHaveBeenCalledTimes(1);
  });

  it('skips unmodified shortcuts inside inputs', () => {
    const r = new CommandRegistry(false);
    r.register({ id: 'next', title: 'Next', shortcut: 'ArrowRight', run() {} });
    expect(r.handleKey(key('ArrowRight'), true)).toBe(false);
    expect(r.handleKey(key('ArrowRight'), false)).toBe(true);
  });

  it('reports errors from commands', async () => {
    const r = new CommandRegistry(false);
    const onError = vi.fn();
    r.onError = onError;
    r.register({ id: 'bad', title: 'Bad', run: () => Promise.reject(new Error('nope')) });
    r.execute('bad');
    await new Promise((res) => setTimeout(res));
    expect(onError).toHaveBeenCalled();
  });
});
