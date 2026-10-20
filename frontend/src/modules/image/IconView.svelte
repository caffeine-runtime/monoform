<script lang="ts">
  // .ico / .cur / .icns: every size inside, shown on a checkerboard; export a
  // size as PNG, rebuild the icon from any image (all standard sizes), or
  // convert between ICO and ICNS.
  import { api, fileUrl } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';

  interface Entry {
    width: number;
    height: number;
    format: string;
    kind: string;
    path: string;
  }
  let { tab, entries, onreload }: { tab: Tab; entries: Entry[]; onreload: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let cur = $state(entries.length ? entries.reduce((b, e, i) => (e.width > entries[b].width ? i : b), 0) : 0);
  const e = $derived(entries[cur]);
  const isIcns = $derived(extname(tab.name) === 'icns');
  const FORMAT: Record<string, string> = { png: 'PNG', bmp: 'Bitmap', rle: 'Legacy RLE', argb: 'ARGB', jp2: 'JPEG 2000 (not shown)' };

  async function exportPng() {
    if (!e?.path) return;
    const def = join(dirname(tab.filePath ?? ''), `${stem(tab.title)}-${e.width}.png`);
    const p = await api.SaveFileDialog('Export size as PNG', def, [{ name: 'PNG', patterns: '*.png' }]);
    if (!p) return;
    try {
      const out = /\.png$/i.test(p) ? p : `${p}.png`;
      await api.CopyFile(e.path, out);
      ui.toast(`Exported ${e.width} × ${e.height}`, 'success', { label: 'Open', run: () => void workspace.openPath(out) });
    } catch (err) {
      toastError(err, 'Export failed');
    }
  }

  async function rebuild() {
    if (!tab.filePath || tab.readOnly) return;
    const src = await api.OpenFilesDialog('Image to make the icon from (square, 1024 px or more is best)', [{ name: 'Images', patterns: '*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp' }]);
    if (!src?.[0]) return;
    if (!(await ui.confirm('Replace every size?', `All sizes in ${tab.title} are rebuilt from the chosen image.`, 'Replace'))) return;
    try {
      await api.IconWrite(src[0], tab.filePath, isIcns ? 'icns' : 'ico', []);
      onreload();
    } catch (err) {
      toastError(err, 'Couldn’t write the icon');
    }
  }

  async function convert() {
    const biggest = entries.filter((x) => x.path).reduce<Entry | null>((b, x) => (!b || x.width > b.width ? x : b), null);
    if (!biggest) return;
    const to = isIcns ? 'ico' : 'icns';
    const def = join(dirname(tab.filePath ?? ''), `${stem(tab.title)}.${to}`);
    const p = await api.SaveFileDialog(`Save as .${to}`, def, [{ name: to.toUpperCase(), patterns: `*.${to}` }]);
    if (!p) return;
    const out = extname(p) === to ? p : `${p}.${to}`;
    try {
      await api.IconWrite(biggest.path, out, to, []);
      ui.toast(`Saved ${to.toUpperCase()}`, 'success', { label: 'Open', run: () => void workspace.openPath(out) });
    } catch (err) {
      toastError(err, 'Couldn’t write the icon');
    }
  }
</script>

<div class="icons">
  <div class="list" role="listbox" aria-label="Sizes">
    {#each entries as x, i (i)}
      <button class="size" class:on={i === cur} role="option" aria-selected={i === cur} onclick={() => (cur = i)}>
        {#if x.path}<img src={fileUrl(x.path)} alt="{x.width} px" style:width="{Math.min(64, x.width)}px" />{:else}<span class="na">?</span>{/if}
        <span>{x.width} × {x.height}{x.kind ? ` · ${x.kind}` : ''}</span>
        <span class="fmt">{FORMAT[x.format] ?? x.format}</span>
      </button>
    {/each}
  </div>
  <div class="main">
    {#if e?.path}
      <div class="view"><img class="checker" src={fileUrl(e.path)} alt="{e.width} px" style:width="{Math.max(e.width, Math.min(512, e.width * 4))}px" class:px={e.width < 128} /></div>
    {:else}
      <div class="empty-state">This size is stored as JPEG 2000, which can't be shown here.</div>
    {/if}
    <div class="actions">
      <span class="label">{entries.length} size{entries.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="btn ghost" disabled={!e?.path} onclick={exportPng}>Export this size as PNG…</button>
      <button class="btn ghost" onclick={convert}>Save as .{isIcns ? 'ico' : 'icns'}…</button>
      {#if !tab.readOnly && tab.filePath}<button class="btn" onclick={rebuild}>Rebuild from image…</button>{/if}
    </div>
  </div>
</div>

<style>
  .icons {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    width: calc(200px * var(--ui-scale));
    overflow-y: auto;
    border-right: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .size {
    display: grid;
    grid-template-columns: 64px 1fr;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 8px;
    text-align: left;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    padding: 4px;
    cursor: pointer;
  }
  .size img,
  .size .na {
    grid-row: span 2;
    justify-self: center;
  }
  .size.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .fmt {
    color: var(--text-muted);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--pasteboard);
  }
  .view img {
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
  }
  .px {
    image-rendering: pixelated;
  }
  .checker {
    background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 16px 16px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--border-soft);
  }
  .label {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .spacer {
    flex: 1;
  }
</style>
