<script lang="ts">
  // Fallback for files no module understands: a hex preview and a way out.
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { commands } from '../../core/commands';
  import { formatBytes } from '../../core/paths';

  let { tab }: { tab: Tab } = $props();
  let rows = $state<string[]>([]);
  let error = $state('');

  $effect(() => {
    tab.status = { type: 'Binary' };
    fetch(tab.url(), { headers: { Range: 'bytes=0-4095' } })
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const b = new Uint8Array(buf.slice(0, 4096));
        const out: string[] = [];
        for (let off = 0; off < b.length; off += 16) {
          const chunk = b.subarray(off, off + 16);
          const hex = Array.from(chunk, (x) => x.toString(16).padStart(2, '0')).join(' ');
          const ascii = Array.from(chunk, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '·')).join('');
          out.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
        }
        rows = out;
      })
      .catch((e) => (error = String(e)));
  });

  function openAsText() {
    tab.moduleId = 'text';
    workspace.touch();
  }
</script>

<div class="toolbar">
  <span class="label">Binary file{tab.size != null ? ` · ${formatBytes(tab.size)}` : ''} — showing the first 4 KB</span>
  <span class="spacer"></span>
  <button class="btn ghost" onclick={openAsText}>Open as text</button>
  {#if tab.filePath}<button class="btn ghost" onclick={() => commands.execute('tools.hash', tab.filePath)}>Compute hash</button>{/if}
</div>
<div class="hex selectable mono">
  {#if error}<p>{error}</p>{/if}
  {#each rows as r}<div>{r}</div>{/each}
</div>

<style>
  .hex {
    flex: 1;
    overflow: auto;
    padding: 14px 18px;
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre;
    color: var(--text-muted);
  }
</style>
