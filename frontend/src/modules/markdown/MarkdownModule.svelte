<script lang="ts">
  import PaneDivider, { savedRatio } from '../../shell/PaneDivider.svelte';
  import Eye from '@lucide/svelte/icons/eye';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import Icon from '../../shell/Icon.svelte';
  import Code from '@lucide/svelte/icons/code';
  import { fitBar, isNarrow } from '../../core/fit';
  import { onMount, untrack } from 'svelte';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import type { Completion, CompletionContext } from '@codemirror/autocomplete';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { boot } from '../../core/boot';
  import { basename, dirname, relative, resolveRelative } from '../../core/paths';
  import { toastError, ui } from '../../core/ui.svelte';
  import { countMarkdown, formatCounts, headingAt, type Counts, type OutlineItem } from '../../core/textStats';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { assetHandlers, noteAccepts } from './assets';
  import { markdownViews, type ViewMode } from './views';
  import { headingLine, isNotePath, linkAt, newNotePath, noteName, resolveLink, type NoteLink } from './links';
  import { noteIndex, vaultOf } from './noteIndex.svelte';
  import NotePanel, { type NotePanelView } from './NotePanel.svelte';
  import MdWorker from './mdWorker?worker';
  import './preview.css';

  let { tab }: { tab: Tab } = $props();

  const PANEL_KEY = 'mf.notePanel';
  function savedPanel(): NotePanelView | '' {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === null ? 'outline' : (v as NotePanelView | '');
    } catch {
      return 'outline';
    }
  }

  const restored = tab.restoredState as { view?: ViewMode; panel?: NotePanelView | '' } | undefined;
  let view = $state<ViewMode>(restored?.view ?? 'split');
  let ratio = $state(savedRatio('markdown'));
  let html = $state('');
  let previewEl = $state<HTMLDivElement>();
  let ctl: TextController | null = null;
  let worker: Worker | null = null;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncing = false;

  // Obsidian-style: outline, backlinks, outgoing links, word counts.
  const start = restored?.panel ?? savedPanel();
  let panelOpen = $state(!!start);
  let panelView = $state<NotePanelView>(start || 'outline');
  let headings = $state.raw<OutlineItem[]>([]);
  let links = $state.raw<NoteLink[]>([]);
  let counts = $state<Counts>({ words: 0, chars: 0 });
  let selCounts = $state<Counts | null>(null);
  let cursorLine = $state(1);
  let previewLine = $state(1);
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  $effect(() => {
    if (narrow) untrack(() => (panelOpen = false));
  });
  const path = $derived(tab.filePath ?? tab.path ?? '');
  const vault = $derived(path ? vaultOf(path) : '');
  const active = $derived(headingAt(headings, view === 'preview' ? previewLine : cursorLine));

  $effect(() => {
    tab.status = { ...untrack(() => tab.status), counts: formatCounts(counts, selCounts) };
  });

  function setPanel(open: boolean, v: NotePanelView = panelView) {
    panelOpen = open;
    panelView = v;
    workspace.touch();
  }
  // New notes open with the panel as it was last left.
  $effect(() => {
    const v = panelOpen ? panelView : '';
    try {
      localStorage.setItem(PANEL_KEY, v);
    } catch {
      /* not remembered */
    }
  });

  markdownViews.set(tab.id, {
    get: () => view,
    set: (v) => {
      view = v;
      workspace.touch();
      queueMicrotask(() => ctl?.view.requestMeasure());
    },
  });

  // ---------- [[ completion and Ctrl+click on links in the source ----------

  function completeNotes(ctx: CompletionContext) {
    const m = ctx.matchBefore(/\[\[[^\]\n|#]*$/);
    if (!m) return null;
    if (vault) void noteIndex.load(vault);
    const notes = noteIndex.paths().filter((p) => p !== path);
    const byName = new Map<string, number>();
    for (const p of notes) byName.set(noteName(p).toLowerCase(), (byName.get(noteName(p).toLowerCase()) ?? 0) + 1);
    const options: Completion[] = notes.map((p) => {
      const name = noteName(p);
      const rel = relative(noteIndex.root, p) ?? basename(p);
      // Names used twice are written with their folder.
      const insert = (byName.get(name.toLowerCase()) ?? 0) > 1 ? rel.replace(/\\/g, '/').replace(/\.(md|markdown|mdown|mkd)$/i, '') : name;
      return {
        label: name,
        detail: dirname(rel) === '.' || !rel.includes('/') ? '' : dirname(rel),
        type: 'text',
        boost: 10,
        apply: (v: EditorView, _c: Completion, from: number, to: number) => {
          const close = v.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]';
          v.dispatch({ changes: { from, to, insert: insert + close }, selection: { anchor: from + insert.length + 2 } });
        },
      };
    });
    return { from: m.from + 2, options, validFor: /^[^\]\n|#]*$/ };
  }

  const linkClicks = EditorView.domEventHandlers({
    mousedown(e, v) {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
      const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const line = v.state.doc.lineAt(pos);
      const hit = linkAt(line.text, pos - line.from);
      if (!hit) return false;
      e.preventDefault();
      if (hit.url) void api.OpenExternal(hit.url);
      else if (hit.link) void follow(hit.link);
      return true;
    },
  });

  const watchSelection = EditorView.updateListener.of((u) => {
    if (!u.selectionSet && !u.docChanged) return;
    const s = u.state;
    cursorLine = s.doc.lineAt(s.selection.main.head).number;
    let len = 0;
    for (const r of s.selection.ranges) len += r.to - r.from;
    if (!len) selCounts = null;
    else if (len < 2_000_000) selCounts = countMarkdown(s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to)).join('\n'));
  });

  const options = {
    minimap: false, // a preview sits beside the source
    language: markdown({ codeLanguages: languages }),
    extensions: [assetHandlers(tab), linkClicks, watchSelection, EditorState.languageData.of(() => [{ autocomplete: completeNotes }])],
    onDocChanged: () => schedule(),
    onLoaded: () => render(),
    wrap: true,
  };

  function schedule() {
    clearTimeout(timer);
    const len = ctl?.view.state.doc.length ?? 0;
    timer = setTimeout(render, len > 500_000 ? 600 : 120);
  }

  function render() {
    if (!ctl) return;
    worker ??= new MdWorker();
    const id = ++seq;
    worker.onmessage = (e) => {
      if (e.data.id !== seq) return;
      if (e.data.html !== undefined) html = e.data.html;
      counts = e.data.counts;
      headings = e.data.headings;
      links = e.data.links;
    };
    worker.postMessage({ id, text: ctl.view.state.doc.toString(), base: tab.path ?? '', token: boot.token, render: view !== 'source' });
  }

  $effect(() => {
    if (view !== 'source') untrack(render);
  });

  // The folder's notes, for backlinks and resolving [[links]]: on open, and again after a save.
  $effect(() => {
    if (vault) void noteIndex.load(vault);
  });
  let wasDirty = false;
  $effect(() => {
    const d = tab.dirty;
    if (wasDirty && !d && vault) void noteIndex.refresh(vault);
    wasDirty = d;
  });

  // Draw Mermaid / Graphviz blocks after each preview update (renderers load on first use).
  $effect(() => {
    if (!html.includes('class="diagram"') || !previewEl) return;
    const el = previewEl;
    void import('../diagram/render').then((m) => m.fillDiagrams(el));
  });

  // [[Links]] to notes that don't exist yet look different (as in Obsidian).
  $effect(() => {
    void html;
    void noteIndex.version;
    const el = previewEl;
    if (!el || !html.includes('wikilink')) return;
    const paths = noteIndex.paths();
    for (const a of el.querySelectorAll<HTMLElement>('a.wikilink')) {
      const t = a.dataset.wiki ?? '';
      a.classList.toggle('unresolved', !!t && noteIndex.root !== '' && !resolveLink({ target: t, wiki: true }, path, paths));
    }
  });

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view, panel: panelOpen ? panelView : '' });
    tab.handlers.accept = noteAccepts(tab, c.view);
    const prevShow = tab.handlers.onShow;
    tab.handlers.onShow = () => {
      prevShow?.();
      render();
      if (vault) void noteIndex.load(vault);
    };
    c.view.scrollDOM.addEventListener('scroll', syncFromEditor, { passive: true });
  }

  // Editor → preview scroll sync using data-line markers.
  function syncFromEditor() {
    if (!ctl || !previewEl || view !== 'split' || syncing) return;
    const v = ctl.view;
    const top = v.scrollDOM.scrollTop;
    const block = v.lineBlockAtHeight(top);
    const line = v.state.doc.lineAt(block.from).number;
    const els = previewEl.querySelectorAll<HTMLElement>('[data-line]');
    let target: HTMLElement | null = null;
    for (const el of els) {
      if (Number(el.dataset.line) <= line) target = el;
      else break;
    }
    if (v.scrollDOM.scrollTop + v.scrollDOM.clientHeight >= v.scrollDOM.scrollHeight - 4) {
      previewEl.scrollTop = previewEl.scrollHeight;
      return;
    }
    previewEl.scrollTop = target ? target.offsetTop - 12 : 0;
  }

  // Preview → which heading is in view (for the outline in preview mode).
  let scrollFrame = 0;
  function previewScroll() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!previewEl) return;
      const top = previewEl.getBoundingClientRect().top + 24;
      let line = 1;
      for (const el of previewEl.querySelectorAll<HTMLElement>('h1[data-line],h2[data-line],h3[data-line],h4[data-line],h5[data-line],h6[data-line]')) {
        if (el.getBoundingClientRect().top <= top) line = Number(el.dataset.line);
        else break;
      }
      previewLine = line;
    });
  }

  /** Go to a line of this note: the editor's cursor, and the preview scrolled to it. */
  function goLine(line: number) {
    if (ctl && view !== 'preview') {
      const doc = ctl.view.state.doc;
      const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
      ctl.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 12 }) });
      ctl.view.focus();
    }
    if (previewEl && view !== 'source') {
      const el = previewEl.querySelector<HTMLElement>(`[data-line="${line}"]`);
      if (el) {
        syncing = true;
        previewEl.scrollTop = el.offsetTop - 12;
        previewLine = line;
        setTimeout(() => (syncing = false), 100);
      }
    }
    if (narrow) panelOpen = false;
  }

  /** Open a note, at a line or heading. */
  async function openNote(p: string, at: { line?: number; heading?: string } = {}) {
    if (p === path) {
      const line = at.line ?? headings.find((h) => h.text.toLowerCase() === at.heading?.toLowerCase())?.line;
      if (line) goLine(line);
      return;
    }
    const line = at.line ?? headingLine(noteIndex.get(p), at.heading);
    await workspace.openPath(p, line ? { reveal: { line } } : {});
  }

  /** Follow a link (from the preview, the source or the panel); a missing note is created, as in Obsidian. */
  async function follow(link: Pick<NoteLink, 'target' | 'heading' | 'wiki'>) {
    if (!path) return;
    if (!link.target) return openNote(path, { heading: link.heading });
    await noteIndex.load(vault);
    const to = resolveLink(link, path, noteIndex.paths());
    if (to) return openNote(to, { heading: link.heading });
    if (link.wiki) return create(link);
    // A Markdown link to a file that isn't a note in the folder: open it if it exists.
    const p = resolveRelative(path, link.target);
    const [exists] = await api.Exists([p]);
    if (exists) await workspace.openPath(p);
    else if (isNotePath(p)) await create({ ...link, target: p });
    else ui.toast(`${basename(p)} wasn't found`, 'error');
  }

  async function create(link: Pick<NoteLink, 'target'>) {
    const p = link.target.startsWith('/') || /^[a-z]:[\\/]/i.test(link.target) ? link.target : newNotePath(link.target, path);
    try {
      const [exists] = await api.Exists([p]);
      if (!exists) await saveFile(p, `# ${noteName(p)}\n\n`);
      await noteIndex.refresh(vault);
      await workspace.openPath(p, { reveal: { line: 3 } });
    } catch (e) {
      toastError(e, "Couldn't create the note");
    }
  }

  function click(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const { file, anchor, external, wiki, heading } = a.dataset;
    if (wiki !== undefined) {
      void follow({ target: wiki, heading, wiki: true });
    } else if (external) {
      void api.OpenExternal(external);
    } else if (file) {
      void follow({ target: file, heading: anchor, wiki: false });
    } else if (anchor && previewEl) {
      previewEl.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  (tab as unknown as { noteTest: unknown }).noteTest = {
    headings: () => headings,
    links: () => links,
    counts: () => counts,
    selCounts: () => selCounts,
    active: () => active,
    view: () => view,
    panel: () => (panelOpen ? panelView : ''),
    setPanel,
    goLine,
    follow,
    editor: () => ctl?.view,
    preview: () => previewEl,
  };

  onMount(() => () => {
    markdownViews.delete(tab.id);
    worker?.terminate();
    clearTimeout(timer);
    cancelAnimationFrame(scrollFrame);
  });
</script>

<div class="toolbar" use:fitBar>
  <div class="seg" role="group" aria-label="View">
    <button class="btn ghost" class:on={view === 'source'} onclick={() => markdownViews.get(tab.id)?.set('source')}><Icon icon={Code} size={14} /> Source</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => markdownViews.get(tab.id)?.set('split')}><Icon icon={Columns2} size={14} /> Split</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => markdownViews.get(tab.id)?.set('preview')}><Icon icon={Eye} size={14} /> Preview</button>
  </div>
  <span class="spacer"></span>
  <button class="btn ghost" class:on={panelOpen} aria-pressed={panelOpen} title="Outline, backlinks and links" onclick={() => setPanel(!panelOpen)}><Icon icon={ListTree} size={14} /> Outline</button>
</div>
<div class="body" bind:clientWidth={bodyW}>
  <div class="panes" data-view={view}>
    <div class="src" style:flex={view === 'split' ? `0 0 ${ratio * 100}%` : null}><TextEditor {tab} {options} onready={ready} /></div>
    {#if view === 'split'}<PaneDivider bind:ratio key="markdown" />{/if}
    {#if view !== 'source'}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="preview selectable" bind:this={previewEl} onclick={click} onscroll={previewScroll}>
        <article class="md">{@html html}</article>
      </div>
    {/if}
  </div>
  {#if panelOpen}
    <NotePanel {path} {headings} {active} {links} bind:view={panelView} floating={narrow} onheading={(i) => goLine(headings[i].line)} onopen={(p, at) => void openNote(p, at)} oncreate={(l) => void create(l)} />
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
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .panes {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .src {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .preview {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    border-left: 1px solid var(--border-soft);
    position: relative;
  }
  .panes[data-view='preview'] .src {
    display: none;
  }
  .panes[data-view='preview'] .preview {
    border-left: none;
  }
</style>
