<script lang="ts">
  // The text recognised in an image or PDF pages: languages to use (the
  // bundled English plus any added .traineddata files), progress, the text
  // (editable, to copy from) and a Copy button. Hosts can add actions.
  import { onMount, type Snippet } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { api } from '../../core/backend';
  import { settings } from '../../core/settings.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import type { app } from '../../wailsjs/go/models';

  let {
    title = 'Recognised text',
    run,
    onclose,
    actions,
  }: {
    title?: string;
    /** Recognise with these languages; report progress (0–1). Returns the text and its mean confidence. */
    run: (langs: string[], progress: (status: string, p: number) => void) => Promise<{ text: string; confidence: number }>;
    onclose: () => void;
    actions?: Snippet<[{ text: string; langs: string[] }]>;
  } = $props();

  let langs = $state<app.OcrLanguage[]>([]);
  let chosen = $state<string[]>(settings.value.ocrLangs?.length ? [...settings.value.ocrLangs] : ['eng']);
  let text = $state('');
  let confidence = $state(0);
  let status = $state('');
  let progress = $state(0);
  let busy = $state(false);
  let error = $state('');
  let showLangs = $state(false);

  async function loadLangs() {
    langs = await api.OcrLanguages();
    chosen = chosen.filter((c) => langs.some((l) => l.code === c));
    if (!chosen.length) chosen = ['eng'];
  }

  async function go() {
    busy = true;
    error = '';
    status = 'Starting…';
    progress = 0;
    try {
      const r = await run([...chosen], (s, p) => {
        status = s;
        progress = p;
      });
      text = r.text;
      confidence = r.confidence;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function toggle(code: string) {
    chosen = chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code];
    if (!chosen.length) chosen = ['eng'];
    settings.update((s) => (s.ocrLangs = [...chosen]));
  }

  async function addLanguage() {
    const files = await api.OpenFilesDialog('Add Tesseract language files', [{ name: 'Tesseract language data', patterns: '*.traineddata;*.traineddata.gz' }]);
    for (const p of files ?? []) {
      try {
        const code = await api.OcrAddLanguage(p);
        await loadLangs();
        if (!chosen.includes(code)) toggle(code);
        ui.toast(`Added ${langs.find((l) => l.code === code)?.name ?? code}`, 'success');
      } catch (e) {
        toastError(e);
      }
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    ui.toast('Copied', 'success');
  }

  (globalThis as unknown as { __ocrPanel?: unknown }).__ocrPanel = { text: () => text, busy: () => busy, status: () => `${status} ${Math.round(progress * 100)}%`, error: () => error, confidence: () => confidence, rerun: go };

  onMount(() => {
    void loadLangs().then(go);
  });
</script>

<aside class="ocr" aria-label={title}>
  <header>
    <h3>{title}</h3>
    <span class="spacer"></span>
    <button class="icon-btn" title="Close" onclick={onclose}><Icon icon={X} /></button>
  </header>
  <div class="langs">
    <button class="btn ghost small" onclick={() => (showLangs = !showLangs)}>Languages: {chosen.map((c) => langs.find((l) => l.code === c)?.name ?? c).join(', ')}</button>
    {#if showLangs}
      <div class="langlist">
        {#each langs as l (l.code)}
          <label><input type="checkbox" checked={chosen.includes(l.code)} onchange={() => toggle(l.code)} /> {l.name}{l.bundled ? '' : ' (added)'}</label>
        {/each}
        <button class="btn ghost small" onclick={addLanguage}>Add language file…</button>
        <p class="hint">Tesseract language files (<code>.traineddata</code>, e.g. from the tessdata_best or tessdata_fast collections) add more languages. Nothing is downloaded.</p>
      </div>
    {/if}
    <button class="btn small" disabled={busy} onclick={go}>{text ? 'Recognise again' : 'Recognise'}</button>
  </div>
  {#if busy}
    <div class="progress"><div class="bar" style="width:{Math.round(progress * 100)}%"></div></div>
    <p class="status">{status}</p>
  {/if}
  {#if error}<p class="bad">{error}</p>{/if}
  <textarea class="input text" bind:value={text} placeholder={busy ? '' : 'No text found.'} spellcheck="false" aria-label="Recognised text"></textarea>
  <footer>
    {#if text && !busy}<span class="label">Confidence {Math.round(confidence)}%</span>{/if}
    <span class="spacer"></span>
    {@render actions?.({ text, langs: chosen })}
    <button class="btn primary" disabled={!text || busy} onclick={copy}><Icon icon={CopyIcon} size={14} /> Copy text</button>
  </footer>
</aside>

<style>
  .ocr {
    width: 340px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-left: 1px solid var(--border);
    background: var(--bg);
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .langs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: flex-start;
  }
  .langlist {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
  .hint {
    color: var(--text-muted);
    margin: 4px 0 0;
  }
  .small {
    height: 24px;
    font-size: var(--fs-small);
  }
  .progress {
    height: 4px;
    background: var(--bg-hover);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .status {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .bad {
    color: var(--danger);
    margin: 0;
    font-size: var(--fs-small);
  }
  .text {
    flex: 1;
    min-height: 120px;
    resize: none;
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    white-space: pre-wrap;
  }
  footer {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
</style>
