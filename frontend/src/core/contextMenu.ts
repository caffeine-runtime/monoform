// The right-click menu of every editor. The webview's own menu is off in the
// app, so this one is built here: text editing (undo … select all) wherever
// text can be typed, Copy for selected text elsewhere, then what the open
// editor can do — its own items (tab.handlers.contextMenu: a table cell, a
// link, a shape…) and a short list of its commands, those available now.
// Views with a menu of their own (file tree, tabs, grids) prevent the event
// first and are left alone.
import { commands } from './commands';
import { formatShortcut } from './keys';
import { workspace, type Tab } from './tabs.svelte';
import { tabAt } from './transfer.svelte';
import { menu, type MenuItem } from './ui.svelte';
import { t } from './i18n';
import type { EditorView } from '@codemirror/view';
import { ClipboardGetText, ClipboardSetText } from '../wailsjs/runtime/runtime';

type Entry = string | '-' | { label: string; items: Entry[] };

/** Text editor commands (CodeMirror, wherever it is used: text, Markdown, HTML, SVG source…). */
const CODE_EDIT: Entry[] = [
  'text.selectAllMatches',
  'text.selectLine',
  'text.duplicateLine',
  'text.joinLines',
  { label: t('Change case'), items: ['text.upper', 'text.lower', 'text.title', 'text.swapCase'] },
  { label: t('Lines'), items: ['text.sortLines', 'text.sortLinesNatural', 'text.reverseLines', 'text.uniqueLines', 'text.trimTrailing'] },
];
const CODE_FIND: Entry[] = [
  'edit.find',
  'text.replace',
  'text.gotoLine',
  'text.gotoSymbol',
];

const SOURCE_VIEW = (m: string): Entry => ({ label: t('View'), items: [`${m}.source`, `${m}.split`, `${m}.preview`] });

/** Per editor (module id): its commands in the menu, in this order. */
const MODULES: Record<string, Entry[]> = {
  text: ['text.toggleWrap'],
  markdown: [SOURCE_VIEW('markdown')],
  html: [SOURCE_VIEW('html'), 'html.reload'],
  diagram: [SOURCE_VIEW('diagram')],
  svg: ['svg.undo', 'svg.redo', '-', 'svg.duplicate', 'svg.delete', 'svg.deselect', '-', 'svg.design', SOURCE_VIEW('svg'), 'svg.exportPng'],
  log: ['log.nextError', 'log.prevError', 'log.follow'],
  image: [
    'image.undo',
    'image.redo',
    '-',
    'image.cut',
    'image.copy',
    'image.copyMerged',
    'image.paste',
    'image.delete',
    'image.apply',
    '-',
    'image.selectAll',
    'image.deselect',
    'image.invertSelection',
    { label: t('Modify selection'), items: ['image.selFeather', 'image.selExpand', 'image.selContract', 'image.selSmooth', 'image.selBorder'] },
    'image.transformSelection',
    'image.selectSubject',
    '-',
    { label: t('Layer'), items: ['image.layerRotateCW', 'image.layerRotateCCW', 'image.layerRotateAngle', '-', 'image.layerFromSelection', 'image.newLayer', 'image.mergeDown', 'image.flatten', '-', 'image.maskAdd', 'image.maskInvert', 'image.maskApply', 'image.maskDelete'] },
    { label: t('Transform'), items: ['image.rotateCW', 'image.rotateCCW', 'image.rotateAngle', 'image.flipH', 'image.flipV', 'image.resize', 'image.canvasSize'] },
    { label: t('Remove'), items: ['image.removeBackground', 'image.removeObject', 'image.removeWatermark'] },
    'image.adjust',
    '-',
    'image.fit',
    'image.actual',
    { label: t('View'), items: ['image.viewRotateCCW', 'image.viewRotateCW', 'image.viewRotateReset'] },
  ],
  pdf: ['pdf.zoomIn', 'pdf.zoomOut', 'pdf.fitWidth', 'pdf.fitPage', '-', 'edit.find', 'pdf.goto', '-', 'pdf.rotateCW', 'pdf.rotateCCW', 'pdf.delete', 'pdf.extract', '-', 'pdf.thumbs'],
  doc: [{ label: t('Style'), items: ['doc.normal', 'doc.heading1', 'doc.heading2', 'doc.heading3'] }, 'edit.find'],
  sheet: ['sheet.insertRow', 'sheet.deleteRow'],
  data: ['data.copyPath', 'data.expandAll', 'data.collapseAll', '-', 'data.pretty', 'data.minify', '-', 'data.tree', 'data.raw', 'data.json'],
  csv: ['csv.addRow', 'csv.deleteRow', 'csv.filter'],
  database: ['db.undo', 'db.redo', '-', 'db.addRow', 'db.deleteRows', 'db.setNull', '-', 'db.run'],
  audio: [
    'audio.undo',
    'audio.redo',
    '-',
    'audio.cut',
    'audio.copy',
    'audio.paste',
    'audio.delete',
    'audio.selectAll',
    '-',
    'audio.trim',
    'audio.silence',
    'audio.fadeIn',
    'audio.fadeOut',
    'audio.gain',
    'audio.normalize',
    '-',
    'audio.playPause',
    'audio.loop',
    'audio.zoomFit',
  ],
  video: [
    'video.playPause',
    '-',
    'video.setIn',
    'video.setOut',
    'video.cut',
    'video.keep',
    'video.selectAll',
    'video.clearSel',
    'video.restoreAll',
    '-',
    'video.undo',
    'video.redo',
    '-',
    'video.rotate',
    'video.snapshot',
    'video.mute',
    'video.loop',
    'video.fullscreen',
  ],
  model3d: ['model.reset', '-', 'model.wireframe', 'model.lighting', 'model.grid', 'model.playPause'],
  cad: ['cad.undo', 'cad.redo', '-', 'cad.selectAll', 'cad.fit', '-', 'cad.snap', 'cad.grid', 'cad.ortho', '-', 'cad.exportSvg', 'cad.exportPng'],
  compare: ['compare.next', 'compare.prev', 'compare.swap', 'compare.refresh'],
  archive: ['archive.extractAll', 'archive.extractHere'],
};

/** Copy out of / paste into the view (a picture, a frame…), for views that aren't text. */
const TRANSFER: Entry[] = ['edit.copyOut', 'edit.pasteIn'];

/** Every command list above (the unit test checks each id names a real command). */
export const CONTEXT_LISTS: Entry[][] = [CODE_EDIT, CODE_FIND, TRANSFER, ...Object.values(MODULES)];

function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.items && !it.items.length) continue;
    if (it.separator && (!out.length || out[out.length - 1].separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

/** Menu items for commands available now (the rest left out). */
export function commandItems(list: Entry[]): MenuItem[] {
  const avail = new Set(commands.available().map((c) => c.id));
  const es = (l: Entry[]): MenuItem[] =>
    l.flatMap((e): MenuItem[] => {
      if (e === '-') return [{ separator: true }];
      if (typeof e === 'string') {
        const c = commands.get(e);
        if (!c || !avail.has(e)) return [];
        const sc = commands.shortcutOf(e);
        // "Select line (Ctrl+L)": the keys go in the shortcut column.
        const inTitle = sc ? null : /^(.*\S) \(([^()]+)\)$/.exec(c.title);
        return [{ label: inTitle?.[1] ?? c.title, shortcut: sc ? formatShortcut(sc) : inTitle?.[2], run: () => commands.execute(e) }];
      }
      const items = tidy(es(e.items));
      // "Mask: invert" reads "Invert" inside Layer… only when the prefix is the submenu's name.
      return items.length ? [{ label: e.label, items }] : [];
    });
  return tidy(es(list));
}

// ---- text fields ----

type Field = { kind: 'input'; el: HTMLInputElement | HTMLTextAreaElement } | { kind: 'rich'; el: HTMLElement } | { kind: 'code'; el: HTMLElement };

const TEXT_INPUTS = /^(text|search|url|email|tel|password|number|)$/;

function fieldOf(target: Element | null): Field | null {
  if (!target) return null;
  const code = target.closest<HTMLElement>('.cm-editor');
  if (code) return { kind: 'code', el: code };
  const input = target.closest<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (input) return input instanceof HTMLTextAreaElement || TEXT_INPUTS.test(input.type) ? { kind: 'input', el: input } : null;
  const rich = target.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
  return rich?.isContentEditable ? { kind: 'rich', el: rich } : null;
}

const readOnly = (f: Field) =>
  f.kind === 'input' ? f.el.readOnly || f.el.disabled : f.kind === 'code' ? f.el.querySelector('.cm-content')?.getAttribute('contenteditable') !== 'true' : !f.el.isContentEditable;

function hasSelection(f: Field): boolean {
  if (f.kind === 'input') {
    try {
      return f.el.selectionStart !== f.el.selectionEnd;
    } catch {
      return false; // (number fields have no selection range)
    }
  }
  // (A code editor draws its selection; the page's may already be elsewhere.)
  if (f.kind === 'code' && f.el.querySelector('.cm-selectionBackground')) return true;
  const s = window.getSelection();
  return !!s && !s.isCollapsed && f.el.contains(s.anchorNode);
}

/** The system clipboard as paste data: rich text and pictures where the webview can read them, else the text (through the app). */
async function clipboardData(): Promise<DataTransfer> {
  const dt = new DataTransfer();
  try {
    const slow = new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 1000)); // i18n-ignore (caught below)
    const items = await Promise.race([navigator.clipboard.read(), slow]);
    for (const it of items) {
      for (const type of it.types) {
        if (type === 'text/plain' || type === 'text/html') dt.setData(type, await (await it.getType(type)).text());
        else if (type.startsWith('image/')) dt.items.add(new File([await it.getType(type)], `pasted.${type.slice(6)}`, { type }));
      }
    }
  } catch {
    /* not readable here: the text below */
  }
  if (!dt.getData('text/plain') && !dt.files.length) {
    try {
      dt.setData('text/plain', await ClipboardGetText());
    } catch {
      /* no clipboard */
    }
  }
  return dt;
}

/** Text through the app (the webview's own clipboard writes don't always reach the system); rich text where it can. */
async function writeClipboard(text: string, html = '') {
  if (html) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      return;
    } catch {
      /* as plain text */
    }
  }
  await ClipboardSetText(text).catch(() => {});
}

/** Undo … Select all for a text field (input, rich text or code editor). */
function textItems(f: Field, cm?: EditorView | null): MenuItem[] {
  const ro = cm ? cm.state.readOnly : readOnly(f);
  const sel = cm ? cm.state.selection.ranges.some((r) => !r.empty) : hasSelection(f);
  // The menu takes the focus: put it (and the selection) back before acting.
  const savedRange = f.kind === 'rich' ? window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null : null;
  const refocus = () => {
    f.el.focus();
    if (savedRange) {
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(savedRange);
    }
  };
  const exec = (cmd: string) => () => {
    refocus();
    document.execCommand(cmd);
  };
  const inner = () => (f.kind === 'code' ? (f.el.querySelector<HTMLElement>('.cm-content') ?? f.el) : f.el);
  // Code editors keep their own selection and history: worked through their API
  // (loaded already — the editor is on the page).
  // (The selection as it was at the right-click: the menu took the focus since.)
  const saved = cm?.state.selection;
  const view = async () => {
    if (!cm) return null;
    cm.focus();
    if (saved && !cm.state.selection.eq(saved)) cm.dispatch({ selection: saved });
    return cm;
  };
  const codeCmd = (name: 'undo' | 'redo' | 'selectAll') => async () => {
    const v = await view();
    if (v) (await import('@codemirror/commands'))[name](v);
  };
  const codeSelection = async (remove: boolean) => {
    const v = await view();
    if (!v) return '';
    const st = v.state;
    const ranges = st.selection.ranges.filter((r) => !r.empty);
    if (remove && ranges.length && !st.readOnly) v.dispatch({ changes: ranges.map((r) => ({ from: r.from, to: r.to })), userEvent: 'delete.cut', scrollIntoView: true });
    return ranges.map((r) => st.sliceDoc(r.from, r.to)).join(st.lineBreak);
  };
  // Copy and cut: the selected text (and its HTML in rich text).
  const copy = (cut: boolean) => async () => {
    if (f.kind === 'code') {
      const text = await codeSelection(false);
      if (!text) return;
      await writeClipboard(text);
      if (cut) await codeSelection(true);
      return;
    }
    refocus();
    let text = '';
    let html = '';
    if (f.kind === 'input') text = f.el.value.slice(f.el.selectionStart ?? 0, f.el.selectionEnd ?? 0);
    else {
      const s = window.getSelection()!;
      text = s.toString();
      if (s.rangeCount) {
        const box = document.createElement('div');
        box.append(s.getRangeAt(0).cloneContents());
        html = box.innerHTML;
      }
    }
    if (!text) return;
    await writeClipboard(text, html);
    if (cut) {
      refocus();
      document.execCommand('delete');
    }
  };
  const paste = (plain: boolean) => async () => {
    const dt = await clipboardData();
    const text = dt.getData('text/plain');
    if (f.kind === 'code') {
      const v = await view();
      if (!v) return;
      // A picture goes to the editor's own paste (Markdown saves it next to the file).
      if (dt.files.length) {
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        inner().dispatchEvent(ev);
        if (ev.defaultPrevented) return;
      }
      if (text && !v.state.readOnly) v.dispatch({ ...v.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true });
      return;
    }
    refocus();
    if (plain) {
      if (text) document.execCommand('insertText', false, text);
      return;
    }
    // Editors with their own paste (rich text, pictures) take it from the event; plain fields get the text.
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    inner().dispatchEvent(ev);
    if (!ev.defaultPrevented && text) document.execCommand('insertText', false, text);
  };
  const selectAll = () => {
    if (f.kind === 'code') return void codeCmd('selectAll')();
    if (f.kind === 'input') {
      f.el.focus();
      f.el.select();
      return;
    }
    f.el.focus();
    const r = document.createRange();
    r.selectNodeContents(f.el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };
  const sc = (s: string) => formatShortcut(s);
  const items: MenuItem[] = [];
  if (!ro) {
    items.push(
      { label: t('Undo'), shortcut: sc('Mod+Z'), run: f.kind === 'code' ? codeCmd('undo') : exec('undo') },
      { label: t('Redo'), shortcut: sc('Mod+Shift+Z'), run: f.kind === 'code' ? codeCmd('redo') : exec('redo') },
      { separator: true },
      { label: t('Cut'), shortcut: sc('Mod+X'), disabled: !sel, run: copy(true) },
    );
  }
  items.push({ label: t('Copy'), shortcut: sc('Mod+C'), disabled: !sel, run: copy(false) });
  if (!ro) {
    items.push({ label: t('Paste'), shortcut: sc('Mod+V'), run: paste(false) });
    if (f.kind === 'rich') items.push({ label: t('Paste as plain text'), shortcut: sc('Mod+Shift+V'), run: paste(true) });
    items.push({ label: t('Delete'), disabled: !sel, run: f.kind === 'code' ? () => void codeSelection(true) : exec('delete') });
  }
  items.push({ separator: true }, { label: t('Select all'), shortcut: sc('Mod+A'), run: selectAll });
  return items;
}

/** The menu for a right-click at e (empty: nothing to offer there). */
export function contextItems(e: MouseEvent, tab: Tab | null | undefined, cm?: EditorView | null): MenuItem[] {
  const target = e.target instanceof Element ? e.target : null;
  const field = fieldOf(target);
  // The view's own items first: it may move the caret to where the click was.
  let own: MenuItem[] = [];
  try {
    own = tab?.handlers.contextMenu?.(e) ?? [];
  } catch (err) {
    console.error(err); // the rest of the menu still shows
  }
  const groups: MenuItem[][] = [];
  if (field) groups.push(textItems(field, cm));
  else {
    const s = window.getSelection();
    const text = s && !s.isCollapsed ? s.toString() : '';
    if (text.trim() && target && s!.containsNode(target, true)) groups.push([{ label: t('Copy'), shortcut: formatShortcut('Mod+C'), run: () => void writeClipboard(text) }]);
  }
  if (tab) {
    groups.push(own);
    if (field?.kind === 'code') groups.push(commandItems([...(readOnly(field) ? [] : CODE_EDIT), '-', ...CODE_FIND]));
    const mine = MODULES[tab.moduleId];
    if (mine) groups.push(commandItems(mine));
    if (!field) groups.push(commandItems(TRANSFER));
  }
  return tidy(groups.filter((g) => g.length).flatMap((g, i) => (i ? [{ separator: true }, ...g] : g)));
}

/**
 * Show the menu for right-clicks no view handled itself (installed once, at
 * start). On the document: after the views' own handlers, before the Wails
 * runtime's on the window (which swallows right-clicks outside text fields).
 */
export function installContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    try {
      open(e);
    } catch (err) {
      console.error(err);
    }
  });
  const open = (e: MouseEvent) => {
    // Inside a dialog or a menu: text editing only.
    const inTab = e.target instanceof Element && !e.target.closest('.dialog, .menu, [role="dialog"]');
    let tab = inTab ? tabAt(e.clientX, e.clientY) : null;
    if (inTab && !tab && e.clientX === 0 && e.clientY === 0) tab = workspace.active; // the menu key
    // A right-click in another pane works on that pane's tab.
    if (tab && tab !== workspace.active && workspace.isShown(tab.id)) workspace.activate(tab);
    let x = e.clientX;
    let y = e.clientY;
    if (!x && !y && document.activeElement instanceof HTMLElement) {
      const r = document.activeElement.getBoundingClientRect();
      x = r.left + 12;
      y = r.top + Math.min(r.height, 24);
    }
    // A code editor is worked through its API (already loaded: it is on the page).
    const code = e.target instanceof Element ? e.target.closest<HTMLElement>('.cm-editor') : null;
    const show = (cm?: EditorView | null) => {
      const items = contextItems(e, tab, cm);
      if (items.length) menu.show({ clientX: x, clientY: y }, items);
    };
    if (code) void import('@codemirror/view').then((m) => show(m.EditorView.findFromDOM(code)));
    else show();
  };
}
