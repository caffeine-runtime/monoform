<script lang="ts">
  import { fitBar } from '../../core/fit';
  // .docx and .odt editing on a page-like canvas; .doc is converted to .docx.
  import { onMount, tick } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Underline from '@lucide/svelte/icons/underline';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import InfoIcon from '@lucide/svelte/icons/info';
  import { api, endpoint } from '../../core/backend';
  import { basename } from '../../core/paths';
  import type { Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import { formatShortcut } from '../../core/keys';
  import { DocModel } from './docxModel';
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
  let words = $state(0);
  // The .docx whose other parts (styles, images, headers…) are copied on save.
  let sourcePath = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const path = tab.filePath ?? '';
      if (!path) throw new Error('Documents inside archives can be viewed after extracting them.');
      const r = await api.DocOpen(path);
      note = r.note;
      saveAs = r.saveAs;
      template = r.template;
      sourcePath = template ? '' : path;
      odt = r.format === 'odt';
      const partUrl = (entry: string) => endpoint('zip', { path, entry });
      model = odt ? new OdtModel(r.document, { styles: r.styles ?? {}, textStyles: r.textStyles ?? {}, partUrl }) : new DocModel(r.document, { styles: r.styles ?? {}, rels: r.rels ?? [], partUrl });
      await tick();
      page!.replaceChildren(model.render(document));
      tab.dirty = false;
      count();
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      loading = false;
    }
  }

  function count() {
    const text = page?.innerText ?? '';
    words = (text.match(/\S+/g) ?? []).length;
    tab.status = { ...tab.status, type: odt ? 'OpenDocument text' : template ? 'Word 97–2003 document' : 'Word document', info: `${words.toLocaleString()} words` };
  }

  let countTimer: ReturnType<typeof setTimeout> | undefined;
  function input() {
    tab.dirty = true;
    clearTimeout(countTimer);
    countTimer = setTimeout(count, 400);
  }

  function exec(cmd: string, value?: string) {
    if (tab.readOnly) return;
    page?.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(cmd, false, value);
    input();
    syncBlock();
  }

  function setStyle(tag: string) {
    exec('formatBlock', tag === 'p' ? '<p>' : `<${tag}>`);
  }

  function syncBlock() {
    const sel = window.getSelection();
    let n: Node | null = sel?.anchorNode ?? null;
    while (n && n !== page) {
      if (n.nodeType === 1 && /^(P|H[1-6]|DIV)$/.test((n as HTMLElement).tagName)) {
        const t = (n as HTMLElement).tagName.toLowerCase();
        blockStyle = t === 'div' ? 'p' : t;
        return;
      }
      n = n.parentNode;
    }
  }

  async function save(): Promise<boolean> {
    if (!model || !page) return false;
    if (saveAs) {
      const ok = await ui.confirm('Save as .docx?', `Legacy .doc files can't be written. Your document will be saved as ${basename(saveAs)} next to the original, which stays unchanged.`, 'Save .docx');
      if (!ok) return false;
      return writeTo(saveAs, true);
    }
    if (!tab.filePath || tab.readOnly) return doSaveAs();
    return writeTo(tab.filePath, false);
  }

  async function doSaveAs(): Promise<boolean> {
    if (odt) {
      // The other parts of the package come from the .odt it was opened from.
      const p = await api.SaveFileDialog('Save document as', tab.filePath || tab.title, [{ name: 'OpenDocument text', patterns: '*.odt' }]);
      if (!p) return false;
      return writeTo(/\.odt$/i.test(p) ? p : `${p}.odt`, true);
    }
    const p = await api.SaveFileDialog('Save document as', saveAs || tab.filePath || tab.title, [{ name: 'Word document', patterns: '*.docx' }]);
    if (!p) return false;
    return writeTo(/\.docx$/i.test(p) ? p : `${p}.docx`, true);
  }

  async function writeTo(path: string, retarget: boolean): Promise<boolean> {
    try {
      const xml = model!.serialize(page!);
      await api.DocSave(path, sourcePath, xml);
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
      toastError(e, 'Save failed');
      return false;
    }
  }

  function keydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b' || k === 'i' || k === 'u') {
      e.preventDefault();
      exec(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
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
  (tab as unknown as { docTest: unknown }).docTest = { page: () => page, model: () => model, save, writeTo, exec };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      save,
      saveAs: doSaveAs,
      reload: load,
      onShow: count,
      find: () => {
        void ui.prompt('Find in document', '', 'Find').then((q) => {
          if (q) (window as unknown as { find: (s: string) => boolean }).find(q);
        });
      },
    };
    void load();
    const sel = () => syncBlock();
    document.addEventListener('selectionchange', sel);
    return () => {
      document.removeEventListener('selectionchange', sel);
      officeControllers.delete(tab.id);
    };
  });
</script>

{#if !tab.readOnly}
  <div class="toolbar" use:fitBar>
    <select class="input sel" value={blockStyle} onchange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value)} aria-label="Paragraph style">
      <option value="p">Normal text</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </select>
    <span class="sep"></span>
    <button class="icon-btn" title="Bold ({formatShortcut('Mod+B')})" onmousedown={(e) => e.preventDefault()} onclick={() => exec('bold')}><Icon icon={Bold} /></button>
    <button class="icon-btn" title="Italic ({formatShortcut('Mod+I')})" onmousedown={(e) => e.preventDefault()} onclick={() => exec('italic')}><Icon icon={Italic} /></button>
    <button class="icon-btn" title="Underline ({formatShortcut('Mod+U')})" onmousedown={(e) => e.preventDefault()} onclick={() => exec('underline')}><Icon icon={Underline} /></button>
    <button class="icon-btn" title="Strikethrough" onmousedown={(e) => e.preventDefault()} onclick={() => exec('strikeThrough')}><Icon icon={Strikethrough} /></button>
    <span class="sep"></span>
    <button class="icon-btn" title="Undo" onmousedown={(e) => e.preventDefault()} onclick={() => exec('undo')}><Icon icon={Undo2} /></button>
    <button class="icon-btn" title="Redo" onmousedown={(e) => e.preventDefault()} onclick={() => exec('redo')}><Icon icon={Redo2} /></button>
    <span class="spacer"></span>
    <span class="label">{words.toLocaleString()} words</span>
  </div>
{/if}
{#if note}
  <div class="banner"><Icon icon={InfoIcon} /><span class="grow">{note}</span></div>
{/if}
<div class="desk">
  {#if error}
    <div class="empty-state">{error}</div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="page selectable"
    class:hidden={!!error}
    class:odt
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

<style>
  .sel {
    height: 28px;
    padding: 0 6px;
    min-width: 140px;
  }
  .desk {
    flex: 1;
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
  }
  .page.hidden {
    display: none;
  }
  /* ODF keeps runs of spaces as elements; show them as typed. */
  .page.odt {
    white-space: pre-wrap;
    --doc-font: 'Liberation Serif', 'Times New Roman', 'Source Serif 4 Variable', serif;
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
