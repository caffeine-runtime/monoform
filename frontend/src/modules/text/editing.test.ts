import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { addCursorVertical, expandToLine, insertLineAbove, joinLines, reverseLines, sortLines, sortLinesNatural, splitIntoLines, symbols, transformCase, trimTrailing, uniqueLines } from './editing';

function run(doc: string, sel: EditorSelection | { anchor: number; head?: number }, cmd: StateCommand) {
  let state = EditorState.create({ doc, selection: sel, extensions: [EditorState.allowMultipleSelections.of(true)] });
  const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
  return { ok, state, text: state.doc.toString(), ranges: state.selection.ranges.map((r) => [r.from, r.to]) };
}

describe('Sublime-style editing', () => {
  it('adds cursors above and below at the same column', () => {
    const r = run('abcd\nab\nabcdef', { anchor: 3 }, addCursorVertical(1));
    expect(r.ranges).toEqual([
      [3, 3],
      [7, 7], // line 2 is shorter: end of line
    ]);
    const up = run('abcd\nabcd', { anchor: 7 }, addCursorVertical(-1));
    expect(up.ranges).toEqual([
      [2, 2],
      [7, 7],
    ]);
    expect(run('one', { anchor: 1 }, addCursorVertical(-1)).ok).toBe(false);
  });

  it('splits a selection into lines', () => {
    const r = run('aa\nbbb\ncc', { anchor: 1, head: 8 }, splitIntoLines);
    expect(r.ranges).toEqual([
      [1, 2],
      [3, 6],
      [7, 8],
    ]);
  });

  it('selects the line, then the next one', () => {
    let r = run('one\ntwo\nthree', { anchor: 1 }, expandToLine);
    expect(r.ranges).toEqual([[0, 4]]);
    let state = r.state;
    expandToLine({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.selection.main.to).toBe(8);
  });

  it('joins lines and inserts a line above', () => {
    expect(run('a  \n    b\nc', { anchor: 0 }, joinLines).text).toBe('a b\nc');
    expect(run('a\nb\nc', { anchor: 0, head: 4 }, joinLines).text).toBe('a b c');
    const above = run('x\n  y', { anchor: 5 }, insertLineAbove);
    expect(above.text).toBe('x\n  \n  y');
    expect(above.ranges).toEqual([[4, 4]]);
  });

  it('sorts, reverses, dedupes and trims lines', () => {
    expect(run('b\na\nc', { anchor: 0 }, sortLines).text).toBe('a\nb\nc');
    expect(run('item10\nitem2\nItem1', { anchor: 0 }, sortLinesNatural).text).toBe('Item1\nitem2\nitem10');
    expect(run('1\n2\n3\n4', { anchor: 2, head: 5 }, reverseLines).text).toBe('1\n3\n2\n4');
    expect(run('a\nb\na\nb', { anchor: 0 }, uniqueLines).text).toBe('a\nb');
    expect(run('a  \nb\t', { anchor: 0 }, trimTrailing).text).toBe('a\nb');
  });

  it('changes case of selections or the word at the cursor', () => {
    expect(run('hello world', { anchor: 2 }, transformCase('upper')).text).toBe('HELLO world');
    expect(run('hello wide world', { anchor: 0, head: 10 }, transformCase('title')).text).toBe('Hello Wide world');
    expect(run('AbC', { anchor: 0, head: 3 }, transformCase('swap')).text).toBe('aBc');
  });

  it('lists symbols from the syntax tree', () => {
    const js = EditorState.create({ doc: 'function foo() {}\nclass Bar {\n  baz() { const local = 1; }\n}\nconst top = 2;\n', extensions: [javascript()] });
    const s = symbols(js);
    expect(s.map((x) => `${x.kind}:${x.name}:${x.line}`)).toEqual(['function:foo:1', 'class:Bar:2', 'method:baz:3', 'variable:top:5']);
    const md = EditorState.create({ doc: '# Title\n\ntext\n\n## Part two\n', extensions: [markdown()] });
    expect(symbols(md).map((x) => `${x.kind}:${x.name}`)).toEqual(['heading:Title', 'heading:Part two']);
  });
});
