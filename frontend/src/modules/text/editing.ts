// Sublime-style editing commands for CodeMirror: cursors above/below, split
// selection into lines, expand to line, join lines, duplicate, line sorting
// and case changes, symbols for "Go to symbol". State commands only (no DOM),
// so they're unit-tested on bare EditorStates.
import { EditorSelection, type EditorState, type SelectionRange, type StateCommand, type Text, type Transaction, type TransactionSpec } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

const change = (state: EditorState, dispatch: (tr: Transaction) => void, spec: TransactionSpec) => {
  dispatch(state.update({ ...spec, scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/** Add a cursor on the line above (-1) or below (+1) each cursor, keeping the column. */
export const addCursorVertical =
  (dir: -1 | 1): StateCommand =>
  ({ state, dispatch }) => {
    const ranges = [...state.selection.ranges];
    for (const r of state.selection.ranges) {
      const line = state.doc.lineAt(r.head);
      const n = line.number + dir;
      if (n < 1 || n > state.doc.lines) continue;
      const target = state.doc.line(n);
      const col = r.goalColumn ?? r.head - line.from;
      ranges.push(EditorSelection.cursor(Math.min(target.from + col, target.to), undefined, undefined, col));
    }
    if (ranges.length === state.selection.ranges.length) return false;
    dispatch(state.update({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true, userEvent: 'select' }));
    return true;
  };

/** Split each multi-line selection into one selection per line (Sublime: Ctrl+Shift+L). */
export const splitIntoLines: StateCommand = ({ state, dispatch }) => {
  const out: SelectionRange[] = [];
  let changed = false;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from);
    const b = state.doc.lineAt(r.to);
    if (a.number === b.number) {
      out.push(r);
      continue;
    }
    changed = true;
    for (let n = a.number; n <= b.number; n++) {
      const l = state.doc.line(n);
      const from = Math.max(r.from, l.from);
      const to = Math.min(r.to, l.to);
      if (n === b.number && to === l.from && n !== a.number) continue; // selection ended at a line start
      out.push(EditorSelection.range(from, to));
    }
  }
  if (!changed) return false;
  dispatch(state.update({ selection: EditorSelection.create(out, out.length - 1), userEvent: 'select' }));
  return true;
};

/** Select whole lines; again extends by one more line (Sublime: Ctrl+L). */
export const expandToLine: StateCommand = ({ state, dispatch }) => {
  const last = state.doc.lines;
  const ranges = state.selection.ranges.map((r) => {
    const a = state.doc.lineAt(r.from);
    // A selection ending at a line start ends on the line before.
    let b = !r.empty && r.to === state.doc.lineAt(r.to).from ? state.doc.lineAt(r.to - 1) : state.doc.lineAt(r.to);
    const whole = !r.empty && r.from === a.from && (r.to === b.to + 1 || (r.to === b.to && b.number === last));
    if (whole && b.number < last) b = state.doc.line(b.number + 1);
    return EditorSelection.range(a.from, b.number < last ? b.to + 1 : b.to);
  });
  dispatch(state.update({ selection: EditorSelection.create(ranges, state.selection.mainIndex), scrollIntoView: true, userEvent: 'select' }));
  return true;
};

/** Join each selected line (or the cursor's line) with the next, collapsing the indentation to one space. */
export const joinLines: StateCommand = ({ state, dispatch }) => {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = Math.max(a + 1, state.doc.lineAt(r.to).number);
    for (let n = a; n < b && n < state.doc.lines; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const lead = /^\s*/.exec(next.text)![0].length;
      const trail = line.text.length - line.text.trimEnd().length;
      changes.push({ from: line.to - trail, to: next.from + lead, insert: next.text.trim() && line.text.trim() ? ' ' : '' });
    }
  }
  if (!changes.length) return false;
  return change(state, dispatch, { changes });
};

/** Insert an empty line above the cursor's line and move there (Sublime: Ctrl+Shift+Enter). */
export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((r) => {
    const line = state.doc.lineAt(r.head);
    const indent = /^\s*/.exec(line.text)![0];
    return { changes: { from: line.from, insert: indent + state.lineBreak }, range: EditorSelection.cursor(line.from + indent.length) };
  });
  return change(state, dispatch, tr);
};

/** The lines covered by the selection, or the whole document when nothing is selected. */
function selectedLines(state: EditorState): { from: number; to: number; lines: string[] } {
  const sel = state.selection.main;
  if (sel.empty && state.selection.ranges.length === 1) return { from: 0, to: state.doc.length, lines: state.doc.toString().split(state.lineBreak) };
  const a = state.doc.lineAt(Math.min(...state.selection.ranges.map((r) => r.from)));
  let b = state.doc.lineAt(Math.max(...state.selection.ranges.map((r) => r.to)));
  if (b.from === Math.max(...state.selection.ranges.map((r) => r.to)) && b.number > a.number) b = state.doc.line(b.number - 1);
  return { from: a.from, to: b.to, lines: state.sliceDoc(a.from, b.to).split(state.lineBreak) };
}

const lineOp =
  (f: (lines: string[]) => string[]): StateCommand =>
  ({ state, dispatch }) => {
    const { from, to, lines } = selectedLines(state);
    const next = f(lines).join(state.lineBreak);
    if (next === state.sliceDoc(from, to)) return false;
    return change(state, dispatch, { changes: { from, to, insert: next }, selection: EditorSelection.range(from, from + next.length) });
  };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const sortLines = lineOp((l) => [...l].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
export const sortLinesNatural = lineOp((l) => [...l].sort(collator.compare));
export const reverseLines = lineOp((l) => [...l].reverse());
export const uniqueLines = lineOp((l) => l.filter((x, i) => l.indexOf(x) === i));
export const trimTrailing = lineOp((l) => l.map((x) => x.replace(/[ \t]+$/, '')));

/** Change the case of each selection (the word at an empty cursor). */
export const transformCase =
  (kind: 'upper' | 'lower' | 'title' | 'swap'): StateCommand =>
  ({ state, dispatch }) => {
    const f = (s: string) =>
      kind === 'upper'
        ? s.toUpperCase()
        : kind === 'lower'
          ? s.toLowerCase()
          : kind === 'title'
            ? s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
            : [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
    const tr = state.changeByRange((r) => {
      const range = r.empty ? (state.wordAt(r.head) ?? r) : r;
      const text = state.sliceDoc(range.from, range.to);
      return { changes: { from: range.from, to: range.to, insert: f(text) }, range: EditorSelection.range(range.from, range.to) };
    });
    return change(state, dispatch, tr);
  };

// ---------- symbols ----------

export interface Symbol {
  name: string;
  kind: string;
  from: number;
  line: number;
  depth: number;
}

const DECL = /^(Function|Method|Class|Interface|Enum|Struct|Trait|Impl|Module|Type|TypeAlias|Namespace|Object|Property|Variable)(Declaration|Definition|Item|Statement|Spec)$|^(FunctionDefinition|ClassDefinition|DecoratedDefinition|FunctionItem|StructItem|EnumItem|TraitItem|ImplItem|ModItem|FuncDecl|TypeSpec|MethodDecl|ATXHeading[1-6]|SetextHeading[12])$/;
const NAMEISH = new Set(['VariableDefinition', 'PropertyDefinition', 'TypeDefinition', 'Definition', 'Identifier', 'Name', 'VariableName', 'PropertyName', 'TypeIdentifier', 'FieldIdentifier', 'BoundIdentifier', 'DefName']);
const KIND = (type: string) =>
  /Heading/.test(type)
    ? 'heading'
    : /Class|Struct|Object/.test(type)
      ? 'class'
      : /Interface|Trait|Type/.test(type)
        ? 'type'
        : /Enum/.test(type)
          ? 'enum'
          : /Method/.test(type)
            ? 'method'
            : /Function|Func/.test(type)
              ? 'function'
              : /Variable|Property/.test(type)
                ? 'variable'
                : 'symbol';

/** Declarations (and Markdown headings) from the syntax tree, in document order. */
export function symbols(state: EditorState, timeout = 300): Symbol[] {
  const tree = ensureSyntaxTree(state, state.doc.length, timeout) ?? syntaxTree(state);
  const out: Symbol[] = [];
  const depthOf: number[] = [];
  tree.iterate({
    enter: (node) => {
      const type = node.type.name;
      if (!DECL.test(type)) return;
      // Only top-level variables (not every local) count as symbols.
      if (/^Variable/.test(type) && out.some((s) => s.kind !== 'heading' && s.from < node.from && node.to <= (s as Symbol & { to?: number }).to!)) return;
      let name = '';
      if (/Heading/.test(type)) name = state.sliceDoc(node.from, node.to).replace(/^#+\s*|\s*#*\s*$/g, '').split('\n')[0];
      else {
        const c = node.node.cursor();
        if (c.firstChild()) {
          do {
            if (NAMEISH.has(c.type.name)) {
              name = state.sliceDoc(c.from, c.to);
              break;
            }
          } while (c.nextSibling());
        }
      }
      if (!name || name.length > 120) return;
      while (depthOf.length && depthOf[depthOf.length - 1] <= node.from) depthOf.pop();
      out.push({ name, kind: KIND(type), from: node.from, line: state.doc.lineAt(node.from).number, depth: depthOf.length, to: node.to } as Symbol);
      depthOf.push(node.to);
    },
  });
  return out;
}

export function lineText(doc: Text, n: number): string {
  return n >= 1 && n <= doc.lines ? doc.line(n).text : '';
}
