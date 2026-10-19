// Commands for text-based modules (text, markdown, raw views).
import { commands } from '../../core/commands';
import { settings } from '../../core/settings.svelte';
import { ui } from '../../core/ui.svelte';
import { activeController } from './controllers';
import { ENCODING_LABELS, labelOf, WRITABLE, type Encoding } from './encoding';

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
