<script lang="ts">
  // SQL console: CodeMirror (SQL highlighting, schema-aware completion) and
  // the results of each statement — a read-only grid for rows, a line for
  // changes and errors. Ctrl+Enter runs the selection, or everything.
  import { onMount } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
  import { EditorState, Prec } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { sql, SQLite } from '@codemirror/lang-sql';
  import { editorTheme, highlight } from '../text/setup';
  import Grid, { type GridColumn } from '../data/Grid.svelte';
  import { display, type Result } from './edits';

  let {
    tables,
    initial = '',
    onrun,
  }: {
    /** table → columns, for completion */
    tables: Record<string, string[]>;
    initial?: string;
    onrun: (script: string) => Promise<Result[]>;
  } = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let results = $state<Result[]>([]);
  let shown = $state(0);
  let running = $state(false);
  let columns = $state<GridColumn[]>([]);
  let version = $state(0);
  const cur = $derived(results[shown]);

  export async function run() {
    if (!view || running) return;
    const sel = view.state.selection.main;
    const script = sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
    if (!script.trim()) return;
    running = true;
    try {
      results = await onrun(script);
      // Show the last result with rows (usually the SELECT you ran), else the last one.
      const withRows = results.map((r, i) => (r.columns?.length ? i : -1)).filter((i) => i >= 0);
      shown = withRows.length ? withRows[withRows.length - 1] : results.length - 1;
      prepare();
    } finally {
      running = false;
    }
  }

  function prepare() {
    const r = results[shown];
    columns = (r?.columns ?? []).map((name) => ({ name, width: Math.min(260, Math.max(80, name.length * 9 + 30)) }));
    version++;
  }

  export function setText(t: string) {
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, selection: { anchor: t.length } });
    view?.focus();
  }
  export const text = () => view?.state.doc.toString() ?? '';
  export const shownResult = () => results[shown];

  const source = {
    rows: async (s: number, e: number) => (cur?.rows ?? []).slice(s, e).map((r) => r.map((v) => display(v))),
  };

  onMount(() => {
    view = new EditorView({
      parent: host!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => (void run(), true) }])),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          sql({ dialect: SQLite, schema: tables, upperCaseKeywords: true }),
          syntaxHighlighting(highlight),
          editorTheme,
          EditorView.lineWrapping,
        ],
      }),
    });
    return () => view?.destroy();
  });
</script>

<div class="console">
  <div class="editor" bind:this={host}></div>
  <div class="bar">
    <button class="btn primary" disabled={running} title="Run the selection, or the whole script (Ctrl+Enter)" onclick={run}>{running ? 'Running…' : '▶ Run'}</button>
    {#if results.length > 1}
      <div class="tabs" role="tablist">
        {#each results as r, i (i)}
          <button role="tab" aria-selected={i === shown} class:on={i === shown} class:err={!!r.error} title={r.sql} onclick={() => ((shown = i), prepare())}>{i + 1}</button>
        {/each}
      </div>
    {/if}
    <span class="msg" class:err={!!cur?.error}>
      {#if cur?.error}{cur.error}
      {:else if cur?.columns}{cur.rows?.length ?? 0}{cur.more ? '+' : ''} row{cur.rows?.length === 1 ? '' : 's'} · {cur.millis} ms{cur.more ? ' (first rows only)' : ''}
      {:else if cur}{cur.affected} row{cur.affected === 1 ? '' : 's'} changed · {cur.millis} ms
      {/if}
    </span>
  </div>
  <div class="results">
    {#if cur?.columns?.length}
      <Grid {source} rowCount={cur.rows?.length ?? 0} bind:columns {version} />
    {:else if !results.length}
      <div class="empty-state">Write SQL above and press Ctrl+Enter. Changes are written right away (not with Save).</div>
    {/if}
  </div>
</div>

<style>
  .console {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .editor {
    height: 34%;
    min-height: 90px;
    border-bottom: 1px solid var(--border-soft);
    display: flex;
  }
  .editor :global(.cm-editor) {
    flex: 1;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
    font-size: var(--fs-small);
  }
  .tabs {
    display: flex;
    gap: 2px;
  }
  .tabs button {
    border: none;
    background: var(--bg-hover);
    color: inherit;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
  }
  .tabs .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tabs .err {
    color: var(--danger);
  }
  .msg {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg.err {
    color: var(--danger);
  }
  .results {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
</style>
