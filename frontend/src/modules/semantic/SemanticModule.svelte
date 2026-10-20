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

  let { tab }: { tab: Tab } = $props();

  // Opened from "Turn search by meaning on/off": show the terms right away.
  let consenting = $state(!!(tab.restoredState as { consent?: boolean } | undefined)?.consent);
  let agreed = $state(false);
  let busy = $state(false);

  const info = $derived(semantic.info);
  const on = $derived(semantic.enabled);
  const folder = $derived(workspace.folder);
  const UNLOAD = [
    { s: 30, label: '30 seconds' },
    { s: 60, label: '1 minute' },
    { s: 300, label: '5 minutes' },
    { s: 900, label: '15 minutes' },
  ];

  async function turnOn() {
    if (!info?.installed && !consenting) {
      consenting = true;
      return;
    }
    busy = true;
    try {
      if (await semantic.enable()) {
        consenting = false;
        ui.toast('Search by meaning is on', 'success');
      }
    } finally {
      busy = false;
    }
  }

  async function removeModel() {
    const ok = await ui.confirm('Remove the search model?', 'The downloaded model and all search indexes are deleted. Search by meaning is turned off.', 'Remove', true);
    if (ok) await semantic.removeModel();
  }

  function setUnload(e: Event) {
    const v = Number((e.target as HTMLSelectElement).value);
    settings.update((s) => (s.semantic = { ...s.semantic, unloadAfter: v }));
  }

  (tab as unknown as { semanticTest: unknown }).semanticTest = { turnOn, agree: () => (agreed = true), consenting: () => consenting };

  onMount(() => {
    tab.status = { ...tab.status, type: 'Search by meaning' };
    tab.handlers = { ...tab.handlers, getState: () => ({}) };
    void semantic.refresh();
  });
</script>

<div class="wrap">
  <div class="card">
    <div class="head">
      <div>
        <h2>Search by meaning</h2>
        <p class="muted">
          Finds passages in your open folder that are about what you type, even when they use other words. Results appear in the search box (Ctrl/Cmd+K) under
          “By meaning”. Off by default.
        </p>
      </div>
      {#if on}
        <button class="btn" disabled={busy} onclick={() => semantic.disable()}>Turn off</button>
      {:else}
        <button class="btn primary" disabled={busy || consenting} onclick={turnOn}>Turn on…</button>
      {/if}
    </div>

    {#if consenting && !on}
      <div class="consent">
        <p><strong>Before turning this on</strong></p>
        <ul>
          <li>
            The model, <strong>EmbeddingGemma 2</strong> by Google (text encoder, 4-bit), is downloaded once from
            <span class="mono">huggingface.co/{info?.repo}</span> — {formatBytes(info?.modelBytes ?? 0)}. This is the only time the app connects to the internet.
          </li>
          <li>The model's license is <strong>{info?.license}</strong>. The download is checked against fixed SHA-256 sums.</li>
          <li>Everything else happens on this computer: your files are never uploaded.</li>
          <li>While indexing or searching, the model uses roughly <strong>1 GB of memory</strong>. It is unloaded after it has been idle for a while (setting below).</li>
          <li>Indexing runs in the background and is slow — several seconds per page of text, depending on the computer. Every file gets one passage first, so search covers the whole folder early.</li>
        </ul>
        <label class="agree"><input type="checkbox" bind:checked={agreed} /> I understand; download the model and turn search by meaning on.</label>
        <div class="row">
          <button class="btn primary" disabled={!agreed || busy} onclick={turnOn}>{busy ? 'Downloading…' : 'Download and turn on'}</button>
          <button class="btn ghost" disabled={busy} onclick={() => (consenting = false)}>Cancel</button>
        </div>
      </div>
    {/if}
    {#if semantic.error}<p class="err">{semantic.error}</p>{/if}
  </div>

  {#if on}
    <div class="card">
      <div class="grid">
        <span class="muted">Model</span>
        <span>
          {#if semantic.model === 'ready'}Loaded{:else if semantic.model === 'loading'}Loading… {Math.round(semantic.loadProgress * 100)}%{:else}Not loaded (loads on first use){/if}
          {#if semantic.tokensPerSec}<span class="muted"> · {semantic.tokensPerSec} tokens/s</span>{/if}
        </span>
        <span class="muted">Folder</span>
        <span class="selectable">{folder ? tildify(folder, boot.home) : 'No folder open'}</span>
        <span class="muted">Index</span>
        <span>
          {#if semantic.index}{semantic.index.files} of {semantic.index.total} text files · {semantic.index.passages} passages{:else}—{/if}
          {#if semantic.indexing}<span class="muted"> · indexing {semantic.indexing.done}/{semantic.indexing.total}</span>{/if}
        </span>
        <span class="muted">Unload model after</span>
        <span>
          <select value={settings.value.semantic?.unloadAfter ?? 60} onchange={setUnload}>
            {#each UNLOAD as u (u.s)}<option value={u.s}>{u.label} idle</option>{/each}
          </select>
        </span>
      </div>
      <div class="row">
        <button class="btn" disabled={!folder || !!semantic.indexing} onclick={() => folder && semantic.indexFolder(folder)}>Update index</button>
        <button class="btn ghost" onclick={() => semantic.rebuild()}>Rebuild</button>
        <button class="btn ghost" onclick={() => semantic.unload()} disabled={semantic.model === 'unloaded'}>Unload model now</button>
        <span class="grow"></span>
        <button class="btn ghost danger" onclick={removeModel}>Remove model…</button>
      </div>
      <p class="muted small">Indexed: text, Markdown and code files up to 1 MB (up to 8 passages each — first one passage of every file, then the rest). Lock files, minified files and hidden folders are skipped.</p>
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
