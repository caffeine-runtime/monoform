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
import { t } from '../../core/i18n';

/** An encoding's name for display. */
const encodingLabel = (e: Encoding) => (e === 'utf-8-bom' ? t('UTF-8 with BOM') : labelOf(e));

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
    { id: 'text.replace', title: t('Find and replace'), category: t('Edit'), shortcut: ['Mod+H', 'Mod+Alt+F'], when: has, run: run((c) => c.find(true)) },
    { id: 'text.gotoLine', title: t('Go to line…'), category: t('Edit'), shortcut: 'Ctrl+G', when: has, run: run((c) => c.gotoLine()) },
    { id: 'text.toggleWrap', title: t('Toggle word wrap'), category: t('View'), shortcut: 'Alt+Z', when: has, run: run((c) => c.toggleWrap()) },
    {
      id: 'text.zoomIn',
      title: t('Editor: larger font'),
      category: t('View'),
      shortcut: ['Mod+=', 'Mod++'],
      when: has,
      run: () => settings.update((s) => (s.fontSize = Math.min(32, s.fontSize + 1))),
    },
    { id: 'text.zoomOut', title: t('Editor: smaller font'), category: t('View'), shortcut: 'Mod+-', when: has, run: () => settings.update((s) => (s.fontSize = Math.max(9, s.fontSize - 1))) },
    { id: 'text.zoomReset', title: t('Editor: reset font size'), category: t('View'), shortcut: 'Mod+0', when: has, run: () => settings.update((s) => (s.fontSize = 14)) },
    // ---- Sublime-style editing (the keys also work inside the editor) ----
    { id: 'text.gotoSymbol', title: t('Go to symbol in file…'), category: t('Go'), shortcut: 'Mod+R', when: has, run: run((c) => gotoSymbol(c.view)) },
    ...(
      [
        ['text.splitLines', t('Split selection into lines ({shortcut})', { shortcut: formatShortcut('Mod+Shift+L') }), ed.splitIntoLines],
        ['text.selectAllMatches', t('Select all occurrences ({shortcut})', { shortcut: formatShortcut('Alt+F3') }), selectSelectionMatches],
        ['text.cursorAbove', t('Add cursor above ({shortcut})', { shortcut: formatShortcut('Mod+Alt+ArrowUp') }), ed.addCursorVertical(-1)],
        ['text.cursorBelow', t('Add cursor below ({shortcut})', { shortcut: formatShortcut('Mod+Alt+ArrowDown') }), ed.addCursorVertical(1)],
        ['text.selectLine', t('Select line ({shortcut})', { shortcut: formatShortcut('Mod+L') }), ed.expandToLine],
        ['text.duplicateLine', t('Duplicate line ({shortcut})', { shortcut: formatShortcut('Mod+Shift+D') }), copyLineDown],
        ['text.joinLines', t('Join lines ({shortcut})', { shortcut: formatShortcut('Mod+J') }), ed.joinLines],
        ['text.lineAbove', t('Insert line above ({shortcut})', { shortcut: formatShortcut('Mod+Shift+Enter') }), ed.insertLineAbove],
        ['text.sortLines', t('Sort lines ({shortcut})', { shortcut: 'F9' }), ed.sortLines],
        ['text.sortLinesNatural', t('Sort lines (natural, ignore case)'), ed.sortLinesNatural],
        ['text.reverseLines', t('Reverse lines'), ed.reverseLines],
        ['text.uniqueLines', t('Remove duplicate lines'), ed.uniqueLines],
        ['text.trimTrailing', t('Trim trailing whitespace'), ed.trimTrailing],
        ['text.upper', t('Convert to UPPERCASE ({shortcut})', { shortcut: `${formatShortcut('Mod+K')} ${formatShortcut('Mod+U')}` }), ed.transformCase('upper')],
        ['text.lower', t('Convert to lowercase ({shortcut})', { shortcut: `${formatShortcut('Mod+K')} ${formatShortcut('Mod+L')}` }), ed.transformCase('lower')],
        ['text.title', t('Convert to Title Case'), ed.transformCase('title')],
        ['text.swapCase', t('Swap case'), ed.transformCase('swap')],
      ] as [string, string, StateCommand][]
    ).map(([id, title, cmd]) => ({ id, title, category: t('Edit'), when: has, run: run((c) => (c.view.focus(), cmd(c.view))) })),
    {
      id: 'text.toggleMinimap',
      title: t('Show / hide minimap'),
      category: t('View'),
      run: () => {
        settings.update((s) => (s.minimapOff = !s.minimapOff));
        for (const c of controllers.values()) c.applyPrefs();
      },
    },
    {
      id: 'text.toggleWhitespace',
      title: t('Show / hide whitespace (spaces and tabs)'),
      category: t('View'),
      run: () => {
        settings.update((s) => (s.showWhitespace = !s.showWhitespace));
        for (const c of controllers.values()) c.applyPrefs();
      },
    },
    {
      id: 'text.lineEndings',
      title: t('Change line endings…'),
      category: t('Edit'),
      when: () => !!activeController() && !activeController()!.tab.readOnly,
      run: run(async (c) => {
        const id = await ui.pick(t('Line endings'), [
          { id: 'lf', label: 'LF', detail: 'Linux, macOS' }, // i18n-ignore
          { id: 'crlf', label: 'CRLF', detail: 'Windows' }, // i18n-ignore
        ]);
        if (id) c.setEol(id as 'lf' | 'crlf');
      }),
    },
    {
      id: 'text.saveEncoding',
      title: t('Change encoding for saving…'),
      category: t('File'),
      when: () => !!activeController() && !activeController()!.tab.readOnly,
      run: run(async (c) => {
        const id = await ui.pick(
          t('Save with encoding'),
          WRITABLE.map((e) => ({ id: e, label: encodingLabel(e), detail: e === c.encoding ? t('current') : '' })),
        );
        if (id) c.setEncoding(id as Encoding);
      }),
    },
    {
      id: 'text.reopenEncoding',
      title: t('Reopen with encoding…'),
      category: t('File'),
      when: () => !!activeController()?.tab.path,
      run: run(async (c) => {
        const id = await ui.pick(
          t('Reopen with encoding'),
          Object.keys(ENCODING_LABELS).filter((e) => e !== 'utf-8-bom').map((e) => ({ id: e, label: encodingLabel(e), detail: e === c.encoding ? t('current') : '' })),
        );
        if (id) await c.reopenWith(id as Encoding);
      }),
    },
  );
}

/** Symbol kinds (editing.ts) for display. */
const symbolKind = (): Record<string, string> => ({
  heading: t('heading', {}, 'symbol'),
  class: t('class', {}, 'symbol'),
  type: t('type', {}, 'symbol'),
  enum: t('enum', {}, 'symbol'),
  method: t('method', {}, 'symbol'),
  function: t('function', {}, 'symbol'),
  variable: t('variable', {}, 'symbol'),
  symbol: t('symbol', {}, 'symbol'),
});

/** Pick a function/class/heading of the current file and jump there (Sublime: Ctrl+R). */
async function gotoSymbol(view: EditorView) {
  const syms = ed.symbols(view.state);
  if (!syms.length) {
    ui.toast(t('No symbols found in this file.'), 'info');
    return;
  }
  const id = await ui.pick(
    t('Go to symbol'),
    syms.map((s, i) => ({ id: String(i), label: `${'  '.repeat(s.depth)}${s.name}`, detail: `${symbolKind()[s.kind] ?? s.kind} · ${t('line {n}', { n: s.line })}` })),
  );
  if (id === null) return;
  const s = syms[+id];
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(s.from), effects: EditorView.scrollIntoView(s.from, { y: 'center' }) });
}
