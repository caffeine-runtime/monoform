<script lang="ts">
  import { fitBar } from '../../core/fit';
  // .docx and .odt editing on a page-like canvas; .doc is converted to .docx.
  import { onMount, tick, untrack } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Underline from '@lucide/svelte/icons/underline';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import InfoIcon from '@lucide/svelte/icons/info';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import ListIcon from '@lucide/svelte/icons/list';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import IndentIncrease from '@lucide/svelte/icons/indent-increase';
  import IndentDecrease from '@lucide/svelte/icons/indent-decrease';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import AlignCenter from '@lucide/svelte/icons/align-center';
  import AlignRight from '@lucide/svelte/icons/align-right';
  import AlignJustify from '@lucide/svelte/icons/align-justify';
  import SuperscriptIcon from '@lucide/svelte/icons/superscript';
  import SubscriptIcon from '@lucide/svelte/icons/subscript';
  import Baseline from '@lucide/svelte/icons/baseline';
  import Highlighter from '@lucide/svelte/icons/highlighter';
  import RemoveFormatting from '@lucide/svelte/icons/remove-formatting';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import { theme } from '../../core/theme.svelte';
  import { availableFonts, fontLabel, GENERIC } from '../image/fonts';
  import OutlineTree from '../../shell/OutlineTree.svelte';
  import { isNarrow } from '../../core/fit';
  import { countText, formatCounts, type Counts, type OutlineItem } from '../../core/textStats';
  import { api, endpoint } from '../../core/backend';
  import { basename } from '../../core/paths';
  import type { Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';
  import { t } from '../../core/i18n';
  import { DocModel, HIGHLIGHT } from './docxModel';
  import { Numbering, type ListKind } from './docxNumbering';
  import { OdtModel } from './odtModel';
  import { officeControllers } from './controllers';

  let { tab }: { tab: Tab } = $props();

  let page = $state<HTMLDivElement>();
  let model: DocModel | OdtModel | null = null;
  let odt = $state(false);
  let note = $state('');
  let saveAs = $state('');
  let template = false;
  let error = $state('');
  let loading = $state(true);
  let blockStyle = $state('p');
  /** The kind of list the cursor is in (the list buttons show it). */
  let listAt = $state<ListKind | null>(null);
  /** Formatting at the cursor, shown by the toolbar. */
  let fontAt = $state('');
  let sizeAt = $state('');
  let alignAt = $state('left');
  let spacingAt = $state('');
  let supAt = $state<'sup' | 'sub' | ''>('');
  let lastColor = $state('C00000');
  let lastHighlight = $state('yellow');
  let palette = $state<'color' | 'highlight' | null>(null);
  /** The selection in the page, kept while a toolbar menu has the focus. */
  let lastRange: Range | null = null;
  const fonts = $derived(['', ...availableFonts().filter((f) => !GENERIC.includes(f))]);
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const TEXT_COLORS = ['000000', '595959', '7F7F7F', 'C00000', 'FF0000', 'FFC000', 'E3B800', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0', 'D6336C'];
  /** numbering.xml's entry and whether document.xml already has a relationship to it. */
  let numberingPart = { name: 'word/numbering.xml', related: false };
  let stylesPart = { name: 'word/styles.xml', related: true };
  let counts = $state<Counts>({ words: 0, chars: 0 });
  let selCounts = $state<Counts | null>(null);
  // The Navigation pane: the document's headings; click one to go to it.
  const OUTLINE_KEY = 'mf.docOutline';
  let outlineOpen = $state(remembered());
  let headings = $state.raw<OutlineItem[]>([]);
  let headingEls: HTMLElement[] = [];
  let active = $state(-1);
  let desk = $state<HTMLDivElement>();
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  $effect(() => {
    if (narrow) outlineOpen = false;
  });
  function remembered(): boolean {
    try {
      return localStorage.getItem(OUTLINE_KEY) !== '0';
    } catch {
      return true;
    }
  }
  function toggleOutline() {
    outlineOpen = !outlineOpen;
    try {
      localStorage.setItem(OUTLINE_KEY, outlineOpen ? '1' : '0');
    } catch {
      /* not remembered */
    }
  }
  // The .docx whose other parts (styles, images, headers…) are copied on save.
  let sourcePath = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const path = tab.filePath ?? '';
      if (!path) throw new Error(t('Documents inside archives can be viewed after extracting them.'));
      const r = await api.DocOpen(path);
      note = r.note;
      saveAs = r.saveAs;
      template = r.template;
      sourcePath = template ? '' : path;
      odt = r.format === 'odt';
      const partUrl = (entry: string) => endpoint('zip', { path, entry });
      const numRel = (r.rels ?? []).find((x) => x.type === 'numbering' && !x.external);
      numberingPart = { name: numRel?.target ?? 'word/numbering.xml', related: !!numRel };
      model = odt
        ? new OdtModel(r.document, { styles: r.styles ?? {}, textStyles: r.textStyles ?? {}, partUrl })
        : new DocModel(r.document, { styles: r.styles ?? {}, rels: r.rels ?? [], partUrl, numbering: new Numbering(r.numbering ?? '', r.stylesXml ?? ''), stylesXml: r.stylesXml ?? '' });
      stylesPart = (() => {
        const rel = (r.rels ?? []).find((x) => x.type === 'styles' && !x.external);
        return { name: rel?.target ?? 'word/styles.xml', related: !!rel };
      })();
      await tick();
      page!.replaceChildren(model.render(document));
      renumber();
      tab.dirty = false;
      count();
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      loading = false;
    }
  }

  function count() {
    counts = countText(page?.innerText ?? '');
    headingEls = page ? Array.from(page.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) : [];
    headings = headingEls.map((h, i) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').replace(/\s+/g, ' ').trim(), line: i }));
    tab.status = { ...tab.status, type: odt ? t('OpenDocument text') : template ? t('Word 97–2003 document') : t('Word document') };
    findActive();
  }

  $effect(() => {
    tab.status = { ...untrack(() => tab.status), counts: formatCounts(counts, selCounts) };
  });

  /** The heading the top of the view is in. */
  function findActive() {
    if (!desk) return;
    const top = desk.getBoundingClientRect().top + 32;
    let k = -1;
    for (let i = 0; i < headingEls.length; i++) {
      if (headingEls[i].getBoundingClientRect().top <= top) k = i;
      else break;
    }
    active = k;
  }
  let scrollFrame = 0;
  function scrolled() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(findActive);
  }

  function goHeading(i: number) {
    const h = headingEls[i];
    if (!h || !desk) return;
    desk.scrollTop += h.getBoundingClientRect().top - desk.getBoundingClientRect().top - 16;
    active = i;
    // Put the cursor at the heading, as Word's Navigation pane does.
    if (!tab.readOnly) {
      const r = document.createRange();
      r.selectNodeContents(h);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      page?.focus({ preventScroll: true });
    }
    if (narrow) outlineOpen = false;
  }

  function selectionCounts() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !page || !page.contains(sel.anchorNode)) {
      selCounts = null;
      return;
    }
    selCounts = countText(sel.toString());
  }

  /** Word list markers follow every edit (a new item, a removed one, a level change). */
  function renumber() {
    if (model instanceof DocModel && page) model.renumber(page);
  }

  let countTimer: ReturnType<typeof setTimeout> | undefined;
  function input() {
    tab.dirty = true;
    renumber();
    clearTimeout(countTimer);
    countTimer = setTimeout(count, 400);
  }

  /** A browser editing command on the selection; css: as inline styles (colours, fonts, alignment). */
  function exec(cmd: string, value?: string, css = false) {
    if (tab.readOnly) return;
    restoreSelection();
    document.execCommand('styleWithCSS', false, css ? 'true' : 'false');
    document.execCommand(cmd, false, value);
    input();
    syncBlock();
  }

  /** Put back the selection a toolbar menu took the focus from. */
  function restoreSelection() {
    if (!page) return;
    const sel = window.getSelection();
    const inPage = !!sel?.rangeCount && page.contains(sel.getRangeAt(0).commonAncestorContainer);
    page.focus({ preventScroll: true });
    if (!inPage && lastRange && page.contains(lastRange.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(lastRange);
    }
  }

  function setStyle(style: string) {
    const tag = style === 'title' ? 'h1' : style;
    exec('formatBlock', tag === 'p' ? '<p>' : `<${tag}>`);
    for (const b of selectedBlocks()) if (b.tagName === 'H1') b.classList.toggle('title', style === 'title');
    syncBlock();
  }

  /** Font family for the selection ('' = the document's default). */
  function setFont(name: string) {
    if (!name) return exec('fontName', 'inherit-mf', true), clearInline('fontFamily', 'inherit-mf');
    exec('fontName', name, true);
  }

  /** Font size in points for the selection. */
  function setSize(pt: number) {
    exec('fontSize', '7', true);
    // The browser marks size 7 as xxx-large (or a <font size>): make it the size asked for.
    for (const el of Array.from(page?.querySelectorAll<HTMLElement>('[style*="xxx-large"], font[size="7"]') ?? [])) {
      el.removeAttribute('size');
      el.style.fontSize = `${pt}pt`;
    }
    input();
    syncBlock();
  }

  /** Text colour (null: automatic). */
  function setColor(hex: string | null) {
    palette = null;
    if (hex) {
      lastColor = hex;
      exec('foreColor', `#${hex}`, true);
    } else {
      exec('foreColor', '#010203', true);
      clearInline('color', 'rgb(1, 2, 3)');
    }
  }

  /** Highlight (a Word highlight colour name; null: none). */
  function setHighlight(name: string | null) {
    palette = null;
    if (name) lastHighlight = name;
    exec('hiliteColor', name ? HIGHLIGHT[name] : 'transparent', true);
  }

  /** Remove an inline style the browser just set to a placeholder value. */
  function clearInline(prop: 'color' | 'fontFamily', placeholder: string) {
    for (const el of Array.from(page?.querySelectorAll<HTMLElement>('[style], font') ?? [])) {
      if (el.style[prop] === placeholder || el.style[prop] === `"${placeholder}"`) el.style[prop] = '';
      if (el.tagName === 'FONT' && (el.getAttribute('color') === '#010203' || el.getAttribute('face') === placeholder)) {
        el.removeAttribute(prop === 'color' ? 'color' : 'face');
      }
    }
    input();
  }

  /** Paragraph alignment for the selected paragraphs. */
  function align(how: 'left' | 'center' | 'right' | 'justify') {
    if (tab.readOnly) return;
    for (const b of selectedBlocks()) b.style.textAlign = how === 'left' ? '' : how;
    input();
    syncBlock();
  }

  /** Indent: list paragraphs change level, others move by half an inch. */
  function indent(delta: 1 | -1) {
    if (tab.readOnly) return;
    const paras = selectedBlocks();
    if (paras.some((p) => (model as DocModel | null)?.listKind?.(p))) return listLevel(delta);
    for (const b of paras) b.style.marginLeft = `${Math.max(0, (parseFloat(b.style.marginLeft) || 0) + delta * 48)}px`;
    input();
  }

  /** Line spacing (a multiple; '' = the style's). */
  function setSpacing(v: string) {
    if (tab.readOnly) return;
    for (const b of selectedBlocks()) b.style.lineHeight = v;
    input();
    syncBlock();
  }

  const ALIGNS = [
    { id: 'left', icon: AlignLeft, label: t('Align left ({shortcut})', { shortcut: formatShortcut('Mod+L') }) },
    { id: 'center', icon: AlignCenter, label: t('Centre ({shortcut})', { shortcut: formatShortcut('Mod+E') }) },
    { id: 'right', icon: AlignRight, label: t('Align right ({shortcut})', { shortcut: formatShortcut('Mod+R') }) },
    { id: 'justify', icon: AlignJustify, label: t('Justify ({shortcut})', { shortcut: formatShortcut('Mod+J') }) },
  ] as const;

  /** Dark paper in the dark theme (shared with drawings and diagrams). */
  const darkPage = $derived(theme.darkCanvas);

  function syncBlock() {
    const b = blockAt(window.getSelection()?.anchorNode ?? null);
    if (!b) return;
    const t = b.tagName.toLowerCase();
    blockStyle = t === 'div' ? 'p' : t === 'h1' && b.classList.contains('title') ? 'title' : t;
    listAt = model instanceof DocModel ? model.listKind(b) : null;
    alignAt = b.style.textAlign || 'left';
    spacingAt = b.style.lineHeight && !b.style.lineHeight.endsWith('pt') ? String(Number(b.style.lineHeight)) : '';
    // The run at the cursor: its own font and size (empty: the document's default).
    const sel = window.getSelection();
    let n: Node | null = sel?.anchorNode ?? null;
    if (n?.nodeType === 3) n = n.parentNode;
    let font = '';
    let size = '';
    let sup: 'sup' | 'sub' | '' = '';
    for (let e = n as HTMLElement | null; e && e !== b.parentElement; e = e.parentElement) {
      if (!font && e.style?.fontFamily && !e.style.fontFamily.startsWith('var(')) font = e.style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (!font && e.tagName === 'FONT' && e.getAttribute('face')) font = e.getAttribute('face')!;
      if (!size && e.style?.fontSize?.endsWith('pt')) size = String(parseFloat(e.style.fontSize));
      if (!sup && (e.tagName === 'SUP' || e.tagName === 'SUB')) sup = e.tagName === 'SUP' ? 'sup' : 'sub';
      if (e === b) break;
    }
    fontAt = font;
    sizeAt = size;
    supAt = sup;
  }

  const BLOCK = /^(P|H[1-6]|DIV)$/;

  /** The paragraph (or heading) a node is in. */
  function blockAt(n: Node | null): HTMLElement | null {
    while (n && n !== page) {
      if (n.nodeType === 1 && BLOCK.test((n as HTMLElement).tagName) && !(n as HTMLElement).dataset.opaque) return n as HTMLElement;
      n = n.parentNode;
    }
    return null;
  }

  /** The editable paragraphs the selection touches, in order. */
  function selectedBlocks(): HTMLElement[] {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !page) return [];
    const r = sel.getRangeAt(0);
    if (!page.contains(r.commonAncestorContainer)) return [];
    if (r.collapsed) {
      const b = blockAt(r.startContainer);
      return b ? [b] : [];
    }
    return Array.from(page.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, div')).filter(
      (b) => BLOCK.test(b.tagName) && !b.dataset.opaque && !b.querySelector('p, h1, h2, h3, h4, h5, h6, div') && r.intersectsNode(b),
    );
  }

  /** Bulleted / numbered list on or off for the selected paragraphs. */
  function toggleList(kind: ListKind) {
    if (tab.readOnly || !(model instanceof DocModel)) return;
    const paras = selectedBlocks();
    if (!paras.length) return;
    model.toggleList(paras, kind);
    input();
    syncBlock();
  }

  /** A list level deeper (+1) or shallower (-1). */
  function listLevel(delta: number) {
    if (tab.readOnly || !(model instanceof DocModel)) return;
    const paras = selectedBlocks().filter((p) => (model as DocModel).listKind(p));
    if (!paras.length) return;
    model.changeLevel(paras, delta);
    input();
    syncBlock();
  }

  /** Whether the caret sits at the very start of a paragraph. */
  function caretAtStart(b: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel?.isCollapsed || !sel.rangeCount) return false;
    const r = document.createRange();
    r.selectNodeContents(b);
    r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return r.toString().length === 0 && !r.cloneContents().querySelector('img, .atom');
  }

  /** Word's list keys: Tab / Shift+Tab change the level, Enter on an empty item and Backspace at the start end it. */
  function listKeys(e: KeyboardEvent): boolean {
    if (!(model instanceof DocModel) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const paras = selectedBlocks();
    const b = paras[0];
    const inList = !!b && !!model.listKind(b);
    if (e.key === 'Tab') {
      e.preventDefault();
      if (inList && (paras.length > 1 || caretAtStart(b))) listLevel(e.shiftKey ? -1 : 1);
      else if (!e.shiftKey) exec('insertText', '\t');
      return true;
    }
    if (!inList || paras.length !== 1) return false;
    if (e.key === 'Enter' && !e.shiftKey && !(b.textContent ?? '').trim() && !b.querySelector('img, .atom')) {
      e.preventDefault();
      listLevel(-1);
      return true;
    }
    if (e.key === 'Backspace' && caretAtStart(b)) {
      e.preventDefault();
      model.changeLevel([b], -(Number(b.dataset.ilvl ?? 0) + 1));
      input();
      syncBlock();
      return true;
    }
    return false;
  }

  async function save(): Promise<boolean> {
    if (!model || !page) return false;
    if (saveAs) {
      const ok = await ui.confirm(t('Save as .docx?'), t("Legacy .doc files can't be written. Your document will be saved as {name} next to the original, which stays unchanged.", { name: basename(saveAs) }), t('Save .docx'));
      if (!ok) return false;
      return writeTo(saveAs, true);
    }
    if (!tab.filePath || tab.readOnly) return doSaveAs();
    return writeTo(tab.filePath, false);
  }

  async function doSaveAs(): Promise<boolean> {
    if (odt) {
      // The other parts of the package come from the .odt it was opened from.
      const p = await api.SaveFileDialog(t('Save document as'), tab.filePath || tab.title, [{ name: t('OpenDocument text'), patterns: '*.odt' }]);
      if (!p) return false;
      return writeTo(/\.odt$/i.test(p) ? p : `${p}.odt`, true);
    }
    const p = await api.SaveFileDialog(t('Save document as'), saveAs || tab.filePath || tab.title, [{ name: t('Word document'), patterns: '*.docx' }]);
    if (!p) return false;
    return writeTo(/\.docx$/i.test(p) ? p : `${p}.docx`, true);
  }

  async function writeTo(path: string, retarget: boolean): Promise<boolean> {
    try {
      const xml = model!.serialize(page!);
      const parts = [];
      if (model instanceof DocModel && model.numbering.changed) {
        parts.push({ name: numberingPart.name, data: utf8Base64(model.numbering.serialize()), relId: numberingPart.related ? '' : 'rIdMfNumbering', relType: 'numbering' });
      }
      if (model instanceof DocModel && model.stylesChanged) {
        parts.push({ name: stylesPart.name, data: utf8Base64(model.serializeStyles()), relId: stylesPart.related ? '' : 'rIdMfStyles', relType: 'styles' });
      }
      await api.DocSave(path, sourcePath, xml, parts);
      tab.dirty = false;
      if (retarget && path !== tab.filePath) {
        tab.retarget(path);
        saveAs = '';
        note = '';
        sourcePath = path;
        template = false;
      } else if (!sourcePath) sourcePath = path;
      tab.size = (await api.Stat(path)).size;
      // Re-render from what was written so element references are fresh.
      const scroll = page!.parentElement!.scrollTop;
      await load();
      page!.parentElement!.scrollTop = scroll;
      return true;
    } catch (e) {
      toastError(e, t('Save failed'));
      return false;
    }
  }

  function keydown(e: KeyboardEvent) {
    if (!tab.readOnly && listKeys(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    // Lists: Ctrl+Shift+8 / 7 (bulleted / numbered), Ctrl+Shift+L (Word's List Bullet).
    if (e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7' || k === 'l')) {
      e.preventDefault();
      toggleList(e.code === 'Digit7' ? 'number' : 'bullet');
      return;
    }
    if (k === 'b' || k === 'i' || k === 'u') {
      e.preventDefault();
      exec(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      return;
    }
    if (odt) return;
    // Word's: Ctrl+E/L/R/J align, Ctrl+= subscript, Ctrl+Shift+= superscript, Ctrl+Space plain text.
    const alignKey = { e: 'center', l: 'left', r: 'right', j: 'justify' }[k] as 'center' | 'left' | 'right' | 'justify' | undefined;
    if (alignKey && !e.shiftKey) {
      e.preventDefault();
      align(alignKey);
    } else if (e.code === 'Equal') {
      e.preventDefault();
      exec(e.shiftKey ? 'superscript' : 'subscript');
    } else if (e.code === 'Space') {
      e.preventDefault();
      exec('removeFormat');
    }
  }

  function paste(e: ClipboardEvent) {
    // Paste as plain text: foreign HTML can't be mapped onto Word formatting.
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }

  officeControllers.set(tab.id, {
    bold: () => exec('bold'),
    italic: () => exec('italic'),
    underline: () => exec('underline'),
    style: (s) => setStyle(s),
  });

  function utf8Base64(s: string): string {
    const b = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  (tab as unknown as { docTest: unknown }).docTest = { page: () => page, model: () => model, save, writeTo, exec, toggleList, listLevel, listAt: () => listAt, setStyle, setFont, setSize, setColor, setHighlight, align, indent, setSpacing, darkPage: () => darkPage, headings: () => headings, active: () => active, counts: () => counts, selCounts: () => selCounts, goHeading, outlineOpen: () => outlineOpen, toggleOutline, desk: () => desk };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs: doSaveAs,
      reload: load,
      onShow: count,
      find: () => {
        void ui.prompt(t('Find in document'), '', t('Find')).then((q) => {
          if (q) (window as unknown as { find: (s: string) => boolean }).find(q);
        });
      },
    };
    void load();
    const sel = () => {
      const s = window.getSelection();
      if (s?.rangeCount && page?.contains(s.getRangeAt(0).commonAncestorContainer)) lastRange = s.getRangeAt(0).cloneRange();
      syncBlock();
      selectionCounts();
    };
    const closePalette = (e: MouseEvent) => {
      if (palette && !(e.target as HTMLElement).closest?.('.palette, .pal-btn')) palette = null;
    };
    window.addEventListener('mousedown', closePalette);
    document.addEventListener('selectionchange', sel);
    return () => {
      document.removeEventListener('selectionchange', sel);
      window.removeEventListener('mousedown', closePalette);
      officeControllers.delete(tab.id);
      cancelAnimationFrame(scrollFrame);
    };
  });
</script>

<div class="toolbar" use:fitBar>
  {#if !tab.readOnly}
    <select class="input sel" value={blockStyle} onchange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value)} aria-label={t('Paragraph style')}>
      <option value="p">{t('Normal text')}</option>
      {#if !odt}<option value="title">{t('Title')}</option>{/if}
      <option value="h1">{t('Heading 1')}</option>
      <option value="h2">{t('Heading 2')}</option>
      <option value="h3">{t('Heading 3')}</option>
      {#if !odt}
        <option value="h4">{t('Heading 4')}</option>
        <option value="h5">{t('Heading 5')}</option>
        <option value="h6">{t('Heading 6')}</option>
      {/if}
    </select>
    {#if !odt}
      <select class="input font" value={fontAt} onchange={(e) => setFont((e.currentTarget as HTMLSelectElement).value)} aria-label={t('Font')} title={t('Font')}>
        {#each fonts as f (f)}<option value={f} style:font-family={f ? `"${f}"` : undefined}>{f ? fontLabel(f) : t('Default font')}</option>{/each}
        {#if fontAt && !fonts.includes(fontAt)}<option value={fontAt}>{fontAt}</option>{/if}
      </select>
      <select class="input size" value={sizeAt} onchange={(e) => setSize(Number((e.currentTarget as HTMLSelectElement).value))} aria-label={t('Font size')} title={t('Font size')}>
        <option value="" disabled>{t('Size')}</option>
        {#each SIZES as z (z)}<option value={String(z)}>{z}</option>{/each}
        {#if sizeAt && !SIZES.includes(Number(sizeAt))}<option value={sizeAt}>{sizeAt}</option>{/if}
      </select>
    {/if}
    <span class="sep"></span>
    <button class="icon-btn" title={t('Bold ({shortcut})', { shortcut: formatShortcut('Mod+B') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('bold')}><Icon icon={Bold} /></button>
    <button class="icon-btn" title={t('Italic ({shortcut})', { shortcut: formatShortcut('Mod+I') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('italic')}><Icon icon={Italic} /></button>
    <button class="icon-btn" title={t('Underline ({shortcut})', { shortcut: formatShortcut('Mod+U') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('underline')}><Icon icon={Underline} /></button>
    <button class="icon-btn" title={t('Strikethrough')} onmousedown={(e) => e.preventDefault()} onclick={() => exec('strikeThrough')}><Icon icon={Strikethrough} /></button>
    {#if !odt}
      <button class="icon-btn" class:on={supAt === 'sup'} title={t('Superscript ({shortcut})', { shortcut: formatShortcut('Mod+Shift+=') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('superscript')}><Icon icon={SuperscriptIcon} /></button>
      <button class="icon-btn" class:on={supAt === 'sub'} title={t('Subscript ({shortcut})', { shortcut: formatShortcut('Mod+=') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('subscript')}><Icon icon={SubscriptIcon} /></button>
      <span class="split">
        <button class="icon-btn" title={t('Text colour')} onmousedown={(e) => e.preventDefault()} onclick={() => setColor(lastColor)}><Icon icon={Baseline} /><span class="bar" style:background={`#${lastColor}`}></span></button>
        <button class="icon-btn caret pal-btn" title={t('More text colours')} aria-label={t('More text colours')} onmousedown={(e) => e.preventDefault()} onclick={() => (palette = palette === 'color' ? null : 'color')}>▾</button>
        {#if palette === 'color'}
          <div class="palette" role="menu">
            <button class="auto" onmousedown={(e) => e.preventDefault()} onclick={() => setColor(null)}>{t('Automatic')}</button>
            <div class="swatches">
              {#each TEXT_COLORS as c (c)}<button class="sw" style:background={`#${c}`} title={`#${c}`} aria-label={t('Colour {value}', { value: `#${c}` })} onmousedown={(e) => e.preventDefault()} onclick={() => setColor(c)}></button>{/each}
            </div>
            <label class="more">{t('More…')} <input type="color" value={`#${lastColor}`} onchange={(e) => setColor((e.currentTarget as HTMLInputElement).value.slice(1).toUpperCase())} /></label>
          </div>
        {/if}
      </span>
      <span class="split">
        <button class="icon-btn" title={t('Highlight')} onmousedown={(e) => e.preventDefault()} onclick={() => setHighlight(lastHighlight)}><Icon icon={Highlighter} /><span class="bar" style:background={HIGHLIGHT[lastHighlight]}></span></button>
        <button class="icon-btn caret pal-btn" title={t('More highlight colours')} aria-label={t('More highlight colours')} onmousedown={(e) => e.preventDefault()} onclick={() => (palette = palette === 'highlight' ? null : 'highlight')}>▾</button>
        {#if palette === 'highlight'}
          <div class="palette" role="menu">
            <button class="auto" onmousedown={(e) => e.preventDefault()} onclick={() => setHighlight(null)}>{t('No highlight')}</button>
            <div class="swatches">
              {#each Object.entries(HIGHLIGHT) as [name, c] (name)}<button class="sw" style:background={c} title={name} aria-label={t('Colour {value}', { value: name })} onmousedown={(e) => e.preventDefault()} onclick={() => setHighlight(name)}></button>{/each}
            </div>
          </div>
        {/if}
      </span>
      <button class="icon-btn" title={t('Clear formatting ({shortcut})', { shortcut: formatShortcut('Mod+Space') })} onmousedown={(e) => e.preventDefault()} onclick={() => exec('removeFormat')}><Icon icon={RemoveFormatting} /></button>
      <span class="sep"></span>
      {#each ALIGNS as a (a.id)}
        <button class="icon-btn" class:on={alignAt === a.id} aria-pressed={alignAt === a.id} title={a.label} onmousedown={(e) => e.preventDefault()} onclick={() => align(a.id)}><Icon icon={a.icon} /></button>
      {/each}
      <select class="input spacing" value={spacingAt} onchange={(e) => setSpacing((e.currentTarget as HTMLSelectElement).value)} aria-label={t('Line spacing')} title={t('Line spacing')}>
        <option value="">{t('Line spacing')}</option>
        {#each ['1', '1.15', '1.5', '2', '2.5', '3'] as v (v)}<option value={v}>{v}</option>{/each}
      </select>
    {/if}
    <span class="sep"></span>
    {#if !odt}
      <button class="icon-btn" class:on={listAt === 'bullet'} aria-pressed={listAt === 'bullet'} title={t('Bulleted list ({shortcut})', { shortcut: formatShortcut('Mod+Shift+8') })} onmousedown={(e) => e.preventDefault()} onclick={() => toggleList('bullet')}><Icon icon={ListIcon} /></button>
      <button class="icon-btn" class:on={listAt === 'number'} aria-pressed={listAt === 'number'} title={t('Numbered list ({shortcut})', { shortcut: formatShortcut('Mod+Shift+7') })} onmousedown={(e) => e.preventDefault()} onclick={() => toggleList('number')}><Icon icon={ListOrdered} /></button>
      <button class="icon-btn" title={listAt ? t('Decrease list level (Shift+Tab)') : t('Decrease indent')} onmousedown={(e) => e.preventDefault()} onclick={() => indent(-1)}><Icon icon={IndentDecrease} /></button>
      <button class="icon-btn" title={listAt ? t('Increase list level (Tab)') : t('Increase indent')} onmousedown={(e) => e.preventDefault()} onclick={() => indent(1)}><Icon icon={IndentIncrease} /></button>
      <span class="sep"></span>
    {/if}
    <button class="icon-btn" title={t('Undo')} onmousedown={(e) => e.preventDefault()} onclick={() => exec('undo')}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title={t('Redo')} onmousedown={(e) => e.preventDefault()} onclick={() => exec('redo')}><Icon icon={Redo2} /></button>
  {/if}
  <span class="spacer"></span>
  {#if theme.resolved === 'dark'}
    <button class="icon-btn" title={darkPage ? t('Light page') : t('Dark page')} aria-label={darkPage ? t('Light page') : t('Dark page')} onclick={() => theme.setDarkCanvas(!darkPage)}><Icon icon={darkPage ? Sun : Moon} /></button>
  {/if}
  <button class="btn ghost" class:on={outlineOpen} aria-pressed={outlineOpen} title={t('Headings of the document — click one to go to it')} onclick={toggleOutline}><Icon icon={ListTree} size={14} /> {t('Outline')}</button>
</div>
{#if note}
  <div class="banner"><Icon icon={InfoIcon} /><span class="grow">{note}</span></div>
{/if}
<div class="body" bind:clientWidth={bodyW}>
<div class="desk" bind:this={desk} onscroll={scrolled}>
  {#if error}
    <div class="empty-state">{error}</div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="page selectable"
    class:hidden={!!error}
    class:odt
    class:dark={darkPage}
    bind:this={page}
    contenteditable={!tab.readOnly}
    spellcheck="true"
    role="textbox"
    aria-multiline="true"
    tabindex="0"
    oninput={input}
    onkeydown={keydown}
    onpaste={paste}
  ></div>
  {#if loading}<div class="empty-state overlay"><span class="spinner"></span></div>{/if}
</div>
{#if outlineOpen}
  <aside data-sidepanel class="outline" class:floating={narrow} class:right={narrow} aria-label={t('Outline')}>
    <div class="head">{t('Outline')}</div>
    <div class="tree"><OutlineTree items={headings} {active} onpick={goHeading} empty={t('No headings. Use Heading 1–3 in the paragraph style menu to build an outline.')} /></div>
  </aside>
{/if}
</div>

<style>
  .sel,
  .font,
  .size,
  .spacing,
  .split {
    flex: none;
  }
  .sel {
    height: 28px;
    padding: 0 6px;
    min-width: 140px;
  }
  .font {
    height: 28px;
    padding: 0 6px;
    width: 150px;
  }
  .size,
  .spacing {
    height: 28px;
    padding: 0 4px;
    width: 64px;
  }
  .spacing {
    width: 110px;
  }
  .split {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .split .icon-btn {
    position: relative;
  }
  .split .bar {
    position: absolute;
    left: 7px;
    right: 7px;
    bottom: 3px;
    height: 3px;
    border-radius: 1px;
  }
  .split .caret {
    width: 16px;
    font-size: 10px;
    color: var(--text-muted);
  }
  .palette {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 30;
    margin-top: 4px;
    padding: 8px;
    background: var(--bg-elevated, var(--bg));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 168px;
  }
  .palette .auto {
    text-align: left;
    padding: 3px 6px;
    border-radius: 4px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .palette .auto:hover {
    background: var(--bg-hover);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(7, 20px);
    gap: 4px;
  }
  .sw {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.25);
    cursor: pointer;
    padding: 0;
  }
  .palette .more {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
  }
  .palette .more input {
    width: 28px;
    height: 20px;
    padding: 0;
    border: none;
    background: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .outline {
    width: 240px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
  }
  .outline .head {
    padding: 8px 12px 6px;
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border-soft);
  }
  .outline .tree {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .desk {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--bg-sidebar);
    padding: 28px 16px 60px;
    position: relative;
  }
  .page {
    --doc-font: 'Carlito', 'Calibri', 'Inter Variable', system-ui, sans-serif;
    max-width: 816px;
    min-height: 1056px;
    margin: 0 auto;
    padding: 72px 84px;
    background: #fff;
    color: #1d1c1a;
    font-family: var(--doc-font);
    font-size: 11pt;
    line-height: 1.45;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    outline: none;
    caret-color: #c15f3c;
    cursor: text;
    /* Spaces and tabs as typed (Word keeps them). */
    white-space: pre-wrap;
    tab-size: 4;
  }
  .page.hidden {
    display: none;
  }
  /* Dark paper: the page inverted (lightness only, hues kept), pictures put back. */
  .page.dark {
    filter: invert(0.9) hue-rotate(180deg);
    box-shadow: 0 2px 12px rgba(255, 255, 255, 0.08);
  }
  .page.dark :global(img) {
    filter: invert(1) hue-rotate(180deg);
  }
  /* ODF keeps runs of spaces as elements; show them as typed. */
  .page.odt {
    white-space: pre-wrap;
    --doc-font: 'Liberation Serif', 'Times New Roman', 'Source Serif 4 Variable', serif;
  }
  /* Word lists: the marker Word would draw (data-marker), in the hanging indent. */
  .page:not(.odt) :global(.li)::before {
    content: attr(data-marker);
    left: 0;
    white-space: pre;
  }
  .page :global(.li.num)::before {
    content: attr(data-n);
    left: 0;
  }
  .page :global(.li.cont)::before {
    content: none;
  }
  .page :global(.atom.mark) {
    display: inline;
  }
  .page :global(.atom.chip.note) {
    vertical-align: super;
    font-size: 0.7em;
    padding: 0 2px;
  }
  .page :global(p) {
    margin: 0 0 8px;
  }
  .page :global(h1),
  .page :global(h2),
  .page :global(h3),
  .page :global(h4) {
    font-family: var(--doc-font);
    margin: 18px 0 8px;
    line-height: 1.25;
    color: #1d1c1a;
  }
  .page :global(h1) {
    font-size: 20pt;
  }
  .page :global(h1.title) {
    font-size: 26pt;
  }
  .page :global(h2) {
    font-size: 15pt;
  }
  .page :global(h3) {
    font-size: 12.5pt;
  }
  .page :global(.li) {
    position: relative;
    padding-left: 20px;
  }
  .page :global(.li)::before {
    content: '•';
    position: absolute;
    left: 4px;
  }
  .page :global(table) {
    border-collapse: collapse;
    margin: 8px 0 12px;
    width: 100%;
  }
  .page :global(td) {
    border: 1px solid #c9c4b8;
    padding: 4px 8px;
    vertical-align: top;
  }
  .page :global(td p) {
    margin: 0;
  }
  .page :global(a) {
    color: #2f6c8f;
    text-decoration: underline;
  }
  .page :global(.atom.tab) {
    white-space: pre;
    display: inline-block;
    min-width: 32px;
  }
  .page :global(.atom.chip) {
    font-size: 0.8em;
    color: #8a8478;
    background: #f1eee7;
    border-radius: 4px;
    padding: 0 4px;
  }
  .page :global(.atom img) {
    vertical-align: bottom;
  }
  .page :global(.locked),
  .page :global(.opaque) {
    background: #faf6ec;
    border-left: 3px solid #e2d6b8;
    padding-left: 6px;
    cursor: default;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
</style>
