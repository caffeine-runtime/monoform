// Owns one CodeMirror view for a tab: loading (streamed, off-thread decode),
// saving (chunked, off-thread encode, atomic write), encodings and EOLs.
import { EditorState, Transaction, Annotation, type Extension, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { openSearchPanel, gotoLine } from '@codemirror/search';
import { api } from '../../core/backend';
import { settings } from '../../core/settings.svelte';
import type { Tab } from '../../core/tabs.svelte';
import { ui } from '../../core/ui.svelte';
import { baseExtensions, heavyFeatures, languageFor, LARGE_FILE, makeCompartments, type Compartments } from './setup';
import { canWrite, EOL_LABELS, eolString, labelOf, type Encoding, type Eol } from './encoding';
import { decodeStream, saveDoc, EncodeError } from './textio';
import { sessionToken } from '../../core/backend';

const loadingAnno = Annotation.define<boolean>();

export interface ControllerOptions {
  /** Language support to use instead of detecting by file name. */
  language?: Extension;
  extensions?: Extension[];
  onDocChanged?: () => void;
  onLoaded?: () => void;
  /** Soft-wrap lines (default: the global word-wrap setting). */
  wrap?: boolean;
}

export class TextController {
  view: EditorView;
  c: Compartments;
  encoding: Encoding = 'utf-8';
  bom = true;
  eol: Eol = 'lf';
  large = false;
  loading = false;
  private saved: Text | null = null;
  private dirtyTimer: ReturnType<typeof setTimeout> | undefined;
  private statusFrame = 0;
  private wrap: boolean;

  constructor(
    public tab: Tab,
    parent: HTMLElement,
    private opts: ControllerOptions = {},
  ) {
    this.c = makeCompartments();
    this.wrap = opts.wrap ?? settings.value.wordWrap;
    this.view = new EditorView({ parent, state: this.makeState('') });
  }

  private makeState(doc: string, lineSep?: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        baseExtensions(this.c, { large: this.large, wrap: this.wrap, readOnly: this.tab.readOnly || this.loading, lineSep }),
        this.opts.extensions ?? [],
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(loadingAnno))) this.onEdit();
          if (u.selectionSet || u.docChanged) this.scheduleStatus();
        }),
      ],
    });
  }

  private onEdit() {
    this.tab.dirty = true;
    this.opts.onDocChanged?.();
    // Clear the dirty flag again if the user undid back to the saved text.
    clearTimeout(this.dirtyTimer);
    this.dirtyTimer = setTimeout(() => {
      const doc = this.view.state.doc;
      if (this.saved && doc.length === this.saved.length && doc.eq(this.saved)) this.tab.dirty = false;
    }, 300);
  }

  /** Load (or reload) content from the tab's source. */
  async load(encoding?: Encoding) {
    const tab = this.tab;
    if (tab.source.kind === 'untitled') {
      this.saved = this.view.state.doc;
      this.updateStatus();
      return;
    }
    this.loading = true;
    tab.status = { ...tab.status, info: 'Loading…' };
    let first = true;
    const prof = (globalThis as any).__hiaProf as ((label: string, ms: number) => void) | undefined;
    const timed = <T>(label: string, fn: () => T): T => {
      if (!prof) return fn();
      const t = performance.now();
      const r = fn();
      prof(label, performance.now() - t);
      return r;
    };
    await decodeStream(
      tab.url(),
      encoding,
      (meta) => {
        this.encoding = meta.encoding;
        this.bom = meta.bom;
        this.eol = meta.eol;
        tab.size = meta.size;
        this.large = meta.size > LARGE_FILE;
      },
      async (chunk) => {
        if (first) {
          first = false;
          // Mixed line endings: split only on \n so every \r is preserved.
          timed('setState', () => this.view.setState(this.makeState(chunk, this.eol === 'mixed' ? '\n' : undefined)));
        } else {
          const len = this.view.state.doc.length;
          timed('append', () => this.view.dispatch({ changes: { from: len, insert: chunk }, annotations: [Transaction.addToHistory.of(false), loadingAnno.of(true)] }));
          // Let the browser paint between chunks.
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    );
    if (first) this.view.setState(this.makeState(''));
    this.loading = false;
    timed('reconfigure', () => this.view.dispatch({ effects: this.c.readOnly.reconfigure(EditorState.readOnly.of(tab.readOnly)) }));
    this.saved = this.view.state.doc;
    tab.dirty = false;
    this.updateStatus();
    if (this.large) tab.status = { ...tab.status, info: 'Large file: highlighting off' };
    else tab.status = { ...tab.status, info: undefined };
    void this.applyLanguage();
    this.revealPending();
    this.opts.onLoaded?.();
  }

  async applyLanguage() {
    if (this.large) return;
    const lang = this.opts.language ?? (await languageFor(this.tab.name).catch(() => null));
    if (lang) this.view.dispatch({ effects: this.c.language.reconfigure(lang) });
  }

  /** Jump to tab.reveal (line/col, from search results or links). */
  revealPending() {
    const r = this.tab.reveal;
    if (!r || this.loading) return;
    this.tab.reveal = null;
    const doc = this.view.state.doc;
    if (r.line) {
      const line = doc.line(Math.max(1, Math.min(doc.lines, r.line)));
      const from = Math.min(line.to, line.from + Math.max(0, (r.col ?? 1) - 1));
      const to = r.text ? Math.min(line.to, from + r.text.length) : from;
      this.view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      this.view.focus();
    }
  }

  get lineSep(): string {
    return this.eol === 'mixed' ? '\n' : eolString(this.eol);
  }

  /** Save to the tab's file, or ask for a path. Returns false if cancelled. */
  async save(): Promise<boolean> {
    if (!this.tab.filePath || this.tab.readOnly) return this.saveAs();
    return this.writeTo(this.tab.filePath);
  }

  async saveAs(): Promise<boolean> {
    const suggested = this.tab.filePath ?? (this.tab.source.kind === 'archive-entry' ? this.tab.title : `${this.tab.title}.txt`);
    const path = await api.SaveFileDialog('Save as', suggested, []);
    if (!path) return false;
    const ok = await this.writeTo(path);
    if (ok) {
      this.tab.retarget(path);
      this.view.dispatch({ effects: this.c.readOnly.reconfigure(EditorState.readOnly.of(false)) });
      if (!this.opts.language) void this.applyLanguage();
    }
    return ok;
  }

  private async writeTo(path: string): Promise<boolean> {
    if (!canWrite(this.encoding)) {
      const ok = await ui.confirm(`Save as UTF-8?`, `${labelOf(this.encoding)} can't be written back. The file will be saved as UTF-8.`, 'Save as UTF-8');
      if (!ok) return false;
      this.encoding = 'utf-8';
    }
    const doc = this.view.state.doc;
    const write = async () => {
      // Show progress for big saves (status bar appears after 300 ms).
      const big = doc.length > 4 << 20;
      const t0 = performance.now();
      const entry = await saveDoc(doc, this.lineSep, this.encoding, this.bom, path, sessionToken(), (done, total) => {
        if (big && performance.now() - t0 > 300) this.tab.status = { ...this.tab.status, info: `Saving… ${Math.round((done / total) * 100)}%` };
      });
      this.tab.size = entry.size;
      if (big) this.tab.status = { ...this.tab.status, info: this.large ? 'Large file: highlighting off' : undefined };
    };
    try {
      await write();
    } catch (e) {
      if (e instanceof EncodeError && e.unencodable) {
        const ok = await ui.confirm(
          'Some characters don’t fit this encoding',
          `“${e.unencodable.char}” can't be saved as ${labelOf(this.encoding)}. Save as UTF-8 instead?`,
          'Save as UTF-8',
        );
        if (!ok) return false;
        this.encoding = 'utf-8';
        await write();
      } else throw e;
    }
    this.saved = doc;
    if (this.view.state.doc === doc) this.tab.dirty = false;
    this.updateStatus();
    return true;
  }

  find(replace = false) {
    openSearchPanel(this.view);
    if (replace) {
      queueMicrotask(() => this.view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus());
    }
  }

  gotoLine() {
    gotoLine(this.view);
  }

  toggleWrap() {
    this.wrap = !this.wrap;
    this.view.dispatch({ effects: this.c.wrap.reconfigure(this.wrap ? EditorView.lineWrapping : []) });
    if (this.opts.wrap === undefined) settings.update((s) => (s.wordWrap = this.wrap));
  }

  setEol(e: Exclude<Eol, 'mixed'>) {
    if (this.eol === e) return;
    const wasMixed = this.eol === 'mixed';
    this.eol = e;
    if (wasMixed) {
      // Normalise: re-split on any line break.
      const text = this.view.state.doc.toString().replace(/\r\n?/g, '\n');
      this.view.dispatch({ effects: this.c.lineSep.reconfigure([]), changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    }
    this.tab.dirty = true;
    this.updateStatus();
  }

  setEncoding(enc: Encoding) {
    this.encoding = enc;
    this.bom = enc === 'utf-16le' || enc === 'utf-16be' ? true : this.bom;
    this.tab.dirty = true;
    this.updateStatus();
  }

  async reopenWith(enc: Encoding) {
    if (this.tab.dirty && !(await ui.confirm('Discard changes?', 'Reopening with another encoding reloads the file from disk.', 'Reopen', true))) return;
    await this.load(enc);
  }

  private scheduleStatus() {
    if (this.statusFrame) return;
    this.statusFrame = requestAnimationFrame(() => {
      this.statusFrame = 0;
      this.updateStatus();
    });
  }

  updateStatus() {
    const st = this.view.state;
    const sel = st.selection.main;
    const line = st.doc.lineAt(sel.head);
    let pos = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    const selected = st.selection.ranges.reduce((n, r) => n + r.to - r.from, 0);
    if (selected) pos += ` (${selected} selected)`;
    if (st.selection.ranges.length > 1) pos += ` · ${st.selection.ranges.length} cursors`;
    this.tab.status = { ...this.tab.status, position: pos, encoding: labelOf(this.encoding), eol: EOL_LABELS[this.eol] };
  }

  /** Re-enable heavy features if a large file was shrunk below the limit (or vice versa). */
  setLarge(large: boolean) {
    this.large = large;
    this.view.dispatch({ effects: this.c.heavy.reconfigure(heavyFeatures(large)) });
  }

  destroy() {
    clearTimeout(this.dirtyTimer);
    cancelAnimationFrame(this.statusFrame);
    this.view.destroy();
  }
}
