// CodeMirror configuration shared by the text and markdown modules.
import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  highlightWhitespace,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, copyLineDown, cursorMatchingBracket } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { addCursorVertical, expandToLine, insertLineAbove, joinLines, sortLines, splitIntoLines } from './editing';
import { indentGuides, minimap } from './minimap';
import { editorPhrases } from './phrases';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, LanguageDescription } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches, selectSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

/** Files above this size get a lighter editor (no highlighting/folding). */
export const LARGE_FILE = 8 << 20;

export const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.definition(t.variableName), t.constant(t.variableName)], color: 'var(--syn-def)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-punct)' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '600' },
  { tag: t.heading1, color: 'var(--syn-heading)', fontWeight: '700', fontSize: '1.25em' },
  { tag: t.heading2, color: 'var(--syn-heading)', fontWeight: '700', fontSize: '1.12em' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--syn-link)', textDecoration: 'underline' },
  { tag: [t.monospace], color: 'var(--syn-string)' },
  { tag: [t.quote], color: 'var(--syn-comment)' },
  { tag: t.meta, color: 'var(--syn-comment)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: 'var(--editor-font-size, 14px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 20px 0 6px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--text-faint)', border: 'none', paddingLeft: '8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-hover) 45%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--bg-active)', outline: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-hover)', border: 'none', color: 'var(--text-muted)', borderRadius: '4px', padding: '0 6px' },
  '.cm-foldGutter span': { color: 'var(--text-faint)' },
  '.cm-panels': { backgroundColor: 'var(--bg-sidebar)', color: 'var(--text)', borderColor: 'var(--border-soft) !important' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border-soft)' },
  '.cm-search': { padding: '8px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-ui)', fontSize: '12.5px' },
  '.cm-search br': { flexBasis: '100%', height: 0 },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' },
  '.cm-textfield': {
    height: '28px',
    padding: '0 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--bg-input)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    outline: 'none',
    minWidth: '220px',
  },
  '.cm-textfield:focus': { borderColor: 'var(--accent)' },
  '.cm-button': {
    height: '28px',
    padding: '0 10px',
    border: 'none',
    borderRadius: 'var(--radius)',
    backgroundImage: 'none',
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
    cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--bg-active)' },
  '.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', padding: '0 6px', cursor: 'pointer' },
  '.cm-specialChar': { color: 'var(--text-faint)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)' },
});

export interface Compartments {
  language: Compartment;
  wrap: Compartment;
  readOnly: Compartment;
  lineSep: Compartment;
  heavy: Compartment;
  minimap: Compartment;
  whitespace: Compartment;
}

export function makeCompartments(): Compartments {
  return { language: new Compartment(), wrap: new Compartment(), readOnly: new Compartment(), lineSep: new Compartment(), heavy: new Compartment(), minimap: new Compartment(), whitespace: new Compartment() };
}

/** Sublime Text key bindings on top of CodeMirror's defaults (which already have Ctrl+D, Alt+↑/↓, Ctrl+/ …). */
export const sublimeKeymap = Prec.high(
  keymap.of([
    { key: 'Mod-Shift-l', run: splitIntoLines },
    { key: 'Alt-F3', run: selectSelectionMatches },
    { key: 'Mod-l', run: expandToLine },
    { key: 'Mod-Shift-d', run: copyLineDown },
    { key: 'Mod-j', run: joinLines },
    { key: 'Mod-Shift-Enter', run: insertLineAbove },
    { key: 'Mod-m', run: cursorMatchingBracket },
    { key: 'Mod-Alt-ArrowUp', run: addCursorVertical(-1) },
    { key: 'Mod-Alt-ArrowDown', run: addCursorVertical(1) },
    { key: 'F9', run: sortLines },
  ]),
);

/** Minimap and whitespace markers, from the settings (both off for huge files). */
export function minimapExt(on: boolean, large: boolean): Extension {
  return on && !large ? minimap() : [];
}
export function whitespaceExt(on: boolean): Extension {
  return on ? highlightWhitespace() : [];
}

/** Words in the document, except inside a [[note link]] (Markdown completes note names there). */
function wordsOutsideNoteLinks(ctx: CompletionContext) {
  return ctx.matchBefore(/\[\[[^\]\n]*$/) ? null : completeAnyWord(ctx);
}

/** Features that are too costly for huge files. */
export function heavyFeatures(large: boolean): Extension {
  if (large) return [];
  return [
    foldGutter({ openText: '⌄', closedText: '›' }),
    bracketMatching(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlight),
    keymap.of([...foldKeymap, ...closeBracketsKeymap, ...completionKeymap]),
    closeBrackets(),
    indentGuides(),
    // Completions from the language where it has them, plus words in the document (as in Sublime).
    autocompletion({ activateOnTyping: true, maxRenderedOptions: 40 }),
    EditorState.languageData.of(() => [{ autocomplete: wordsOutsideNoteLinks }]),
  ];
}

/**
 * Read-only for commands (EditorState.readOnly) and for typing: the content
 * isn't editable then (text can still be selected, copied and searched).
 */
export function readOnlyExt(on: boolean): Extension {
  return [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
}

export function baseExtensions(c: Compartments, opts: { large: boolean; wrap: boolean; readOnly: boolean; lineSep?: string; minimap?: boolean; whitespace?: boolean }): Extension[] {
  return [
    sublimeKeymap,
    editorPhrases(),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
    editorTheme,
    c.heavy.of(heavyFeatures(opts.large)),
    c.language.of([]),
    c.wrap.of(opts.wrap ? EditorView.lineWrapping : []),
    c.readOnly.of(readOnlyExt(opts.readOnly)),
    c.lineSep.of(opts.lineSep ? EditorState.lineSeparator.of(opts.lineSep) : []),
    c.minimap.of(minimapExt(!!opts.minimap, opts.large)),
    c.whitespace.of(whitespaceExt(!!opts.whitespace)),
  ];
}

let languagesPromise: Promise<readonly LanguageDescription[]> | null = null;

/** Language pack for a file name, loaded lazily (each pack is its own chunk). */
export async function languageFor(name: string): Promise<Extension | null> {
  languagesPromise ??= import('@codemirror/language-data').then((m) => m.languages);
  const langs = await languagesPromise;
  const base = name.split(/[\\/]/).pop() ?? name;
  const desc =
    LanguageDescription.matchFilename(langs, base) ??
    (/\.(jsonc|webmanifest|geojson)$/i.test(base)
      ? LanguageDescription.matchLanguageName(langs, 'json')
      : /^\.env(\..+)?$|\.env$|\.(cfg|conf|editorconfig|npmrc|gitconfig)$|^\.(editorconfig|npmrc|gitconfig)$/i.test(base)
        ? LanguageDescription.matchLanguageName(langs, 'properties')
        : null);
  if (!desc) return null;
  const support = await desc.load();
  return support;
}
