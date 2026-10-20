<script lang="ts">
  import { isNarrow } from '../../core/fit';
  import Maximize from '@lucide/svelte/icons/maximize';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import { fitBar } from '../../core/fit';
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
  import SignatureIcon from '@lucide/svelte/icons/signature';
  import Redact from '@lucide/svelte/icons/square-slash';
  import PdfMarks from './PdfMarks.svelte';
  import SignaturePad from './SignaturePad.svelte';
  import { markPolygon, matchRects, stampMatrix, type Mark, type TextRun } from './marks';
  import { buildFromImages, IMAGE_PATTERNS, pickPageSize, renderPage, scaleFor, toBlob } from './tools';
  import OcrPanel from '../ocr/OcrPanel.svelte';
  import { settings } from '../../core/settings.svelte';
  import ScanText from '@lucide/svelte/icons/scan-text';
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

  const { AnnotationEditorType, AnnotationMode, AnnotationEditorParamsType } = pdfjs;
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
  // A narrow pane (split view, small window): the panel floats over the
  // content, closed when the pane becomes narrow.
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  $effect(() => {
    if (narrow) thumbsOpen = false;
  });
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
  // Pending signatures / redactions (applied to the file with Apply or on Save).
  let marks = $state<Mark[]>([]);
  let markMode = $state<'redact' | 'sign' | null>(null);
  let placing = $state<{ src: string; aspect: number } | null>(null);
  let signOpen = $state(false);
  let layout = $state(0);
  let busy = $state('');
  // Colour and size for text boxes, drawing and highlights.
  let inkColor = $state('#d0021b');
  let textSize = $state(14);
  let inkWidth = $state(2);
  /** Time from load start to first page drawn (performance budget). */
  let firstPageMs = 0;

  $effect(() => {
    tab.dirty = opsDirty || annotDirty || marks.length > 0;
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
      requestAnimationFrame(() => layout++);
    });
    eventBus.on('pagesinit', () => requestAnimationFrame(() => layout++));
    eventBus.on('rotationchanging', () => requestAnimationFrame(() => layout++));
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
      applyParams();
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
      void checkScanned(d);
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
    if (marks.length && !(await applyMarks())) return false;
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
    if (t !== 'none') {
      markMode = null;
      placing = null;
    }
    viewer.annotationEditorMode = { mode: MODES[t] };
    applyParams();
  }

  /** Colour/size for the active pdf.js editor (new text boxes, drawings and highlights use them). */
  function applyParams() {
    if (!viewer || tool === 'none') return;
    const set = (type: number, value: unknown) => {
      try {
        (viewer as unknown as { annotationEditorParams: unknown }).annotationEditorParams = { type, value };
      } catch {
        /* not in this mode */
      }
    };
    if (tool === 'freetext') {
      set(AnnotationEditorParamsType.FREETEXT_COLOR, inkColor);
      set(AnnotationEditorParamsType.FREETEXT_SIZE, textSize);
    } else if (tool === 'ink') {
      set(AnnotationEditorParamsType.INK_COLOR, inkColor);
      set(AnnotationEditorParamsType.INK_THICKNESS, inkWidth);
    } else if (tool === 'highlight') set(AnnotationEditorParamsType.HIGHLIGHT_COLOR, inkColor);
  }

  // ---------- signatures and redaction ----------

  function startRedact() {
    if (!doc) return;
    setTool('none');
    placing = null;
    markMode = markMode === 'redact' ? null : 'redact';
  }

  function startSign() {
    if (!doc) return;
    setTool('none');
    markMode = null;
    signOpen = true;
  }

  function signaturePicked(src: string, aspect: number) {
    signOpen = false;
    placing = { src, aspect };
    markMode = 'sign';
    ui.toast('Click on the page where the signature goes. You can move and resize it afterwards.', 'info');
  }

  /** Redaction boxes over every match of the find query, on every page. */
  async function redactMatches() {
    if (!doc || !query) return;
    busy = 'Finding matches…';
    let n = 0;
    const add: Mark[] = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        for (const r of matchRects(tc.items as unknown as TextRun[], query, caseSensitive, page.getViewport({ scale: 1 }))) {
          add.push({ id: Date.now() + ++n, kind: 'redact', page: p, ...r });
        }
      }
    } finally {
      busy = '';
    }
    marks = [...marks, ...add];
    ui.toast(add.length ? `Marked ${add.length} match${add.length === 1 ? '' : 'es'} for redaction. Check them, then Apply.` : 'No matches to redact.', add.length ? 'success' : 'info');
  }

  /** Write pending marks into the working copy: redacted pages become images, then signatures are stamped. */
  async function applyMarks(): Promise<boolean> {
    if (!doc || !marks.length) return true;
    const redactPages = [...new Set(marks.filter((m) => m.kind === 'redact').map((m) => m.page))].sort((a, b) => a - b);
    if (redactPages.length && !(await ui.confirm('Apply redactions?', `The content under the black boxes is removed for good: ${redactPages.length === 1 ? `page ${redactPages[0]} becomes` : `${redactPages.length} pages become`} an image (its text can no longer be selected or searched; comments and form fields on it are flattened).`, 'Redact', true))) return false;
    const view = keepView();
    const temps: string[] = [];
    try {
      let src = await materialize();
      if (redactPages.length) {
        const rdoc = await openDocument({ url: fileUrl(src) }).promise;
        try {
          const pagesOut: { page: number; image: string; m: number[] }[] = [];
          for (const [i, n] of redactPages.entries()) {
            busy = `Redacting page ${n} (${i + 1} of ${redactPages.length})…`;
            const page = await rdoc.getPage(n);
            const [x0, y0, x1, y1] = page.view;
            const s = scaleFor(200, x1 - x0, y1 - y0);
            const c = await renderPage(rdoc, n, s, 0);
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#000';
            const shown = page.getViewport({ scale: 1 });
            const flat = page.getViewport({ scale: s, rotation: 0 });
            for (const m of marks.filter((k) => k.kind === 'redact' && k.page === n)) {
              const poly = markPolygon(m, shown, flat);
              ctx.beginPath();
              poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
              ctx.closePath();
              ctx.fill();
            }
            const tmp = await api.TempPath(`redact-${n}.jpg`);
            await saveFile(tmp, await toBlob(c, 'image/jpeg', 0.92));
            temps.push(tmp);
            pagesOut.push({ page: n, image: tmp, m: [x1 - x0, 0, 0, y1 - y0, x0, y0] });
          }
          src = await api.PdfReplacePages(src, pagesOut as never);
          temps.push(src);
        } finally {
          void rdoc.loadingTask.destroy();
        }
      }
      const signs = marks.filter((m) => m.kind === 'sign' && m.src);
      if (signs.length) {
        busy = 'Placing signatures…';
        const stamps: { page: number; image: string; m: number[] }[] = [];
        for (const m of signs) {
          const page = await doc.getPage(m.page);
          const tmp = await api.TempPath('signature.png');
          await saveFile(tmp, await (await fetch(m.src!)).blob());
          temps.push(tmp);
          stamps.push({ page: m.page, image: tmp, m: stampMatrix(m, page.getViewport({ scale: 1 })) });
        }
        src = await api.PdfStamp(src, stamps as never);
      }
      if (working && working !== tab.filePath && working !== src) void api.RemoveTemp(working);
      working = src;
      opsDirty = true;
      marks = [];
      markMode = null;
      placing = null;
      await load(fileUrl(src), view);
      return true;
    } catch (e) {
      toastError(e, 'Couldn’t apply the changes');
      return false;
    } finally {
      busy = '';
      for (const t of temps) if (t !== working) void api.RemoveTemp(t);
    }
  }

  // ---------- text recognition (scanned PDFs) ----------

  let ocrOpen = $state(false);
  let ocrScope = $state<'page' | 'all'>('all');
  let ocrKey = $state(0);
  let scanned = $state(false);

  async function pageHasText(d: PDFDocumentProxy, n: number): Promise<boolean> {
    const tc = await (await d.getPage(n)).getTextContent();
    return tc.items.some((i) => 'str' in i && i.str.trim() !== '');
  }

  /** After loading: does this look like a scan (no text on the first pages)? */
  async function checkScanned(d: PDFDocumentProxy) {
    scanned = false;
    for (let n = 1; n <= Math.min(3, d.numPages); n++) if (await pageHasText(d, n)) return;
    if (doc === d) scanned = true;
  }

  async function ocrPage(d: PDFDocumentProxy, n: number, langs: string[], withPdf: boolean, progress?: (s: string, p: number) => void) {
    const { recognize } = await import('../ocr/ocr');
    const pg = await d.getPage(n);
    const [x0, y0, x1, y1] = pg.view;
    const s = scaleFor(300, x1 - x0, y1 - y0);
    const c = await renderPage(d, n, s, withPdf ? 0 : undefined);
    return recognize(c, { langs, pdf: withPdf ? { dpi: 72 * s } : undefined }, progress);
  }

  async function runOcr(langs: string[], progress: (s: string, p: number) => void) {
    if (!doc) throw new Error('No document');
    const d = doc;
    const list = ocrScope === 'page' ? [page] : Array.from({ length: pages }, (_, i) => i + 1);
    const parts: string[] = [];
    let conf = 0;
    for (const [i, n] of list.entries()) {
      const r = await ocrPage(d, n, langs, false, (st, p) => progress(list.length > 1 ? `Page ${n} of ${list.length}: ${st}` : st, (i + p) / list.length));
      conf += r.confidence;
      parts.push(list.length > 1 ? `— Page ${n} —\n${r.text}` : r.text);
    }
    return { text: parts.join('\n\n'), confidence: conf / list.length };
  }

  /** Add an invisible text layer to every page that has no text, so the PDF can be searched and copied from. */
  async function makeSearchable(langs: string[]) {
    if (!doc || tab.readOnly) return;
    const d = doc;
    const todo: number[] = [];
    let rotated = 0;
    for (let n = 1; n <= pages; n++) {
      if (await pageHasText(d, n)) continue;
      if ((await d.getPage(n)).rotate % 360) rotated++;
      else todo.push(n);
    }
    if (!todo.length) {
      ui.toast(rotated ? 'The pages without text are rotated; turn them upright first (page operations), then try again.' : 'Every page already has text.', 'info');
      return;
    }
    const view = keepView();
    try {
      const layers: { page: number; pdf: string }[] = [];
      for (const [i, n] of todo.entries()) {
        busy = `Recognising page ${n} (${i + 1} of ${todo.length})…`;
        const r = await ocrPage(d, n, langs, true);
        if (!r.pdf || !r.text.trim()) continue;
        let bin = '';
        for (let k = 0; k < r.pdf.length; k += 0x8000) bin += String.fromCharCode(...r.pdf.subarray(k, k + 0x8000));
        layers.push({ page: n, pdf: btoa(bin) });
      }
      if (!layers.length) {
        ui.toast('No text was found on those pages.', 'info');
        return;
      }
      busy = 'Adding the text layer…';
      const out = await api.PdfAddTextLayer(await materialize(), layers as never);
      if (working && working !== tab.filePath) void api.RemoveTemp(working);
      working = out;
      opsDirty = true;
      await load(fileUrl(out), view);
      ui.toast(`${layers.length} page${layers.length === 1 ? ' is' : 's are'} now searchable${rotated ? ` (${rotated} rotated page${rotated === 1 ? '' : 's'} skipped)` : ''}. Save to keep it.`, 'success');
    } catch (e) {
      toastError(e, 'Couldn’t make the PDF searchable');
    } finally {
      busy = '';
    }
  }

  function openOcr(scope: 'page' | 'all') {
    ocrScope = scope;
    ocrKey++;
    ocrOpen = true;
  }

  // ---------- compress, export, insert images ----------

  async function compress() {
    const choice = await ui.pick('Compress PDF', [
      { id: '75:2000', label: 'Smaller — images as good-quality JPEG, up to 2000 px' },
      { id: '55:1200', label: 'Smallest — stronger compression, up to 1200 px' },
      { id: '0:0', label: 'Lossless — only clean up the file structure' },
    ]);
    if (!choice) return;
    const [q, px] = choice.split(':').map(Number);
    busy = 'Compressing…';
    try {
      const src = await materialize();
      const r = await api.PdfCompress(src, q, px);
      if (r.after >= r.before) {
        void api.RemoveTemp(r.path);
        ui.toast('This PDF is already as small as these settings can make it.', 'info');
        return;
      }
      if (working && working !== tab.filePath) void api.RemoveTemp(working);
      working = r.path;
      opsDirty = true;
      await load(fileUrl(r.path), keepView());
      const mb = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
      ui.toast(`${mb(r.before)} → ${mb(r.after)} (${Math.round((1 - r.after / r.before) * 100)}% smaller${r.recompressed ? `, ${r.recompressed} image${r.recompressed === 1 ? '' : 's'} recompressed` : ''}). Save to keep it.`, 'success');
    } catch (e) {
      toastError(e, 'Compress failed');
    } finally {
      busy = '';
    }
  }

  async function exportImages() {
    if (!doc) return;
    const fmt = await ui.pick('Export pages as images', [
      { id: 'png:150', label: 'PNG, 150 dpi' },
      { id: 'png:300', label: 'PNG, 300 dpi (print)' },
      { id: 'jpeg:150', label: 'JPEG, 150 dpi (smaller files)' },
      { id: 'jpeg:300', label: 'JPEG, 300 dpi' },
      { id: 'png:72', label: 'PNG, 72 dpi (screen)' },
    ]);
    if (!fmt) return;
    const [type, dpiS] = fmt.split(':');
    const list = selected.length ? [...selected].sort((a, b) => a - b) : Array.from({ length: pages }, (_, i) => i + 1);
    const dir = await api.OpenFolderDialog(`Save ${list.length} image${list.length === 1 ? '' : 's'} in`);
    if (!dir) return;
    const src = annotDirty ? await openDocument({ url: fileUrl(await materialize()) }).promise : doc;
    const ext = type === 'png' ? 'png' : 'jpg';
    const digits = String(pages).length;
    try {
      for (const [i, n] of list.entries()) {
        busy = `Exporting page ${n} (${i + 1} of ${list.length})…`;
        const page = await src.getPage(n);
        const [x0, y0, x1, y1] = page.view;
        const c = await renderPage(src, n, scaleFor(+dpiS, x1 - x0, y1 - y0));
        await saveFile(join(dir, `${stem(tab.name)}-${String(n).padStart(digits, '0')}.${ext}`), await toBlob(c, `image/${type}`, 0.9));
      }
      ui.toast(`Exported ${list.length} page${list.length === 1 ? '' : 's'} to ${basename(dir)}`, 'success');
    } catch (e) {
      toastError(e, 'Export failed');
    } finally {
      busy = '';
      if (src !== doc) void src.loadingTask.destroy();
    }
  }

  async function insertImages() {
    const files = await api.OpenFilesDialog('Images to add as pages', [{ name: 'Images', patterns: IMAGE_PATTERNS }]);
    if (!files?.length) return;
    const size = await pickPageSize();
    if (!size) return;
    busy = 'Adding images…';
    try {
      const tmp = await api.TempPath('images.pdf');
      const made = await buildFromImages([...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), tmp, size);
      await pageOp({ kind: 'merge', others: [made] });
      void api.RemoveTemp(made);
      ui.toast(`Added ${files.length} page${files.length === 1 ? '' : 's'} at the end. Save to keep them.`, 'success');
    } catch (e) {
      toastError(e, 'Couldn’t add the images');
    } finally {
      busy = '';
    }
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
      { label: 'Add images as pages…', run: insertImages },
      { label: 'Split into files…', run: split },
      { separator: true },
      { label: 'Compress…', run: compress },
      { label: 'Export pages as images…', run: exportImages },
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
      if (signOpen) signOpen = false;
      else if (markMode) {
        markMode = null;
        placing = null;
      } else if (findOpen) closeFind();
      else if (tool !== 'none') setTool('none');
      return true;
    },
    sign: startSign,
    redact: startRedact,
    compress: () => void compress(),
    exportImages: () => void exportImages(),
  });

  // Hooks for the self-test harness.
  (tab as unknown as { pdfTest: unknown }).pdfTest = {
    doc: () => doc,
    viewer: () => viewer,
    pageOp,
    scanned: () => scanned,
    makeSearchable,
    openOcr,
    save,
    writeTo,
    setQuery: (q: string) => {
      query = q;
      find(false, false);
    },
    matches: () => matches,
    working: () => working,
    marks: () => marks,
    setMarks: (m: Mark[]) => (marks = m),
    applyMarks,
    redactMatches,
    signaturePicked,
    startSign,
    signOpen: () => signOpen,
    compressWith: async (q: number, px: number) => {
      const r = await api.PdfCompress(await materialize(), q, px);
      working = r.path;
      opsDirty = true;
      await load(fileUrl(r.path), keepView());
      return r;
    },
    exportTo: async (dir: string, dpi: number) => {
      for (let n = 1; n <= pages; n++) await saveFile(join(dir, `p${n}.png`), await toBlob(await renderPage(doc!, n, dpi / 72), 'image/png'));
    },
    insertImages: async (files: string[], size: string) => {
      const made = await buildFromImages(files, await api.TempPath('images.pdf'), size);
      await pageOp({ kind: 'merge', others: [made] });
    },
    busy: () => busy,
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

<div class="toolbar" use:fitBar>
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
  <button class="btn ghost" onclick={() => viewer && (viewer.currentScaleValue = 'page-width')}><Icon icon={ArrowLeftRight} size={14} /> Fit width</button>
  <button class="btn ghost" onclick={() => viewer && (viewer.currentScaleValue = 'page-fit')}><Icon icon={Maximize} size={14} /> Fit page</button>
  <span class="sep"></span>
  {#each tools as t (t.id)}
    <button class="icon-btn" class:on={tool === t.id} title={t.label} disabled={tab.readOnly && t.id !== 'none'} onclick={() => setTool(t.id)}><Icon icon={t.icon} /></button>
  {/each}
  <button class="icon-btn" class:on={markMode === 'sign' || signOpen} title="Sign — draw, type or import your signature and place it on the page" disabled={tab.readOnly} onclick={startSign}><Icon icon={SignatureIcon} /></button>
  <button class="icon-btn" class:on={markMode === 'redact'} title="Redact — drag black boxes over what must go, then Apply (the content underneath is removed, not just covered)" disabled={tab.readOnly} onclick={startRedact}><Icon icon={Redact} /></button>
  {#if tool !== 'none'}
    <span class="sep"></span>
    <input class="color" type="color" title="Colour for new {tool === 'freetext' ? 'text' : tool === 'ink' ? 'drawings' : 'highlights'}" bind:value={inkColor} onchange={applyParams} />
    {#if tool === 'freetext'}
      <label class="opt" title="Text size">Size <input class="input num" type="number" min="4" max="100" bind:value={textSize} onchange={applyParams} /></label>
    {:else if tool === 'ink'}
      <label class="opt" title="Line thickness">Width <input type="range" min="1" max="20" bind:value={inkWidth} onchange={applyParams} /></label>
    {/if}
  {/if}
  <span class="spacer"></span>
  <button class="icon-btn" class:on={ocrOpen} title="Recognise text (OCR) — copy text from scanned pages, or make the PDF searchable" aria-label="Recognise text" onclick={() => (ocrOpen ? (ocrOpen = false) : openOcr(pages > 1 ? 'page' : 'all'))}><Icon icon={ScanText} /></button>
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
    {#if query && matches?.total && !tab.readOnly}<button class="btn ghost" title="Put a redaction box over every match (you can check and adjust them before applying)" onclick={redactMatches}><Icon icon={Redact} size={14} /> Redact all matches</button>{/if}
    <span class="spacer"></span>
    <button class="icon-btn" title="Close (Esc)" onclick={closeFind}><Icon icon={XIcon} /></button>
  </div>
{/if}

{#if marks.length}
  {@const ns = marks.filter((m) => m.kind === 'sign').length}
  {@const nr = marks.length - ns}
  <div class="banner">
    <span class="grow">{[ns ? `${ns} signature${ns === 1 ? '' : 's'}` : '', nr ? `${nr} redaction${nr === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')} not applied yet — move or resize them, then Apply (Save applies them too).</span>
    <button class="btn ghost" onclick={() => ((marks = []), (markMode = null), (placing = null))}>Discard</button>
    <button class="btn primary" onclick={() => applyMarks()}>Apply</button>
  </div>
{:else if markMode === 'redact'}
  <div class="banner"><span class="grow">Drag boxes over what to remove. Find (Ctrl+F) can mark every match at once.</span><button class="btn ghost" onclick={() => (markMode = null)}>Done</button></div>
{/if}
{#if busy}<div class="banner"><span class="spinner inline"></span><span class="grow">{busy}</span></div>{/if}
{#if scanned && !ocrOpen && !busy}
  <div class="banner scanned">
    <Icon icon={ScanText} size={14} /><span class="grow">This looks like a scan: its pages have no text to select or search.</span>
    <button class="btn ghost" onclick={() => openOcr('all')}>Copy text</button>
    {#if !tab.readOnly}<button class="btn primary" onclick={() => (ocrOpen = false, void makeSearchable(settings.value.ocrLangs?.length ? settings.value.ocrLangs : ['eng']))}>Make searchable</button>{/if}
    <button class="icon-btn" title="Dismiss" onclick={() => (scanned = false)}><Icon icon={XIcon} /></button>
  </div>
{/if}

{#if opsDirty}
  <div class="banner">
    <span class="grow">Pages were changed. Save to write them to {tab.filePath ? basename(tab.filePath) : 'a file'}, or close without saving to discard.</span>
  </div>
{/if}

<div class="body" bind:clientWidth={bodyW}>
  {#if thumbsOpen && doc}
    <div class="thumbhost" class:floating={narrow} class:left={narrow}>
    <Thumbs {doc} current={page} bind:selected onnavigate={(n) => (gotoPage(n), narrow && (thumbsOpen = false))} onreorder={(order) => pageOp({ kind: 'reorder', order })} onmenu={thumbMenu} />
    </div>
  {/if}
  <div class="wrap">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="container" bind:this={container} onwheel={wheel} onclick={linkClick}>
      <div class="pdfViewer selectable" bind:this={viewerEl}></div>
      {#if container && doc}<PdfMarks {container} bind:marks mode={markMode} {placing} {layout} onplaced={() => ((placing = null), (markMode = null))} />{/if}
    </div>
    {#if error}<div class="empty-state overlay">{error}</div>{/if}
    {#if loading && !doc}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
  </div>
  {#if ocrOpen && doc}
    {#key ocrKey}
      <OcrPanel title={ocrScope === 'page' ? `Text on page ${page}` : 'Text in the document'} run={runOcr} onclose={() => (ocrOpen = false)}>
        {#snippet actions({ langs })}
          <select class="input scope" value={ocrScope} onchange={(e) => openOcr((e.currentTarget as HTMLSelectElement).value as 'page' | 'all')} aria-label="Pages to read">
            <option value="page">This page</option>
            <option value="all">All pages</option>
          </select>
          {#if !tab.readOnly}<button class="btn ghost" title="Add an invisible text layer to the pages that have none, so the PDF can be searched and copied from" onclick={() => void makeSearchable(langs)}>Make searchable</button>{/if}
        {/snippet}
      </OcrPanel>
    {/key}
  {/if}
</div>

{#if signOpen}<SignaturePad onpick={signaturePicked} oncancel={() => (signOpen = false)} />{/if}

<style>
  .color {
    width: 28px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: none;
    cursor: pointer;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .num {
    width: 56px;
  }
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
    position: relative;
  }
  .thumbhost {
    display: flex;
    min-height: 0;
  }
  .scope {
    height: 24px;
    font-size: var(--fs-small);
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
