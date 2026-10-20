// Commands for text-based modules (text, markdown, raw views).
import { commands } from '../../core/commands';
import { settings } from '../../core/settings.svelte';
import { ui } from '../../core/ui.svelte';
import { activeController } from './controllers';
import { ENCODING_LABELS, labelOf, WRITABLE, type Encoding } from './encoding';
import { controllers } from './controllers';
import { formatShortcut } from '../../core/keys';
import { EditorSelection, type StateCommand } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { copyLineDown } from '@codemirror/commands';
import { selectSelectionMatches } from '@codemirror/search';
import * as ed from './editing';

let registered = false;

export function registerTextCommands() {
  if (registered) return;
  registered = true;
  const has = () => !!activeController();
  const run = (fn: (c: NonNullable<ReturnType<typeof activeController>>) => unknown) => () => {
    const c = activeController();
    if (c) return fn(c);
  };
  commands.register(
    { id: 'text.replace', title: 'Find and replace', category: 'Edit', shortcut: ['Mod+H', 'Mod+Alt+F'], when: has, run: run((c) => c.find(true)) },
    { id: 'text.gotoLine', title: 'Go to line…', category: 'Edit', shortcut: 'Ctrl+G', when: has, run: run((c) => c.gotoLine()) },
    { id: 'text.toggleWrap', title: 'Toggle word wrap', category: 'View', shortcut: 'Alt+Z', when: has, run: run((c) => c.toggleWrap()) },
    {
      id: 'text.zoomIn',
      title: 'Editor: larger font',
      category: 'View',
      shortcut: ['Mod+=', 'Mod++'],
      when: has,
      run: () => settings.update((s) => (s.fontSize = Math.min(32, s.fontSize + 1))),
    },
    { id: 'text.zoomOut', title: 'Editor: smaller font', category: 'View', shortcut: 'Mod+-', when: has, run: () => settings.update((s) => (s.fontSize = Math.max(9, s.fontSize - 1))) },
    { id: 'text.zoomReset', title: 'Editor: reset font size', category: 'View', shortcut: 'Mod+0', when: has, run: () => settings.update((s) => (s.fontSize = 14)) },
    // ---- Sublime-style editing (the keys also work inside the editor) ----
    { id: 'text.gotoSymbol', title: 'Go to symbol in file…', category: 'Go', shortcut: 'Mod+R', when: has, run: run((c) => gotoSymbol(c.view)) },
    ...(
      [
        ['text.splitLines', `Split selection into lines (${formatShortcut('Mod+Shift+L')})`, ed.splitIntoLines],
        ['text.selectAllMatches', `Select all occurrences (${formatShortcut('Alt+F3')})`, selectSelectionMatches],
        ['text.cursorAbove', `Add cursor above (${formatShortcut('Mod+Alt+ArrowUp')})`, ed.addCursorVertical(-1)],
        ['text.cursorBelow', `Add cursor below (${formatShortcut('Mod+Alt+ArrowDown')})`, ed.addCursorVertical(1)],
        ['text.selectLine', `Select line (${formatShortcut('Mod+L')})`, ed.expandToLine],
        ['text.duplicateLine', `Duplicate line (${formatShortcut('Mod+Shift+D')})`, copyLineDown],
        ['text.joinLines', `Join lines (${formatShortcut('Mod+J')})`, ed.joinLines],
        ['text.lineAbove', `Insert line above (${formatShortcut('Mod+Shift+Enter')})`, ed.insertLineAbove],
        ['text.sortLines', 'Sort lines (F9)', ed.sortLines],
        ['text.sortLinesNatural', 'Sort lines (natural, ignore case)', ed.sortLinesNatural],
        ['text.reverseLines', 'Reverse lines', ed.reverseLines],
        ['text.uniqueLines', 'Remove duplicate lines', ed.uniqueLines],
        ['text.trimTrailing', 'Trim trailing whitespace', ed.trimTrailing],
        ['text.upper', `Convert to UPPERCASE (${formatShortcut('Mod+K')} ${formatShortcut('Mod+U')})`, ed.transformCase('upper')],
        ['text.lower', `Convert to lowercase (${formatShortcut('Mod+K')} ${formatShortcut('Mod+L')})`, ed.transformCase('lower')],
        ['text.title', 'Convert to Title Case', ed.transformCase('title')],
        ['text.swapCase', 'Swap case', ed.transformCase('swap')],
      ] as [string, string, StateCommand][]
    ).map(([id, title, cmd]) => ({ id, title, category: 'Edit', when: has, run: run((c) => (c.view.focus(), cmd(c.view))) })),
    {
      id: 'text.toggleMinimap',
      title: 'Show / hide minimap',
      category: 'View',
      run: () => {
        settings.update((s) => (s.minimapOff = !s.minimapOff));
        for (const c of controllers.values()) c.applyPrefs();
      },
    },
    {
      id: 'text.toggleWhitespace',
      title: 'Show / hide whitespace (spaces and tabs)',
      category: 'View',
      run: () => {
        settings.update((s) => (s.showWhitespace = !s.showWhitespace));
        for (const c of controllers.values()) c.applyPrefs();
      },
    },
    {
      id: 'text.lineEndings',
      title: 'Change line endings…',
      category: 'Edit',
      when: () => !!activeController() && !activeController()!.tab.readOnly,
      run: run(async (c) => {
        const id = await ui.pick('Line endings', [
          { id: 'lf', label: 'LF', detail: 'Linux, macOS' },
          { id: 'crlf', label: 'CRLF', detail: 'Windows' },
        ]);
        if (id) c.setEol(id as 'lf' | 'crlf');
      }),
    },
    {
      id: 'text.saveEncoding',
      title: 'Change encoding for saving…',
      category: 'File',
      when: () => !!activeController() && !activeController()!.tab.readOnly,
      run: run(async (c) => {
        const id = await ui.pick(
          'Save with encoding',
          WRITABLE.map((e) => ({ id: e, label: labelOf(e), detail: e === c.encoding ? 'current' : '' })),
        );
        if (id) c.setEncoding(id as Encoding);
      }),
    },
    {
      id: 'text.reopenEncoding',
      title: 'Reopen with encoding…',
      category: 'File',
      when: () => !!activeController()?.tab.path,
      run: run(async (c) => {
        const id = await ui.pick(
          'Reopen with encoding',
          Object.keys(ENCODING_LABELS).filter((e) => e !== 'utf-8-bom').map((e) => ({ id: e, label: labelOf(e), detail: e === c.encoding ? 'current' : '' })),
        );
        if (id) await c.reopenWith(id as Encoding);
      }),
    },
  );
}

/** Pick a function/class/heading of the current file and jump there (Sublime: Ctrl+R). */
async function gotoSymbol(view: EditorView) {
  const syms = ed.symbols(view.state);
  if (!syms.length) {
    ui.toast('No symbols found in this file.', 'info');
    return;
  }
  const id = await ui.pick(
    'Go to symbol',
    syms.map((s, i) => ({ id: String(i), label: `${'  '.repeat(s.depth)}${s.name}`, detail: `${s.kind} · line ${s.line}` })),
  );
  if (id === null) return;
  const s = syms[+id];
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(s.from), effects: EditorView.scrollIntoView(s.from, { y: 'center' }) });
}
