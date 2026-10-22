<script lang="ts">
  import { fitBar } from '../../core/fit';
  // Log files: the code editor with level colouring, level chips with counts,
  // a text/regex filter whose matches are listed below (click to jump), next
  // error (F8), and Follow — new lines are appended as the file grows (only
  // the added bytes are read), like tail -f.
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import Icon from '../../shell/Icon.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Tab } from '../../core/tabs.svelte';
  import { formatShortcut } from '../../core/keys';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { logHighlight } from './highlight';
  import { levelCode, levelOf, LEVELS, type Level } from './levels';
  import { logViews } from './views';
  import { num, t, tn } from '../../core/i18n';

  let { tab }: { tab: Tab } = $props();

  let ctl: TextController | null = null;
  /** Per line (index = line - 1): level code, + 8 when inherited from the line above (stack traces). */
  let levels = new Uint8Array(0);
  let scanned = 0;
  let counts = $state<number[]>([0, 0, 0, 0, 0, 0, 0]);
  let scanning = $state(false);
  const GROUPS: { id: string; label: string; show: string; hide: string; codes: number[] }[] = [
    { id: 'error', label: t('Errors'), show: t('Show errors in the filtered list'), hide: t('Hide errors in the filtered list'), codes: [1, 2] },
    { id: 'warn', label: t('Warnings'), show: t('Show warnings in the filtered list'), hide: t('Hide warnings in the filtered list'), codes: [3] },
    { id: 'info', label: t('Info'), show: t('Show info in the filtered list'), hide: t('Hide info in the filtered list'), codes: [4] },
    { id: 'debug', label: t('Debug'), show: t('Show debug in the filtered list'), hide: t('Hide debug in the filtered list'), codes: [5, 6] },
  ];
  let shown = $state<Record<string, boolean>>({ error: true, warn: true, info: true, debug: true });
  let query = $state('');
  let regex = $state(false);
  let follow = $state(false);
  let matches = $state<Int32Array>(new Int32Array(0));
  let matching = $state(false);
  let badRegex = $state(false);
  let list = $state<HTMLDivElement>();
  let listTop = $state(0);
  let listH = $state(200);
  let docVersion = $state(0);
  const ROW = 20;

  const filtering = $derived(!!query || GROUPS.some((g) => !shown[g.id]));
  const groupCount = (g: (typeof GROUPS)[number]) => g.codes.reduce((n, c) => n + counts[c], 0);

  /** Classify lines [scanned, end) in slices so big files never block the UI. */
  async function scan() {
    if (!ctl || scanning) return;
    scanning = true;
    try {
      const doc = () => ctl!.view.state.doc;
      const total = doc().lines;
      if (levels.length < total) {
        const grown = new Uint8Array(Math.max(total, Math.ceil(levels.length * 1.5)));
        grown.set(levels.subarray(0, scanned));
        levels = grown;
      }
      const c = [...counts];
      let prev = scanned > 0 ? levels[scanned - 1] & 7 : 0;
      while (scanned < total) {
        const t0 = performance.now();
        const d = doc();
        while (scanned < total && performance.now() - t0 < 6) {
          const end = Math.min(total, scanned + 400);
          for (let n = scanned + 1; n <= end; n++) {
            const line = d.line(n);
            const code = levelCode(levelOf(line.length > 300 ? d.sliceString(line.from, line.from + 300) : line.text));
            if (code) {
              levels[n - 1] = code;
              c[code]++;
              prev = code;
            } else levels[n - 1] = prev && line.length ? prev | 8 : 0;
          }
          scanned = end;
        }
        counts = [...c];
        await new Promise((r) => setTimeout(r, 0));
        if (!ctl) return;
      }
    } finally {
      scanning = false;
    }
    if (filtering) void runFilter();
  }

  let filterSeq = 0;
  async function runFilter() {
    if (!ctl) return;
    const my = ++filterSeq;
    if (!filtering) {
      matches = new Int32Array(0);
      return;
    }
    let re: RegExp | null = null;
    badRegex = false;
    if (query && regex) {
      try {
        re = new RegExp(query, 'i');
      } catch {
        badRegex = true;
        return;
      }
    }
    const q = query.toLowerCase();
    const allowed = new Uint8Array(8);
    for (const g of GROUPS) if (shown[g.id]) for (const c of g.codes) allowed[c] = 1;
    const anyLevelOff = GROUPS.some((g) => !shown[g.id]);
    matching = true;
    const out: number[] = [];
    const d = ctl.view.state.doc;
    const total = d.lines;
    for (let n = 1; n <= total; ) {
      const t0 = performance.now();
      for (; n <= total && performance.now() - t0 < 8; n++) {
        const lv = levels[n - 1] & 7;
        if (anyLevelOff && !(lv ? allowed[lv] : false)) continue;
        if (query) {
          const text = d.line(n).text;
          if (re ? !re.test(text) : !text.toLowerCase().includes(q)) continue;
        }
        out.push(n);
      }
      await new Promise((r) => setTimeout(r, 0));
      if (my !== filterSeq) return;
    }
    matches = Int32Array.from(out);
    matching = false;
  }

  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => void runFilter(), 150);
  }

  function jump(line: number) {
    if (!ctl) return;
    const d = ctl.view.state.doc;
    const l = d.line(Math.max(1, Math.min(d.lines, line)));
    ctl.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    ctl.view.focus();
  }

  function nextError(dir: 1 | -1 = 1) {
    if (!ctl) return;
    const d = ctl.view.state.doc;
    const cur = d.lineAt(ctl.view.state.selection.main.head).number;
    const total = Math.min(scanned, d.lines);
    for (let k = 1; k <= total; k++) {
      const n = ((cur - 1 + dir * k + total * 2) % total) + 1;
      const v = levels[n - 1];
      if (v === 1 || v === 2) return jump(n);
    }
  }

  async function tick() {
    if (!ctl) return;
    const r = await ctl.follow();
    if (r === 'none') return;
    if (r === 'reloaded') {
      levels = new Uint8Array(0);
      scanned = 0;
      counts = [0, 0, 0, 0, 0, 0, 0];
    } else if (scanned > 0) {
      // The last line may have been partial: classify it again.
      const code = levels[scanned - 1];
      if (code && code < 8) counts = counts.map((n, i) => (i === code ? n - 1 : n));
      scanned--;
    }
    docVersion++;
    void scan();
    if (follow) {
      const v = ctl.view;
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.length, { y: 'end' }) });
    }
  }

  // An external change while following: read the new lines at once.
  $effect(() => {
    if (follow && tab.external === 'changed') {
      tab.external = null;
      void tick();
    }
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  function setFollow(on: boolean) {
    follow = on;
    clearInterval(timer);
    if (on) {
      void tick();
      const v = ctl?.view;
      v?.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.length, { y: 'end' }) });
      // The file watcher is the fast path; this catches what it coalesces.
      timer = setInterval(() => void tick(), 1500);
    }
  }

  const options = {
    extensions: [logHighlight],
    onLoaded: () => {
      levels = new Uint8Array(0);
      scanned = 0;
      counts = [0, 0, 0, 0, 0, 0, 0];
      docVersion++;
      void scan();
    },
  };

  const listFirst = $derived(Math.max(0, Math.floor(listTop / ROW) - 5));
  const listRows = $derived.by(() => {
    void docVersion;
    const out: { i: number; n: number; text: string; lv: number }[] = [];
    const d = ctl?.view.state.doc;
    if (!d) return out;
    for (let i = listFirst; i < Math.min(matches.length, listFirst + Math.ceil(listH / ROW) + 10); i++) {
      const n = matches[i];
      if (n > d.lines) continue;
      const t = d.line(n).text;
      out.push({ i, n, text: t.length > 500 ? t.slice(0, 500) + '…' : t, lv: levels[n - 1] & 7 });
    }
    return out;
  });

  logViews.set(tab.id, { nextError: () => nextError(1), prevError: () => nextError(-1), toggleFollow: () => setFollow(!follow) });

  (tab as unknown as { logTest: unknown }).logTest = {
    counts: () => counts,
    scanning: () => scanning || scanned < (ctl?.view.state.doc.lines ?? 0),
    setQuery: (q: string, r = false) => {
      query = q;
      regex = r;
      return runFilter();
    },
    setShown: (s: Record<string, boolean>) => {
      shown = { ...shown, ...s };
      return runFilter();
    },
    matches: () => matches,
    matching: () => matching,
    setFollow,
    follow: () => follow,
    tick,
    nextError,
    line: () => (ctl ? ctl.view.state.doc.lineAt(ctl.view.state.selection.main.head).number : 0),
    lines: () => ctl?.view.state.doc.lines ?? 0,
    dirty: () => tab.dirty,
  };

  onMount(() => {
    const ro = new ResizeObserver(() => (listH = list?.clientHeight ?? 200));
    $effect(() => {
      if (list) ro.observe(list);
    });
    return () => {
      ro.disconnect();
      clearInterval(timer);
      logViews.delete(tab.id);
      ctl = null;
    };
  });
</script>

<div class="toolbar" use:fitBar>
  {#each GROUPS as g (g.id)}
    <button class="chip {g.id}" class:off={!shown[g.id]} aria-pressed={shown[g.id]} title={shown[g.id] ? g.hide : g.show} onclick={() => ((shown = { ...shown, [g.id]: !shown[g.id] }), scheduleFilter())}>
      {g.label} <b>{num(groupCount(g))}</b>
    </button>
  {/each}
  {#if scanning}<span class="label"><span class="spinner inline"></span></span>{/if}
  <span class="sep"></span>
  <div class="filter" class:bad={badRegex}>
    <input class="input" placeholder={t('Filter lines')} bind:value={query} oninput={scheduleFilter} onkeydown={(e) => e.key === 'Escape' && ((query = ''), scheduleFilter())} aria-label={t('Filter lines')} />
    <button class="rx" class:on={regex} title={t('Regular expression')} aria-pressed={regex} onclick={() => ((regex = !regex), scheduleFilter())}>.*</button>
  </div>
  <button class="btn ghost" title={t('Next error ({next}; previous: {previous})', { next: formatShortcut('F8'), previous: formatShortcut('Shift+F8') })} onclick={() => nextError(1)}><Icon icon={ChevronDown} size={14} /> {t('Next error')}</button>
  <span class="spacer"></span>
  <button class="btn ghost" class:on={follow} title={t('Follow: show new lines as they are written (like tail -f)')} aria-pressed={follow} onclick={() => setFollow(!follow)}><Icon icon={Radio} size={14} /> {t('Follow')}</button>
</div>

<div class="body">
  <div class="editor"><TextEditor {tab} {options} onready={(c) => (ctl = c)} /></div>
  {#if filtering}
    <div class="results">
      <div class="rhead">
        <span>{matching ? t('Filtering…') : tn('{n} matching line', '{n} matching lines', matches.length)}{badRegex ? ` — ${t('invalid regular expression')}` : ''}</span>
        <span class="spacer"></span>
        <button class="icon-btn" title={t('Clear the filter')} onclick={() => ((query = ''), (shown = { error: true, warn: true, info: true, debug: true }), runFilter())}><Icon icon={XIcon} size={14} /></button>
      </div>
      <div class="list" bind:this={list} onscroll={() => (listTop = list!.scrollTop)}>
        <div style:height="{matches.length * ROW}px" style:position="relative">
          {#each listRows as r (r.i)}
            <button class="hit lv{r.lv}" style:top="{r.i * ROW}px" onclick={() => jump(r.n)}><span class="ln">{r.n}</span><span class="tx">{r.text}</span></button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text);
    border-radius: 6px;
    padding: 2px 10px;
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .chip b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .chip.error b {
    color: #f85149;
  }
  .chip.warn b {
    color: #d29922;
  }
  .chip.info b {
    color: #3fa4f0;
  }
  .chip.off {
    opacity: 0.45;
    text-decoration: line-through;
  }
  .filter {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
  }
  .filter.bad {
    border-color: var(--danger);
  }
  .filter .input {
    border: none;
    width: calc(220px * var(--ui-scale));
    background: none;
  }
  .rx {
    border: none;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    cursor: pointer;
    padding: 0 8px;
  }
  .rx.on {
    color: var(--accent-text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .results {
    height: 38%;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg-sidebar);
  }
  .rhead {
    display: flex;
    align-items: center;
    padding: 2px 10px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .spacer {
    flex: 1;
  }
  .list {
    flex: 1;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--ui-scale));
  }
  .hit {
    position: absolute;
    left: 0;
    right: 0;
    height: 20px;
    display: flex;
    gap: 10px;
    align-items: center;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    padding: 0 10px;
    cursor: pointer;
    white-space: pre;
    overflow: hidden;
  }
  .hit:hover {
    background: var(--bg-hover);
  }
  .hit .ln {
    color: var(--text-faint);
    min-width: 7ch;
    text-align: right;
  }
  .hit.lv1,
  .hit.lv2 {
    background: rgba(248, 81, 73, 0.1);
  }
  .hit.lv3 {
    background: rgba(210, 153, 34, 0.1);
  }
</style>
