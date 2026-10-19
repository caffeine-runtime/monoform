<script lang="ts">
  import { onMount, tick } from 'svelte';
  import 'pdfjs-dist/web/pdf_viewer.css';
  import { EventBus, PDFLinkService, PDFFindController, PDFViewer } from './viewer';
  import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
  import Icon from '../../shell/Icon.svelte';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import MousePointer from '@lucide/svelte/icons/text-cursor';
  import Highlighter from '@lucide/svelte/icons/highlighter';
  import MessageSquare from '@lucide/svelte/icons/message-square-text';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Search from '@lucide/svelte/icons/search';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import XIcon from '@lucide/svelte/icons/x';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import { pdfjs, openDocument } from './pdfjs';
  import Thumbs from './Thumbs.svelte';
  import { pdfControllers } from './controllers';
  import { parseRanges } from './pages';
  import { api, fileUrl, saveFile } from '../../core/backend';
  import { jobs } from '../../core/jobs.svelte';
  import { basename, dirname, join, stem } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { menu, toastError, ui } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';

  let { tab }: { tab: Tab } = $props();

  const { AnnotationEditorType, AnnotationMode } = pdfjs;
  type ToolId = 'none' | 'highlight' | 'freetext' | 'ink';
  const MODES: Record<ToolId, number> = {
    none: AnnotationEditorType.NONE,
    highlight: AnnotationEditorType.HIGHLIGHT,
    freetext: AnnotationEditorType.FREETEXT,
    ink: AnnotationEditorType.INK,
  };

  let container = $state<HTMLDivElement>();
  let viewerEl = $state<HTMLDivElement>();
  let findInput = $state<HTMLInputElement>();
  let doc = $state.raw<PDFDocumentProxy | null>(null);
  let viewer: PDFViewer | null = null;
  let eventBus: EventBus;
  let task: PDFDocumentLoadingTask | null = null;
  let page = $state(1);
  let pages = $state(0);
  let scale = $state(1);
  let tool = $state<ToolId>('none');
  let thumbsOpen = $state(true);
  let selected = $state<number[]>([]);
  let error = $state('');
  let loading = $state(true);
  let findOpen = $state(false);
  let query = $state('');
  let caseSensitive = $state(false);
  let matches = $state<{ current: number; total: number } | null>(null);
  let notFound = $state(false);
  // The file currently shown: the original, or a temp working copy after
  // page operations (saved over the original on Save).
  let working = $state('');
  let opsDirty = $state(false);
  let annotDirty = $state(false);
  let pageInput = $state('1');
  /** Time from load start to first page drawn (performance budget). */
  let firstPageMs = 0;

  $effect(() => {
    tab.dirty = opsDirty || annotDirty;
  });

  function updateStatus() {
    tab.status = {
      ...tab.status,
      type: 'PDF',
      position: pages ? `Page ${page} of ${pages}` : undefined,
      info: `${Math.round(scale * 100)}%${opsDirty ? ' · pages changed' : ''}`,
    };
  }

  function setup() {
    eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    viewer = new PDFViewer({
      container: container!,
      viewer: viewerEl,
      eventBus,
      linkService,
      findController,
      annotationMode: AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: AnnotationEditorType.NONE,
      removePageBorders: true,
      // Low-res first, then sharpened: pages are drawn into a canvas of at
      // most ~1 MP (fast, CSS-scaled), then pdf.js draws a sharp "detail"
      // canvas for just the visible area on top.
      maxCanvasPixels: 1024 * 1024,
      enableDetailCanvas: true,
      enableAutoLinking: true,
      imageResourcesPath: '/pdfjs/images/',
    });
    linkService.setViewer(viewer);
    eventBus.on('pagechanging', (e: { pageNumber: number }) => {
      page = e.pageNumber;
      pageInput = String(page);
      updateStatus();
    });
    eventBus.on('scalechanging', (e: { scale: number }) => {
      scale = e.scale;
      updateStatus();
    });
    eventBus.on('pagerendered', (e: { pageNumber: number }) => {
      if (!firstPageMs && e.pageNumber >= 1) {
        firstPageMs = performance.now() - loadStart;
        timings.first = firstPageMs;
        (tab as unknown as { pdfFirstPageMs: number }).pdfFirstPageMs = firstPageMs;
      }
    });
    eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => (matches = e.matchesCount));
    eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount?: { current: number; total: number } }) => {
      notFound = e.state === 1; // FindState.NOT_FOUND
      if (e.matchesCount) matches = e.matchesCount;
    });
    eventBus.on('annotationeditormodechanged', (e: { mode: number }) => {
      const t = (Object.keys(MODES) as ToolId[]).find((k) => MODES[k] === e.mode);
      if (t) tool = t;
    });
  }

  let loadStart = 0;
  const timings: Record<string, number> = {};
  (tab as unknown as { pdfTimings: Record<string, number> }).pdfTimings = timings;

  async function load(url: string, keep?: { page: number; scale: string | number }) {
    loading = true;
    error = '';
    firstPageMs = 0;
    loadStart = performance.now();
    try {
      const prevTask = task;
      task = openDocument({ url });
      const d = await task.promise;
      timings.doc = performance.now() - loadStart;
      doc = d;
      pages = d.numPages;
      selected = selected.filter((p) => p <= pages);
      const storage = d.annotationStorage as unknown as { onSetModified: () => void; onResetModified: () => void };
      storage.onSetModified = () => (annotDirty = true);
      storage.onResetModified = () => (annotDirty = false);
      annotDirty = false;
      viewer!.setDocument(d);
      (viewer as unknown as { linkService: PDFLinkService }).linkService.setDocument(d);
      if (prevTask && prevTask !== task) void prevTask.destroy();
      eventBus.on(
        'pagesinit',
        () => {
          timings.init = performance.now() - loadStart;
          viewer!.currentScaleValue = keep ? String(keep.scale) : 'page-width';
          if (keep) viewer!.currentPageNumber = Math.min(keep.page, d.numPages);
        },
        { once: true },
      );
      updateStatus();
    } catch (e) {
      const err = e as Error & { name?: string };
      error = err?.name === 'PasswordException' ? 'This PDF is password-protected (opening encrypted PDFs arrives with the encryption tools).' : `Couldn't open this PDF: ${err?.message ?? err}`;
    } finally {
      loading = false;
    }
  }

  function keepView() {
    return { page, scale: viewer?.currentScaleValue ?? 'page-width' };
  }

  /** A file on disk with the current state (annotations included), for pdfcpu. */
  async function materialize(): Promise<string> {
    if (!doc) throw new Error('no document');
    if (annotDirty || !working) {
      const tmp = await api.TempPath(`${stem(tab.name) || 'document'}.pdf`);
      const bytes = annotDirty ? await doc.saveDocument() : await doc.getData();
      await saveFile(tmp, bytes);
      return tmp;
    }
    return working;
  }

  async function pageOp(op: { kind: string; pages?: number[]; degrees?: number; order?: number[]; others?: string[] }) {
    if (tab.readOnly && tab.source.kind !== 'archive-entry') return;
    try {
      const src = await materialize();
      const out = await api.PdfOp(src, '', { kind: op.kind, pages: op.pages ?? [], degrees: op.degrees ?? 0, order: op.order ?? [], others: op.others ?? [] });
      working = out;
      opsDirty = true;
      await load(fileUrl(out), keepView());
    } catch (e) {
      toastError(e, 'Page operation failed');
    }
  }

  function targetPages(): number[] {
    return selected.length ? selected : [page];
  }

  async function save(): Promise<boolean> {
    if (!tab.filePath || tab.readOnly) return saveAs();
    return writeTo(tab.filePath);
  }

  async function saveAs(): Promise<boolean> {
    const p = await api.SaveFileDialog('Save PDF as', tab.filePath ?? tab.title, [{ name: 'PDF', patterns: '*.pdf' }]);
    if (!p) return false;
    const target = /\.pdf$/i.test(p) ? p : `${p}.pdf`;
    const ok = await writeTo(target);
    if (ok) tab.retarget(target);
    return ok;
  }

  async function writeTo(target: string): Promise<boolean> {
    if (!doc) return false;
    const view = keepView();
    if (annotDirty) {
      const bytes = await doc.saveDocument();
      const e = await saveFile(target, bytes);
      tab.size = e.size;
    } else if (working && working !== target) {
      await api.CopyFile(working, target);
    } else if (!working) {
      const e = await saveFile(target, await doc.getData());
      tab.size = e.size;
    }
    if (working && working !== target && working !== tab.filePath) void api.RemoveTemp(working);
    working = target;
    opsDirty = false;
    annotDirty = false;
    // Reload from disk so the viewer shows exactly what was written.
    await load(fileUrl(target), view);
    return true;
  }

  function setTool(t: ToolId) {
    if (!viewer || !doc) return;
    tool = t;
    viewer.annotationEditorMode = { mode: MODES[t] };
  }

  function zoom(dir: 1 | -1 | 0) {
    if (!viewer) return;
    if (dir === 0) viewer.currentScaleValue = '1';
    else viewer.updateScale({ steps: dir });
  }

  function find(prev = false, again = true) {
    if (!query) return;
    eventBus.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive, entireWord: false, highlightAll: true, findPrevious: prev, matchDiacritics: false });
  }

  function openFind() {
    findOpen = true;
    void tick().then(() => {
      findInput?.focus();
      findInput?.select();
    });
  }

  function closeFind() {
    findOpen = false;
    query = '';
    matches = null;
    eventBus?.dispatch('findbarclose', { source: null });
  }

  async function gotoPrompt() {
    const v = await ui.prompt(`Go to page (1–${pages})`, String(page), 'Go');
    if (v) gotoPage(Number(v));
  }

  function gotoPage(n: number) {
    if (viewer && n >= 1 && n <= pages) viewer.currentPageNumber = n;
    pageInput = String(page);
  }

  async function deletePages() {
    const p = targetPages();
    if (p.length >= pages) {
      ui.toast("A PDF needs at least one page.", 'warning');
      return;
    }
    if (!(await ui.confirm(`Delete ${p.length === 1 ? `page ${p[0]}` : `${p.length} pages`}?`, 'You can still close without saving to undo this.', 'Delete', true))) return;
    selected = [];
    await pageOp({ kind: 'delete', pages: p });
  }

  async function extract() {
    const p = targetPages();
    const def = join(dirname(tab.path ?? ''), `${stem(tab.name)} (pages ${p.length > 3 ? `${p[0]}-${p[p.length - 1]}` : p.join(',')}).pdf`);
    const dest = await api.SaveFileDialog('Extract pages to', def, [{ name: 'PDF', patterns: '*.pdf' }]);
    if (!dest) return;
    try {
      const src = await materialize();
      const out = await api.PdfOp(src, /\.pdf$/i.test(dest) ? dest : `${dest}.pdf`, { kind: 'extract', pages: p, degrees: 0, order: [], others: [] });
      ui.toast(`Extracted ${p.length} page${p.length === 1 ? '' : 's'} to ${basename(out)}`, 'success', { label: 'Open', run: () => void workspace.openPath(out) });
    } catch (e) {
      toastError(e, 'Extract failed');
    }
  }

  async function merge() {
    const files = await api.OpenFilesDialog('Choose PDFs to append', [{ name: 'PDF', patterns: '*.pdf' }]);
    if (!files?.length) return;
    await pageOp({ kind: 'merge', others: files });
    ui.toast(`Appended ${files.length} file${files.length === 1 ? '' : 's'}. Save to keep the result.`, 'success');
  }

  async function split() {
    const span = await ui.prompt('Pages per file', '1', 'Choose folder…');
    if (!span) return;
    const n = Number(span);
    if (!Number.isInteger(n) || n < 1) {
      ui.toast('Enter a whole number of pages.', 'warning');
      return;
    }
    const dir = await api.OpenFolderDialog('Save the parts in');
    if (!dir) return;
    const src = await materialize();
    const done = await jobs.run<string[]>('Splitting PDF', () => api.PdfSplit(src, dir, n));
    if (done.error) toastError(done.error, 'Split failed');
    else ui.toast(`Wrote ${done.result.length} files to ${basename(dir)}`, 'success');
  }

  function thumbMenu(e: MouseEvent) {
    const n = targetPages().length;
    const what = n === 1 ? 'page' : `${n} pages`;
    menu.show(e, [
      { label: `Rotate ${what} clockwise`, run: () => pageOp({ kind: 'rotate', pages: targetPages(), degrees: 90 }) },
      { label: `Rotate ${what} counter-clockwise`, run: () => pageOp({ kind: 'rotate', pages: targetPages(), degrees: -90 }) },
      { separator: true },
      { label: `Extract ${what} to new PDF…`, run: extract },
      { label: `Delete ${what}`, run: deletePages },
    ]);
  }

  function opsMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const n = targetPages().length;
    const what = n === 1 ? `page ${targetPages()[0]}` : `${n} selected pages`;
    menu.show({ clientX: r.right - 220, clientY: r.bottom + 4 }, [
      { label: `Rotate ${what} clockwise`, run: () => pageOp({ kind: 'rotate', pages: targetPages(), degrees: 90 }) },
      { label: `Rotate ${what} counter-clockwise`, run: () => pageOp({ kind: 'rotate', pages: targetPages(), degrees: -90 }) },
      { label: `Delete ${what}`, run: deletePages },
      { label: `Extract ${what} to new PDF…`, run: extract },
      {
        label: 'Extract page range…',
        run: async () => {
          const v = await ui.prompt(`Pages to extract (e.g. 1-3, 7) of ${pages}`, `1-${pages}`, 'Next');
          if (!v) return;
          const list = parseRanges(v, pages);
          if (!list) return ui.toast('That page range is not valid.', 'warning');
          selected = list;
          await extract();
        },
      },
      { separator: true },
      { label: 'Append PDFs…', run: merge },
      { label: 'Split into files…', run: split },
    ]);
  }

  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !viewer) return;
    e.preventDefault();
    viewer.updateScale({ drawingDelay: 300, scaleFactor: Math.exp(-e.deltaY * 0.01), origin: [e.clientX, e.clientY] });
  }

  function linkClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (/^(https?|mailto):/i.test(href)) {
      e.preventDefault();
      void api.OpenExternal(href);
    }
  }

  pdfControllers.set(tab.id, {
    zoom,
    fit: (m) => viewer && (viewer.currentScaleValue = m),
    tool: (t) => setTool(t),
    find: openFind,
    findNext: (prev) => (findOpen && query ? find(prev) : openFind()),
    goto: () => void gotoPrompt(),
    rotate: (deg) => void pageOp({ kind: 'rotate', pages: targetPages(), degrees: deg }),
    deletePages: () => void deletePages(),
    extract: () => void extract(),
    merge: () => void merge(),
    split: () => void split(),
    toggleThumbs: () => (thumbsOpen = !thumbsOpen),
    escape: () => {
      if (findOpen) closeFind();
      else if (tool !== 'none') setTool('none');
      return true;
    },
  });

  // Hooks for the self-test harness.
  (tab as unknown as { pdfTest: unknown }).pdfTest = {
    doc: () => doc,
    viewer: () => viewer,
    pageOp,
    save,
    writeTo,
    setQuery: (q: string) => {
      query = q;
      find(false, false);
    },
    matches: () => matches,
    working: () => working,
  };

  onMount(() => {
    setup();
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs,
      find: openFind,
      reload: () => load(tab.url(), keepView()),
      onShow: () => {
        viewer?.update();
        updateStatus();
      },
      getState: () => ({ page, scale: viewer?.currentScaleValue }),
    };
    working = tab.filePath ?? '';
    const st = tab.restoredState as { page?: number; scale?: string } | undefined;
    void load(tab.url(), st?.page ? { page: st.page, scale: st.scale ?? 'page-width' } : undefined);
    return () => {
      pdfControllers.delete(tab.id);
      task?.destroy();
      void doc?.loadingTask.destroy();
      if (working && working !== tab.filePath) void api.RemoveTemp(working);
    };
  });

  const tools: { id: ToolId; icon: any; label: string }[] = [
    { id: 'none', icon: MousePointer, label: 'Select text' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight (select text)' },
    { id: 'freetext', icon: MessageSquare, label: 'Text comment (click to place)' },
    { id: 'ink', icon: PenLine, label: 'Draw' },
  ];
</script>

<div class="toolbar">
  <button class="icon-btn" class:on={thumbsOpen} title="Page thumbnails" onclick={() => (thumbsOpen = !thumbsOpen)}><Icon icon={PanelLeft} /></button>
  <span class="sep"></span>
  <input
    class="input page"
    bind:value={pageInput}
    onkeydown={(e) => e.key === 'Enter' && gotoPage(Number(pageInput))}
    onblur={() => (pageInput = String(page))}
    aria-label="Page number"
  />
  <span class="label">of {pages}</span>
  <span class="sep"></span>
  <button class="btn ghost" title="Zoom out ({formatShortcut('Mod+-')})" onclick={() => zoom(-1)}>−</button>
  <button class="btn ghost zoomlabel" title="Actual size" onclick={() => zoom(0)}>{Math.round(scale * 100)}%</button>
  <button class="btn ghost" title="Zoom in ({formatShortcut('Mod+=')})" onclick={() => zoom(1)}>+</button>
  <button class="btn ghost" onclick={() => viewer && (viewer.currentScaleValue = 'page-width')}>Fit width</button>
  <button class="btn ghost" onclick={() => viewer && (viewer.currentScaleValue = 'page-fit')}>Fit page</button>
  <span class="sep"></span>
  {#each tools as t (t.id)}
    <button class="icon-btn" class:on={tool === t.id} title={t.label} disabled={tab.readOnly && t.id !== 'none'} onclick={() => setTool(t.id)}><Icon icon={t.icon} /></button>
  {/each}
  <span class="spacer"></span>
  <button class="icon-btn" class:on={findOpen} title="Find ({formatShortcut('Mod+F')})" onclick={() => (findOpen ? closeFind() : openFind())}><Icon icon={Search} /></button>
  <button class="icon-btn" title="Page operations" disabled={tab.readOnly} onclick={opsMenu}><Icon icon={Ellipsis} /></button>
</div>

{#if findOpen}
  <div class="findbar">
    <input
      class="input"
      class:bad={notFound && query}
      bind:this={findInput}
      bind:value={query}
      placeholder="Find in document"
      oninput={() => find(false, false)}
      onkeydown={(e) => {
        if (e.key === 'Enter') find(e.shiftKey);
        else if (e.key === 'Escape') closeFind();
      }}
    />
    <button class="icon-btn" title="Previous (Shift+Enter)" onclick={() => find(true)}><Icon icon={ChevronUp} /></button>
    <button class="icon-btn" title="Next (Enter)" onclick={() => find(false)}><Icon icon={ChevronDown} /></button>
    <label class="chk"><input type="checkbox" bind:checked={caseSensitive} onchange={() => find(false, false)} /> Match case</label>
    <span class="label">
      {#if query && matches}{matches.total ? `${matches.current} of ${matches.total}` : 'No matches'}{/if}
    </span>
    <span class="spacer"></span>
    <button class="icon-btn" title="Close (Esc)" onclick={closeFind}><Icon icon={XIcon} /></button>
  </div>
{/if}

{#if opsDirty}
  <div class="banner">
    <span class="grow">Pages were changed. Save to write them to {tab.filePath ? basename(tab.filePath) : 'a file'}, or close without saving to discard.</span>
  </div>
{/if}

<div class="body">
  {#if thumbsOpen && doc}
    <Thumbs {doc} current={page} bind:selected onnavigate={gotoPage} onreorder={(order) => pageOp({ kind: 'reorder', order })} onmenu={thumbMenu} />
  {/if}
  <div class="wrap">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="container" bind:this={container} onwheel={wheel} onclick={linkClick}>
      <div class="pdfViewer selectable" bind:this={viewerEl}></div>
    </div>
    {#if error}<div class="empty-state overlay">{error}</div>{/if}
    {#if loading && !doc}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
  </div>
</div>

<style>
  .page {
    width: 52px;
    text-align: center;
    height: 26px;
  }
  .zoomlabel {
    min-width: 58px;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
  .findbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
  }
  .findbar .input {
    width: 260px;
  }
  .findbar .input.bad {
    border-color: var(--danger);
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 8px;
    color: var(--text-muted);
  }
  .chk input {
    accent-color: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .container {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--bg-sidebar);
  }
  .container :global(.pdfViewer .page) {
    margin: 14px auto;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
    border: none;
  }
  .container :global(.pdfViewer) {
    padding: 4px 0 24px;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
</style>
