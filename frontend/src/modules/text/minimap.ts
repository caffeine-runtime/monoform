// Minimap (Sublime-style): a narrow canvas at the right edge drawing each
// line as small blocks in its syntax colours, with the visible part boxed;
// click or drag to scroll there. Only the lines that fit in the minimap are
// drawn (≈ 3 px per line), once per animation frame, so cost doesn't grow
// with the file. Also: indentation guides as line decorations.
import { EditorView, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { getIndentUnit, syntaxTree } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { minimapTitle } from './phrases';

const WIDTH = 96;
const LINE = 3; // px per line
const CHAR = 0.9; // px per character
const MAXCOL = 100;

// Token → CSS colour variable (resolved once per draw).
const tokenColour = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], class: '--syn-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: '--syn-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: '--syn-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: '--syn-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: '--syn-function' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.heading], class: '--syn-type' },
  { tag: [t.propertyName, t.attributeName], class: '--syn-property' },
]);

class Minimap {
  private canvas: HTMLCanvasElement;
  private frame = 0;
  private dragging = false;
  private onScroll = () => this.schedule();

  constructor(private view: EditorView) {
    const c = (this.canvas = document.createElement('canvas'));
    c.className = 'cm-minimap';
    c.title = minimapTitle();
    view.dom.appendChild(c);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
      this.scrollTo(e);
    });
    c.addEventListener('pointermove', (e) => this.dragging && this.scrollTo(e));
    c.addEventListener('pointerup', () => (this.dragging = false));
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged) this.schedule();
  }

  private schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  /** First line shown in the minimap, and how many fit. */
  private window(): { first: number; count: number; height: number } {
    const height = this.view.dom.clientHeight;
    const count = Math.max(1, Math.floor(height / LINE));
    const lines = this.view.state.doc.lines;
    const sc = this.view.scrollDOM;
    const frac = sc.scrollHeight > sc.clientHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight) : 0;
    const first = lines > count ? Math.round(frac * (lines - count)) + 1 : 1;
    return { first, count, height };
  }

  private scrollTo(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const { first } = this.window();
    const n = Math.min(this.view.state.doc.lines, Math.max(1, first + Math.floor((e.clientY - r.top) / LINE)));
    const pos = this.view.state.doc.line(n).from;
    this.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  }

  private draw() {
    this.frame = 0;
    const { view, canvas } = this;
    const { first, count, height } = this.window();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(WIDTH * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(WIDTH * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, WIDTH, height);
    const css = getComputedStyle(view.dom);
    const colour = (v: string) => css.getPropertyValue(v).trim() || '#888';
    const base = colour('--text-muted');
    const doc = view.state.doc;
    const last = Math.min(doc.lines, first + count - 1);
    const from = doc.line(first).from;
    const to = doc.line(last).to;
    // Base pass: every non-space run in the text colour.
    g.globalAlpha = 0.55;
    g.fillStyle = base;
    for (let n = first; n <= last; n++) {
      const text = doc.line(n).text;
      const y = (n - first) * LINE;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) && m.index < MAXCOL) g.fillRect(m.index * CHAR, y, Math.min(m[0].length, MAXCOL - m.index) * CHAR, LINE - 1);
    }
    // Syntax pass over the part already parsed.
    g.globalAlpha = 0.9;
    const cache = new Map<string, string>();
    highlightTree(
      syntaxTree(view.state),
      tokenColour,
      (a, b, cls) => {
        const fill = cache.get(cls) ?? colour(cls);
        cache.set(cls, fill);
        g.fillStyle = fill;
        for (let pos = a; pos < b; ) {
          const line = doc.lineAt(pos);
          const end = Math.min(b, line.to);
          const col = pos - line.from;
          if (col < MAXCOL) {
            const seg = doc.sliceString(pos, end);
            const re = /\S+/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(seg)) && col + m.index < MAXCOL) g.fillRect((col + m.index) * CHAR, (line.number - first) * LINE, Math.min(m[0].length, MAXCOL - col - m.index) * CHAR, LINE - 1);
          }
          pos = end + 1;
        }
      },
      from,
      to,
    );
    // The visible part.
    g.globalAlpha = 1;
    const sc = view.scrollDOM;
    const top = doc.lineAt(view.lineBlockAtHeight(sc.scrollTop).from).number;
    const bottom = doc.lineAt(view.lineBlockAtHeight(sc.scrollTop + sc.clientHeight - 1).from).number;
    g.fillStyle = colour('--selection');
    g.fillRect(0, (top - first) * LINE, WIDTH, Math.max(LINE, (bottom - top + 1) * LINE));
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.canvas.remove();
  }
}

export function minimap(): Extension {
  return [
    ViewPlugin.fromClass(Minimap),
    EditorView.editorAttributes.of({ class: 'cm-with-minimap' }),
    EditorView.theme({
      '&.cm-with-minimap .cm-scroller': { marginRight: `${WIDTH + 4}px` },
      '.cm-minimap': { position: 'absolute', top: '0', right: '0', width: `${WIDTH}px`, cursor: 'pointer', borderLeft: '1px solid var(--border-soft)', background: 'var(--bg)' },
    }),
  ];
}

// ---------- indent guides ----------

const guide = Decoration.mark({ class: 'cm-indent-guide' });

/** A thin line at each indentation level of the visible lines (unit: the file's indent width). */
class Guides {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  private build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>();
    const unit = Math.max(1, getIndentUnit(view.state));
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        const lead = /^[ \t]*/.exec(line.text)![0];
        let col = 0;
        for (let i = 0; i < lead.length; i++) {
          if (col > 0 && col % unit === 0) b.add(line.from + i, line.from + i + 1, guide);
          col += lead[i] === '\t' ? unit - (col % unit) : 1;
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}

export function indentGuides(): Extension {
  return [
    ViewPlugin.fromClass(Guides, { decorations: (v) => v.decorations }),
    EditorView.theme({ '.cm-indent-guide': { boxShadow: 'inset 1px 0 0 color-mix(in srgb, var(--text-faint) 35%, transparent)' } }),
  ];
}
