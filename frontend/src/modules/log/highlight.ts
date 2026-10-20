// Log colouring for the code editor: a tinted background for error and
// warning lines, the level word in its colour, timestamps dimmed. Only the
// visible lines are decorated, so it stays cheap on huge files.
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { levelOf, levelSpan, TIMESTAMP, type Level } from './levels';

const line: Record<Level, Decoration> = {
  fatal: Decoration.line({ class: 'cm-log-fatal' }),
  error: Decoration.line({ class: 'cm-log-error' }),
  warn: Decoration.line({ class: 'cm-log-warn' }),
  info: Decoration.line({ class: 'cm-log-info' }),
  debug: Decoration.line({ class: 'cm-log-debug' }),
  trace: Decoration.line({ class: 'cm-log-trace' }),
};
const word = (l: Level) => Decoration.mark({ class: `cm-log-lv cm-log-lv-${l}` });
const WORD: Record<Level, Decoration> = { fatal: word('fatal'), error: word('error'), warn: word('warn'), info: word('info'), debug: word('debug'), trace: word('trace') };
const time = Decoration.mark({ class: 'cm-log-time' });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const l = doc.lineAt(pos);
      const text = l.length > 400 ? doc.sliceString(l.from, l.from + 400) : l.text;
      const lv = levelOf(text);
      if (lv) b.add(l.from, l.from, line[lv]);
      const t = TIMESTAMP.exec(text);
      const span = lv ? levelSpan(text) : null;
      const marks: [number, number, Decoration][] = [];
      if (t) marks.push([t.index + t[0].indexOf(t[1]), t.index + t[0].indexOf(t[1]) + t[1].length, time]);
      if (span && lv) marks.push([span[0], span[1], WORD[lv]]);
      marks.sort((x, y) => x[0] - y[0]);
      let last = 0;
      for (const [s, e, d] of marks) {
        if (s < last || e <= s) continue;
        b.add(l.from + s, l.from + e, d);
        last = e;
      }
      pos = l.to + 1;
    }
  }
  return b.finish();
}

export const logHighlight = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = build(v);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.baseTheme({
    '.cm-log-fatal': { backgroundColor: 'rgba(220, 40, 60, 0.22)' },
    '.cm-log-error': { backgroundColor: 'rgba(248, 81, 73, 0.13)' },
    '.cm-log-warn': { backgroundColor: 'rgba(210, 153, 34, 0.12)' },
    '.cm-log-debug, .cm-log-trace': { opacity: '0.72' },
    '.cm-log-lv': { fontWeight: '600' },
    '.cm-log-lv-fatal, .cm-log-lv-error': { color: '#f85149' },
    '.cm-log-lv-warn': { color: '#d29922' },
    '.cm-log-lv-info': { color: '#3fa4f0' },
    '.cm-log-lv-debug, .cm-log-lv-trace': { color: '#8b949e' },
    '.cm-log-time': { color: '#8b949e' },
    '&light .cm-log-lv-fatal, &light .cm-log-lv-error': { color: '#cf222e' },
    '&light .cm-log-lv-warn': { color: '#9a6700' },
    '&light .cm-log-lv-info': { color: '#0969da' },
    '&light .cm-log-time, &light .cm-log-lv-debug, &light .cm-log-lv-trace': { color: '#6e7781' },
  }),
];
