<script lang="ts">
  // Compare two files side by side: text and code (line + word diff), data
  // (JSON/YAML: changed paths, optionally normalised; CSV: rows matched by a
  // key column), images (side by side, swipe, onion skin, difference) and
  // anything else byte by byte.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { api, fileUrl } from '../../core/backend';
  import { formatShortcut } from '../../core/keys';
  import { basename, extname } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { toastError } from '../../core/ui.svelte';
  import { DiffClient } from './diffClient';
  import { fold, type DataChange, type RowChange, type Stats } from './diff';
  import TextDiff from './TextDiff.svelte';
  import ImageDiff from './ImageDiff.svelte';
  import { compareViews } from './views';

  let { tab }: { tab: Tab } = $props();

  type Kind = 'text' | 'data' | 'csv' | 'image';
  interface TextResult {
    kind: 'text';
    rows: Int32Array;
    hunks: [number, number][];
    stats: Stats;
    lineCounts: [number, number];
    widths: [number, number];
    encodings: [string, string];
    sizes: [number, number];
    identicalBytes: boolean;
    changes?: DataChange[];
    rowChanges?: RowChange[];
    header: string[] | null;
    parseError: string;
    ms: number;
  }
  interface BinResult {
    kind: 'binary';
    sizes: [number, number];
    firstDiff: number;
  }

  const restored = (tab.restoredState ?? {}) as { b?: string; onlyChanges?: boolean; ignoreWs?: boolean; imageMode?: string };
  let a = $state(tab.source.kind === 'tool' ? (tab.source.path ?? '') : '');
  let b = $state(restored.b ?? '');
  let res = $state.raw<TextResult | BinResult | null>(null);
  let error = $state('');
  let busy = $state('');
  let ignoreWs = $state(restored.ignoreWs ?? false);
  let onlyChanges = $state(restored.onlyChanges ?? false);
  let normalize = $state(true);
  let keyCol = $state(0);
  let view = $state<'side' | 'changes'>('side');
  let imageMode = $state<'side' | 'swipe' | 'onion' | 'diff'>((restored.imageMode as never) ?? 'diff');
  let tol = $state(0);
  let imgResult = $state<{ changed: number; total: number; w: number; h: number; sizes: [string, string] } | null>(null);
  let current = $state(-1);
  let expanded = $state<Set<number>>(new Set());
  let textDiff = $state<TextDiff>();
  const client = new DiffClient();

  const IMG = ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'];
  const DATA = ['json', 'jsonc', 'geojson', 'webmanifest', 'yaml', 'yml'];
  const CSV = ['csv', 'tsv', 'tab'];
  const kind = $derived.by((): Kind => {
    const ea = extname(a);
    const eb = extname(b);
    if (IMG.includes(ea) && IMG.includes(eb)) return 'image';
    if (DATA.includes(ea) && DATA.includes(eb)) return 'data';
    if (CSV.includes(ea) && CSV.includes(eb)) return 'csv';
    return 'text';
  });

  const text = $derived(res?.kind === 'text' ? res : null);
  const folded = $derived.by(() => {
    if (!text) return { disp: new Int32Array(0), gaps: [] as [number, number][] };
    if (!onlyChanges) {
      const disp = new Int32Array(text.rows.length / 3);
      for (let i = 0; i < disp.length; i++) disp[i] = i;
      return { disp, gaps: [] as [number, number][] };
    }
    const f = fold(text.rows, 3);
    if (!expanded.size) return f;
    // Expanded gaps show their rows again.
    const disp: number[] = [];
    const gaps: [number, number][] = [];
    for (const v of f.disp) {
      if (v >= 0) disp.push(v);
      else if (expanded.has(f.gaps[-1 - v][0])) for (let r = f.gaps[-1 - v][0]; r < f.gaps[-1 - v][0] + f.gaps[-1 - v][1]; r++) disp.push(r);
      else {
        gaps.push(f.gaps[-1 - v]);
        disp.push(-gaps.length);
      }
    }
    return { disp: Int32Array.from(disp), gaps };
  });

  async function run() {
    if (!a || !b) return;
    error = '';
    current = -1;
    expanded = new Set();
    tab.handlers.getState = () => ({ b, onlyChanges, ignoreWs, imageMode });
    workspace.touch();
    if (kind === 'image') {
      res = null;
      return;
    }
    busy = 'Comparing…';
    try {
      const urls = [new URL(fileUrl(a), location.href).href, new URL(fileUrl(b), location.href).href];
      res = await client.call<TextResult | BinResult>({ type: 'text', urls, exts: [extname(a), extname(b)], kind, ignoreWs, normalize, keyCol });
      if (res.kind === 'binary' && res.firstDiff >= 0 && Math.max(...res.sizes) > 0) {
        // Text loading gave up (binary content): nothing more to do.
      }
      status();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = '';
    }
  }

  function status() {
    const s = text?.stats;
    tab.status = {
      ...tab.status,
      type: 'Compare',
      position: undefined,
      info: s ? (text!.hunks.length ? `${text!.hunks.length} change${text!.hunks.length === 1 ? '' : 's'}` : 'No differences') : imgResult ? `${imgResult.changed.toLocaleString()} pixels differ` : undefined,
    };
  }

  function go(dir: 1 | -1) {
    if (!text?.hunks.length) return;
    const n = text.hunks.length;
    current = current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n;
    textDiff?.reveal(text.hunks[current][0]);
  }

  async function choose(side: 'a' | 'b') {
    const r = await api.OpenFilesDialog(`Choose the ${side === 'a' ? 'left' : 'right'} file`, []);
    if (!r?.[0]) return;
    if (side === 'a') {
      a = r[0];
      tab.source = { kind: 'tool', tool: 'compare', path: a };
    } else b = r[0];
    void run();
  }

  function swap() {
    [a, b] = [b, a];
    tab.source = { kind: 'tool', tool: 'compare', path: a };
    void run();
  }

  const fmtVal = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));
  const mb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

  compareViews.set(tab.id, { next: () => go(1), prev: () => go(-1), swap, refresh: () => void run() });

  (tab as unknown as { compareTest: unknown }).compareTest = {
    result: () => res,
    image: () => imgResult,
    kind: () => kind,
    folded: () => folded,
    set: (opts: { ignoreWs?: boolean; onlyChanges?: boolean; normalize?: boolean; keyCol?: number; view?: 'side' | 'changes'; imageMode?: typeof imageMode; tol?: number }) => {
      if (opts.ignoreWs !== undefined) ignoreWs = opts.ignoreWs;
      if (opts.onlyChanges !== undefined) onlyChanges = opts.onlyChanges;
      if (opts.normalize !== undefined) normalize = opts.normalize;
      if (opts.keyCol !== undefined) keyCol = opts.keyCol;
      if (opts.view) view = opts.view;
      if (opts.imageMode) imageMode = opts.imageMode;
      if (opts.tol !== undefined) tol = opts.tol;
    },
    run,
    go,
    current: () => current,
    swap,
    paths: () => [a, b],
  };

  onMount(() => {
    tab.handlers = { ...tab.handlers, reload: run, onShow: status, getState: () => ({ b, onlyChanges, ignoreWs, imageMode }) };
    void run();
    return () => {
      compareViews.delete(tab.id);
      client.destroy();
    };
  });
</script>

<div class="toolbar">
  <button class="file" title="{a} — click to choose another file" onclick={() => choose('a')}><span class="tag">A</span>{a ? basename(a) : 'Choose a file…'}<Icon icon={FolderOpen} size={13} /></button>
  <button class="icon-btn" title="Swap left and right" onclick={swap}><Icon icon={ArrowLeftRight} /></button>
  <button class="file" title="{b} — click to choose another file" onclick={() => choose('b')}><span class="tag">B</span>{b ? basename(b) : 'Choose a file…'}<Icon icon={FolderOpen} size={13} /></button>
  <span class="sep"></span>
  {#if kind === 'image'}
    <div class="seg" role="radiogroup" aria-label="Image view">
      {#each [['side', 'Side by side'], ['swipe', 'Swipe'], ['onion', 'Onion skin'], ['diff', 'Difference']] as [m, l] (m)}
        <button role="radio" aria-checked={imageMode === m} class:on={imageMode === m} onclick={() => (imageMode = m as never)}>{l}</button>
      {/each}
    </div>
    {#if imageMode === 'diff'}<label class="opt" title="Ignore differences up to this much per colour channel (0–255): JPEG noise, slight colour shifts">Tolerance <input type="range" min="0" max="64" bind:value={tol} /><span class="v">{tol}</span></label>{/if}
  {:else}
    {#if (kind === 'data' || kind === 'csv') && text}
      <div class="seg" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={view === 'side'} class:on={view === 'side'} onclick={() => (view = 'side')}>Side by side</button>
        <button role="radio" aria-checked={view === 'changes'} class:on={view === 'changes'} onclick={() => (view = 'changes')}>Changes ({(text.changes ?? text.rowChanges ?? []).length})</button>
      </div>
    {/if}
    <label class="opt" title="Hide unchanged lines (3 lines of context around each change)"><input type="checkbox" bind:checked={onlyChanges} /> Only changes</label>
    <label class="opt" title="Treat lines that differ only in spaces and indentation as equal"><input type="checkbox" bind:checked={ignoreWs} onchange={run} /> Ignore whitespace</label>
    {#if kind === 'data'}<label class="opt" title="Compare pretty-printed with keys sorted, so formatting and key order don't count"><input type="checkbox" bind:checked={normalize} onchange={run} /> Normalise</label>{/if}
    {#if kind === 'csv' && text?.header}
      <label class="opt" title="Column that identifies a row (rows are matched by it, so reordering doesn't count as a change)">Key
        <select class="input" bind:value={keyCol} onchange={run}>{#each text.header as h, i (i)}<option value={i}>{h}</option>{/each}</select>
      </label>
    {/if}
  {/if}
  <span class="spacer"></span>
  {#if busy}<span class="label"><span class="spinner inline"></span> {busy}</span>{/if}
  {#if text}
    <span class="label stat">
      {#if text.identicalBytes}<b class="same">Identical</b>
      {:else if !text.hunks.length}<b class="same">No differences{ignoreWs ? ' (ignoring whitespace)' : normalize && kind === 'data' ? ' in content' : ''}</b>
      {:else}<span class="add">+{text.stats.added}</span> <span class="del">−{text.stats.removed}</span> <span class="chg">~{text.stats.changed}</span> · {current >= 0 ? `${current + 1} of ` : ''}{text.hunks.length} change{text.hunks.length === 1 ? '' : 's'}{/if}
    </span>
    <button class="icon-btn" title="Previous change ({formatShortcut('Shift+F7')})" disabled={!text.hunks.length} onclick={() => go(-1)}><Icon icon={ChevronUp} /></button>
    <button class="icon-btn" title="Next change ({formatShortcut('F7')})" disabled={!text.hunks.length} onclick={() => go(1)}><Icon icon={ChevronDown} /></button>
  {:else if imgResult && kind === 'image'}
    <span class="label stat">{imgResult.changed ? `${imgResult.changed.toLocaleString()} pixels differ (${((imgResult.changed / imgResult.total) * 100).toFixed(2)} %)` : 'Pixel-identical'}{imgResult.sizes[0] !== imgResult.sizes[1] ? ` · sizes ${imgResult.sizes[0]} vs ${imgResult.sizes[1]}` : ''}</span>
  {/if}
  <button class="icon-btn" title="Compare again (after the files changed)" onclick={run}><Icon icon={RefreshCw} /></button>
</div>

<div class="body">
  {#if !a || !b}
    <div class="empty-state">Choose two files to compare.</div>
  {:else if error}
    <div class="empty-state">{error}</div>
  {:else if kind === 'image'}
    <ImageDiff {client} srcA={fileUrl(a)} srcB={fileUrl(b)} mode={imageMode} {tol} onresult={(r) => ('error' in r ? (error = r.error) : ((imgResult = r), status()))} />
  {:else if res?.kind === 'binary'}
    <div class="empty-state binary">
      {#if res.firstDiff < 0}<p><b>The files are identical</b> ({mb(res.sizes[0])}).</p>
      {:else}<p><b>The files differ</b> — first at byte {res.firstDiff.toLocaleString()} (0x{res.firstDiff.toString(16).toUpperCase()}).</p>
        <p>Sizes: {mb(res.sizes[0])} and {mb(res.sizes[1])}.</p>{/if}
      <p class="muted">These aren't text files, so they're compared byte by byte.</p>
    </div>
  {:else if text}
    {#if text.parseError}<div class="banner"><span class="grow">Couldn't read the data ({text.parseError}); comparing the text instead.</span></div>{/if}
    {#if view === 'changes' && text.changes}
      <div class="changes">
        {#if !text.changes.length}<div class="empty-state">No differences in content.</div>{/if}
        <table>
          <thead><tr><th>Path</th><th>A</th><th>B</th></tr></thead>
          <tbody>
            {#each text.changes.slice(0, 5000) as c (c.path)}
              <tr class={c.kind}><td class="path">{c.path}</td><td>{fmtVal(c.a)}</td><td>{fmtVal(c.b)}</td></tr>
            {/each}
          </tbody>
        </table>
        {#if text.changes.length > 5000}<p class="muted">Showing the first 5,000 of {text.changes.length.toLocaleString()} changes.</p>{/if}
      </div>
    {:else if view === 'changes' && text.rowChanges}
      <div class="changes">
        {#if !text.rowChanges.length}<div class="empty-state">No differences in rows (matched by {text.header?.[keyCol] ?? 'the first column'}).</div>{/if}
        <table>
          <thead><tr><th>{text.header?.[keyCol] ?? 'Key'}</th><th>Change</th><th>Details</th></tr></thead>
          <tbody>
            {#each text.rowChanges.slice(0, 5000) as c, i (i)}
              <tr class={c.kind}>
                <td class="path">{c.key}</td>
                <td>{c.kind === 'added' ? `added (row ${c.rb + 1} in B)` : c.kind === 'removed' ? `removed (row ${c.ra + 1} in A)` : `changed (row ${c.ra + 1} → ${c.rb + 1})`}</td>
                <td>{#if c.cells}{#each c.cells as cell (cell.col)}<span class="cell"><b>{cell.name}:</b> <s>{cell.a}</s> → {cell.b}</span>{/each}{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <TextDiff bind:this={textDiff} {client} rows={text.rows} disp={folded.disp} gaps={folded.gaps} widths={text.widths} hunks={text.hunks} bind:current onexpand={(g) => (expanded = new Set([...expanded, folded.gaps[g][0]]))} />
    {/if}
  {/if}
</div>

<style>
  .file {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 30%;
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text);
    border-radius: var(--radius);
    padding: 3px 8px;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-small);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tag {
    font-weight: 600;
    color: var(--accent-text);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 3px 9px;
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    white-space: nowrap;
    margin: 0 4px;
  }
  .opt .v {
    min-width: 2ch;
  }
  .stat .add {
    color: var(--success);
  }
  .stat .del {
    color: var(--danger);
  }
  .stat .chg {
    color: var(--warning);
  }
  .stat .same {
    color: var(--success);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .changes {
    flex: 1;
    overflow: auto;
    padding: 8px 12px;
    font-size: var(--fs-small);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-soft);
    vertical-align: top;
    word-break: break-word;
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .path {
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  tr.added td:first-child {
    box-shadow: inset 3px 0 0 var(--success);
  }
  tr.removed td:first-child {
    box-shadow: inset 3px 0 0 var(--danger);
  }
  tr.changed td:first-child {
    box-shadow: inset 3px 0 0 var(--warning);
  }
  .cell {
    margin-right: 14px;
    display: inline-block;
  }
  .cell s {
    color: var(--text-muted);
  }
  .binary p {
    margin: 4px 0;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
