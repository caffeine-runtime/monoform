// M18: code editor (Sublime-style): minimap, go to symbol, multi-cursor
// commands, line commands, word completion, indent guides.
import { startCompletion } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { controllers } from '../modules/text/controllers';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

export default async function m18(dir: string) {
  const tab = (await workspace.openPath(join(dir, 'code', 'sample.ts')))!;
  const c = await waitFor(() => (controllers.get(tab.id)?.view.state.doc.lines ?? 0) > 200 ? controllers.get(tab.id)! : null, 'editor loaded', 8000);
  const view = c.view;
  const root = view.dom;

  // ---- minimap: drawn, and clicking it scrolls ----
  const mm = await waitFor(() => root.querySelector<HTMLCanvasElement>('canvas.cm-minimap'), 'minimap');
  await sleep(200);
  const d = mm.getContext('2d')!.getImageData(0, 0, mm.width, Math.min(mm.height, 60)).data;
  let ink = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
  assert(ink > 200, `minimap shows the code (${ink} px)`);
  const r = mm.getBoundingClientRect();
  mm.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 20, clientY: r.bottom - 5, pointerId: 9, bubbles: true }));
  mm.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 20, clientY: r.bottom - 5, pointerId: 9, bubbles: true }));
  await waitFor(() => (view.scrollDOM.scrollTop > 200 ? true : null), 'minimap click scrolls down', 3000);
  commands.execute('text.toggleMinimap');
  await waitFor(() => (root.querySelector('canvas.cm-minimap') ? null : true), 'minimap hidden');
  commands.execute('text.toggleMinimap');
  await waitFor(() => root.querySelector('canvas.cm-minimap'), 'minimap back');

  // ---- indent guides ----
  view.dispatch({ effects: [], selection: EditorSelection.cursor(0), scrollIntoView: true });
  await sleep(100);
  assert(root.querySelector('.cm-indent-guide'), 'indent guides drawn');

  // ---- go to symbol (Ctrl+R) ----
  commands.execute('text.gotoSymbol');
  const pick = await waitFor(() => ui.picker, 'symbol picker');
  const labels = pick.items.map((i) => `${i.label.trim()}|${i.detail}`);
  log(`symbols: ${labels.slice(0, 6).join(', ')}`);
  for (const want of ['parseRecord|function · line 2', 'Ledger|class · line 10', 'addRecord|method · line 12', 'totalAmount|method · line 15', 'Record|type · line 20']) assert(labels.includes(want), `symbol ${want}`);
  pick.resolve(pick.items.find((i) => i.label.trim() === 'totalAmount')!.id);
  await waitFor(() => (view.state.doc.lineAt(view.state.selection.main.head).number === 15 ? true : null), 'jumped to totalAmount');

  // ---- keys inside the editor (Sublime bindings) ----
  const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true, cancelable: true });
    // CodeMirror resolves Shift+letter through keyCode, which synthetic events lack.
    if (k.length === 1) Object.defineProperty(ev, 'keyCode', { get: () => k.toUpperCase().charCodeAt(0) });
    view.contentDOM.dispatchEvent(ev);
  };
  view.focus();
  // Ctrl+Alt+Down twice: three cursors.
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from + 2) });
  key('ArrowDown', { ctrl: true, alt: true });
  key('ArrowDown', { ctrl: true, alt: true });
  assertEq(view.state.selection.ranges.length, 3, 'Ctrl+Alt+↓ adds cursors');
  await sleep(50);
  assert(tab.status.position?.includes('3 cursors'), `status bar counts cursors (${tab.status.position})`);
  // Ctrl+Shift+L: a three-line selection becomes three.
  view.dispatch({ selection: EditorSelection.range(view.state.doc.line(20).from, view.state.doc.line(22).to) });
  key('L', { ctrl: true, shift: true });
  assertEq(view.state.selection.ranges.length, 3, 'Ctrl+Shift+L splits into lines');
  // Ctrl+L selects the line; again adds the next.
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(21).from) });
  key('l', { ctrl: true });
  key('l', { ctrl: true });
  assertEq(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), '  name: string;\n  amount: number;\n', 'Ctrl+L twice selects two lines');
  // Ctrl+Shift+D duplicates, Ctrl+Z undoes.
  const before = view.state.doc.lines;
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(21).from) });
  key('D', { ctrl: true, shift: true });
  assertEq(view.state.doc.lines, before + 1, 'Ctrl+Shift+D duplicates the line');
  key('z', { ctrl: true });
  assertEq(view.state.doc.lines, before, 'undo');
  // Palette commands: uppercase the word at the cursor.
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(21).from + 3) });
  commands.execute('text.upper');
  await sleep(20);
  assert(view.state.doc.line(21).text.includes('NAME: string'), 'Convert to UPPERCASE');
  key('z', { ctrl: true });

  // ---- word completion ----
  const end = view.state.doc.length;
  view.dispatch({ changes: { from: end, insert: '\ntota' }, selection: EditorSelection.cursor(end + 5) });
  const j = await measureJank(async () => {
    startCompletion(view);
    await waitFor(() => root.querySelector('.cm-tooltip-autocomplete'), 'completion list', 3000);
  });
  const opts = [...root.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => li.textContent);
  assert(opts.some((o) => o?.startsWith('totalAmount')), `completes words from the file (${opts.slice(0, 5).join(', ')})`);
  log(`completion longest frame ${Math.round(j.maxGap)} ms`);
  await workspace.close(tab, { force: true });
}
