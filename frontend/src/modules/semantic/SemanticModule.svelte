<script lang="ts">
  // Settings and status for the optional search by meaning. Turning it on
  // needs explicit consent: a one-time model download and its memory use are
  // spelled out before anything happens.
  import { onMount } from 'svelte';
  import { semantic } from '../../core/semantic/semantic.svelte';
  import { settings } from '../../core/settings.svelte';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { formatBytes, tildify } from '../../core/paths';
  import { boot } from '../../core/boot';
  import { ui } from '../../core/ui.svelte';
  import { t } from '../../core/i18n';

  let { tab }: { tab: Tab } = $props();

  // Opened from "Turn search by meaning on/off": show the terms right away.
  let consenting = $state(!!(tab.restoredState as { consent?: boolean } | undefined)?.consent);
  let agreed = $state(false);
  let busy = $state(false);

  const info = $derived(semantic.info);
  const on = $derived(semantic.enabled);
  const folder = $derived(workspace.folder);
  const UNLOAD = [
    { s: 30, label: t('30 seconds idle') },
    { s: 60, label: t('1 minute idle') },
    { s: 300, label: t('5 minutes idle') },
    { s: 900, label: t('15 minutes idle') },
  ];
  /** A translated sentence split around its {placeholders}, so they can be shown with markup. */
  const pieces = (s: string) => s.split(/(\{\w+\})/).filter(Boolean);

  async function turnOn() {
    if (!info?.installed && !consenting) {
      consenting = true;
      return;
    }
    busy = true;
    try {
      if (await semantic.enable()) {
        consenting = false;
        ui.toast(t('Search by meaning is on'), 'success');
      }
    } finally {
      busy = false;
    }
  }

  async function removeModel() {
    const ok = await ui.confirm(t('Remove the search model?'), t('The downloaded model and all search indexes are deleted. Search by meaning is turned off.'), t('Remove'), true);
    if (ok) await semantic.removeModel();
  }

  function setUnload(e: Event) {
    const v = Number((e.target as HTMLSelectElement).value);
    settings.update((s) => (s.semantic = { ...s.semantic, unloadAfter: v }));
  }

  (tab as unknown as { semanticTest: unknown }).semanticTest = { turnOn, agree: () => (agreed = true), consenting: () => consenting };

  onMount(() => {
    tab.status = { ...tab.status, type: t('Search by meaning') };
    tab.handlers = { ...tab.handlers, getState: () => ({}) };
    void semantic.refresh();
  });
</script>

<div class="wrap">
  <div class="card">
    <div class="head">
      <div>
        <h2>{t('Search by meaning')}</h2>
        <p class="muted">
          {t('Finds passages in your open folder that are about what you type, even when they use other words. Results appear in the search box (Ctrl/Cmd+K) under “By meaning”. Off by default.')}
        </p>
      </div>
      {#if on}
        <button class="btn" disabled={busy} onclick={() => semantic.disable()}>{t('Turn off')}</button>
      {:else}
        <button class="btn primary" disabled={busy || consenting} onclick={turnOn}>{t('Turn on…')}</button>
      {/if}
    </div>

    {#if consenting && !on}
      <div class="consent">
        <p><strong>{t('Before turning this on')}</strong></p>
        <ul>
          <li>
            {#each pieces(t('The model, {model} by Google (text encoder, 4-bit), is downloaded once from {source} — {size}. This is the only time the app connects to the internet.', { size: formatBytes(info?.modelBytes ?? 0) })) as p}{#if p === '{model}'}<strong>EmbeddingGemma 2</strong>{:else if p === '{source}'}<span class="mono">huggingface.co/{info?.repo}</span>{:else}{p}{/if}{/each} <!-- i18n-ignore -->
          </li>
          <li>{#each pieces(t("The model's license is {license}. The download is checked against fixed SHA-256 sums.")) as p}{#if p === '{license}'}<strong>{info?.license}</strong>{:else}{p}{/if}{/each}</li>
          <li>{t('Everything else happens on this computer: your files are never uploaded.')}</li>
          <li>{#each pieces(t('While indexing or searching, the model uses roughly {memory}. It is unloaded after it has been idle for a while (setting below).')) as p}{#if p === '{memory}'}<strong>{t('1 GB of memory')}</strong>{:else}{p}{/if}{/each}</li>
          <li>{t('Indexing runs in the background and is slow — several seconds per page of text, depending on the computer. Every file gets one passage first, so search covers the whole folder early.')}</li>
        </ul>
        <label class="agree"><input type="checkbox" bind:checked={agreed} /> {t('I understand; download the model and turn search by meaning on.')}</label>
        <div class="row">
          <button class="btn primary" disabled={!agreed || busy} onclick={turnOn}>{busy ? t('Downloading…') : t('Download and turn on')}</button>
          <button class="btn ghost" disabled={busy} onclick={() => (consenting = false)}>{t('Cancel')}</button>
        </div>
      </div>
    {/if}
    {#if semantic.error}<p class="err">{semantic.error}</p>{/if}
  </div>

  {#if on}
    <div class="card">
      <div class="grid">
        <span class="muted">{t('Model')}</span>
        <span>
          {#if semantic.model === 'ready'}{t('Loaded')}{:else if semantic.model === 'loading'}{t('Loading… {percent}%', { percent: Math.round(semantic.loadProgress * 100) })}{:else}{t('Not loaded (loads on first use)')}{/if}
          {#if semantic.tokensPerSec}<span class="muted"> · {t('{n} tokens/s', { n: semantic.tokensPerSec })}</span>{/if}
        </span>
        <span class="muted">{t('Folder')}</span>
        <span class="selectable">{folder ? tildify(folder, boot.home) : t('No folder open')}</span>
        <span class="muted">{t('Index')}</span>
        <span>
          {#if semantic.index}{t('{files} of {total} text files · {passages} passages', { files: semantic.index.files, total: semantic.index.total, passages: semantic.index.passages })}{:else}—{/if}
          {#if semantic.indexing}<span class="muted"> · {t('indexing {done}/{total}', { done: semantic.indexing.done, total: semantic.indexing.total })}</span>{/if}
        </span>
        <span class="muted">{t('Unload model after')}</span>
        <span>
          <select value={settings.value.semantic?.unloadAfter ?? 60} onchange={setUnload}>
            {#each UNLOAD as u (u.s)}<option value={u.s}>{u.label}</option>{/each}
          </select>
        </span>
      </div>
      <div class="row">
        <button class="btn" disabled={!folder || !!semantic.indexing} onclick={() => folder && semantic.indexFolder(folder)}>{t('Update index')}</button>
        <button class="btn ghost" onclick={() => semantic.rebuild()}>{t('Rebuild')}</button>
        <button class="btn ghost" onclick={() => semantic.unload()} disabled={semantic.model === 'unloaded'}>{t('Unload model now')}</button>
        <span class="grow"></span>
        <button class="btn ghost danger" onclick={removeModel}>{t('Remove model…')}</button>
      </div>
      <p class="muted small">{t('Indexed: text, Markdown and code files up to 1 MB (up to 8 passages each — first one passage of every file, then the rest). Lock files, minified files and hidden folders are skipped.')}</p>
    </div>
  {/if}
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    padding: 28px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  :global([data-theme='dark']) .card {
    background: var(--bg-sidebar);
  }
  .head {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
  }
  h2 {
    margin: 0 0 6px;
    font-size: calc(17px * var(--ui-scale));
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: var(--fs-small);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }
  .consent {
    border-top: 1px solid var(--border-soft);
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .consent ul {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .agree {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 18px;
    align-items: center;
  }
  .err {
    color: var(--danger);
  }
</style>
