<script lang="ts">
  import Save from '@lucide/svelte/icons/save';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import IndentIncrease from '@lucide/svelte/icons/indent-increase';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Braces from '@lucide/svelte/icons/braces';
  import Code from '@lucide/svelte/icons/code';
  import Table from '@lucide/svelte/icons/table';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import { fitBar } from '../../core/fit';
  // JSON / JSONC / YAML / TOML / XML / JSON Lines: tree + raw editor,
  // validation with line/column, pretty-print / minify (JSON), copy path,
  // view or save the others as JSON, and a table for lists of records.
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import Icon from '../../shell/Icon.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import Copy from '@lucide/svelte/icons/copy';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { extname, stem, dirname, join } from '../../core/paths';
  import { ui, toastError } from '../../core/ui.svelte';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { baseExtensions, makeCompartments, languageFor } from '../text/setup';
  import { DataClient, type TreeNode } from './dataClient';
  import JsonTree from './JsonTree.svelte';
  import { formatPath, type JsonError } from './jsonparse';
  import { dataControllers } from './dataControllers';
  import { XML_EXT } from './formatExt';
  import Grid, { type GridColumn } from './Grid.svelte';
  import { t, tn } from '../../core/i18n';

  let { tab }: { tab: Tab } = $props();

  type View = 'tree' | 'raw' | 'json' | 'table';
  const ext = extname(tab.name);
  const FORMATS: Record<string, string> = { yaml: 'yaml', yml: 'yaml', jsonc: 'jsonc', toml: 'toml', jsonl: 'jsonl', ndjson: 'jsonl', jsonlines: 'jsonl' };
  const format = FORMATS[ext] ?? (XML_EXT.includes(ext) ? 'xml' : 'json');
  const LABELS: Record<string, string> = { yaml: 'YAML', toml: 'TOML', xml: 'XML', jsonl: 'JSON Lines', json: 'JSON', jsonc: 'JSON' };
  const label = LABELS[format];
  /** Formats shown/saved "as JSON" (and not reformatted in place). */
  const isYaml = format !== 'json' && format !== 'jsonc';
  let table = $state<string[] | null>(null);
  let tableCols = $state<GridColumn[]>([]);
  let tableRows = $state(0);

  const client = new DataClient();
  let view = $state<View>((tab.restoredState as { view?: View } | undefined)?.view ?? 'tree');
  let ctl: TextController | null = null;
  let root = $state<TreeNode | null>(null);
  let error = $state<JsonError | null>(null);
  let docs = $state(1);
  let version = $state(0);
  let parsing = $state(false);
  let selectedPath = $state<(string | number)[]>([]);
  let tree = $state<JsonTree>();
  let jsonHost = $state<HTMLDivElement>();
  let jsonView: EditorView | null = null;
  let stale = true;
  let parseTimer: ReturnType<typeof setTimeout> | undefined;

  async function reparse() {
    if (!ctl) return;
    stale = false;
    parsing = true;
    const r = await client.parse(ctl.view.state.doc.toString(), format);
    parsing = false;
    error = r.ok ? null : (r.error ?? null);
    if (r.ok && r.root) {
      root = r.root;
      docs = r.documents ?? 1;
      version++;
      table = r.table ?? null;
      tableRows = r.table ? r.root.size : 0;
      if (r.table && (tableCols.length !== r.table.length || tableCols.some((c, i) => c.name !== r.table![i]))) tableCols = r.table.map((name) => ({ name, width: Math.min(280, Math.max(90, name.length * 9 + 40)) }));
      if (!r.table && view === 'table') view = 'tree';
    }
    tab.status = { ...tab.status, info: error ? t('Invalid {format}: line {line}, column {column}', { format: label, line: String(error.line), column: String(error.col) }) : t('Valid {format}', { format: label }) };
    if (view === 'json') void showJson();
  }

  function scheduleParse() {
    stale = true;
    clearTimeout(parseTimer);
    const len = ctl?.view.state.doc.length ?? 0;
    // Big documents only re-parse when the tree is visible.
    if (len > 2_000_000 && view === 'raw') return;
    parseTimer = setTimeout(reparse, len > 500_000 ? 800 : 200);
  }

  function setView(v: View) {
    view = v;
    workspace.touch();
    if (stale && v !== 'raw') void reparse();
    if (v === 'json') void showJson();
    if (v === 'raw') queueMicrotask(() => ctl?.view.requestMeasure());
  }

  async function showJson() {
    if (!jsonHost || error) return;
    const r = await client.stringify(2);
    if (r.text === undefined) return;
    if (!jsonView) {
      const c = makeCompartments();
      jsonView = new EditorView({
        parent: jsonHost,
        state: EditorState.create({ doc: r.text, extensions: baseExtensions(c, { large: r.text.length > 8 << 20, wrap: false, readOnly: true }) }),
      });
      const lang = await languageFor('x.json');
      if (lang) jsonView.dispatch({ effects: c.language.reconfigure(lang) });
    } else jsonView.dispatch({ changes: { from: 0, to: jsonView.state.doc.length, insert: r.text } });
  }

  function gotoError() {
    if (!error || !ctl) return;
    setView('raw');
    const doc = ctl.view.state.doc;
    const line = doc.line(Math.min(error.line, doc.lines));
    const pos = Math.min(line.to, line.from + error.col - 1);
    ctl.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    ctl.view.focus();
  }

  async function reformat(indent: number) {
    if (isYaml) return;
    if (error) {
      gotoError();
      return ui.toast(t('Fix the error first.'), 'warning');
    }
    const r = await client.stringify(indent);
    if (r.text === undefined || !ctl) return;
    const v = ctl.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: r.text + (indent ? '\n' : '') } });
  }

  function copyPath() {
    const p = formatPath(selectedPath);
    void navigator.clipboard.writeText(p).then(() => ui.toast(t('Copied {path}', { path: p }), 'success'));
  }

  async function copyValue() {
    const r = await client.stringify(2, selectedPath);
    if (r.text !== undefined) await navigator.clipboard.writeText(r.text);
    ui.toast(t('Value copied'), 'success');
  }

  async function saveAsJson() {
    const r = await client.stringify(2);
    if (r.text === undefined) return;
    const def = join(dirname(tab.path ?? ''), `${stem(tab.name)}.json`);
    const p = await api.SaveFileDialog(t('Save as JSON'), def, [{ name: 'JSON', patterns: '*.json' }]);
    if (!p) return;
    try {
      await saveFile(p, r.text + '\n');
      ui.toast(t('Saved JSON'), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e);
    }
  }

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view });
    const show = tab.handlers.onShow;
    tab.handlers.onShow = () => {
      show?.();
      if (view === 'raw') c.view.requestMeasure();
    };
    // Find always searches the raw text.
    tab.handlers.find = () => {
      setView('raw');
      queueMicrotask(() => c.find());
    };
  }

  dataControllers.set(tab.id, {
    view: (v) => setView(v as View),
    pretty: () => reformat(2),
    minify: () => reformat(0),
    copyPath,
    expandAll: () => tree?.expandAll(),
    collapseAll: () => tree?.collapseAll(),
  });

  (tab as unknown as { dataTest: unknown }).dataTest = { error: () => error, root: () => root, reparse, tree: () => tree, ctl: () => ctl, client, setView, reformat, selected: () => selectedPath, select: (p: (string | number)[]) => (selectedPath = p) };

  onMount(() => () => {
    dataControllers.delete(tab.id);
    client.destroy();
    jsonView?.destroy();
  });

  const options = { onDocChanged: () => scheduleParse(), onLoaded: () => void reparse() };
</script>

<div class="toolbar" use:fitBar>
  <div class="seg">
    <button class="btn ghost" class:on={view === 'tree'} onclick={() => setView('tree')}><Icon icon={ListTree} size={14} /> {t('Tree')}</button>
    {#if table}<button class="btn ghost" class:on={view === 'table'} title={t('The list of records as a table')} onclick={() => setView('table')}><Icon icon={Table} size={14} /> {t('Table')}</button>{/if}
    <button class="btn ghost" class:on={view === 'raw'} onclick={() => setView('raw')}><Icon icon={Code} size={14} /> {isYaml ? label : t('Raw')}</button>
    {#if isYaml}<button class="btn ghost" class:on={view === 'json'} onclick={() => setView('json')}><Icon icon={Braces} size={14} /> {t('As JSON')}</button>{/if}
  </div>
  <span class="sep"></span>
  {#if error}
    <button class="status bad" onclick={gotoError} title={t('Go to error')}>
      <Icon icon={CircleX} size={15} /> {t('Line {line}, column {column}: {message}', { line: String(error.line), column: String(error.col), message: error.message })}
    </button>
  {:else if root}
    <span class="status good"><Icon icon={CircleCheck} size={15} /> {t('Valid {format}', { format: label })}{format === 'yaml' && docs > 1 ? ` (${tn('{n} document', '{n} documents', docs)})` : format === 'jsonl' ? ` (${tn('{n} record', '{n} records', docs)})` : ''}</span>
  {:else if parsing}
    <span class="label">{t('Checking…')}</span>
  {/if}
  <span class="spacer"></span>
  {#if view === 'tree' && root}
    <button class="btn ghost" onclick={() => tree?.expandAll()}><Icon icon={ChevronsUpDown} size={14} /> {t('Expand all')}</button>
    <button class="btn ghost" onclick={() => tree?.collapseAll()}><Icon icon={ChevronsDownUp} size={14} /> {t('Collapse')}</button>
    <button class="btn ghost" title={t('Copy the path of the selected node')} onclick={copyPath}><Icon icon={Copy} size={14} /> {formatPath(selectedPath)}</button>
    <button class="btn ghost" onclick={copyValue}><Icon icon={ClipboardCopy} size={14} /> {t('Copy value')}</button>
  {/if}
  {#if !isYaml && !tab.readOnly}
    <button class="btn ghost" onclick={() => reformat(2)}><Icon icon={IndentIncrease} size={14} /> {t('Format')}</button>
    <button class="btn ghost" onclick={() => reformat(0)}><Icon icon={Minimize2} size={14} /> {t('Minify')}</button>
  {/if}
  {#if isYaml && view === 'json'}
    <button class="btn ghost" onclick={saveAsJson}><Icon icon={Save} size={14} /> {t('Save as JSON…')}</button>
  {/if}
</div>

<div class="body">
  <div class="raw" class:hidden={view !== 'raw'}><TextEditor {tab} {options} onready={ready} /></div>
  {#if view === 'tree'}
    <div class="pane">
      {#if root}
        <JsonTree bind:this={tree} {client} {root} {version} onselect={(n) => (selectedPath = n.path)} />
      {:else if error}
        <div class="empty-state">
          <p>{t("The document has an error, so the tree can't be shown.")}</p>
          <button class="btn" onclick={gotoError}>{t('Show line {line}', { line: String(error.line) })}</button>
        </div>
      {/if}
    </div>
  {/if}
  <div class="pane" class:hidden={view !== 'json'}><div class="jsonhost" bind:this={jsonHost}></div></div>
  {#if view === 'table' && table}
    <div class="pane grid"><Grid source={{ rows: async (s: number, e: number) => (await client.rows(s, e)).rows }} rowCount={tableRows} bind:columns={tableCols} {version} /></div>
  {/if}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg .btn {
    height: 26px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    font: inherit;
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 520px;
  }
  .status.good {
    color: var(--success);
  }
  .status.bad {
    color: var(--danger);
    cursor: pointer;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .raw,
  .pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .hidden {
    display: none;
  }
  .jsonhost {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .jsonhost :global(.cm-editor) {
    position: absolute;
    inset: 0;
  }
</style>
