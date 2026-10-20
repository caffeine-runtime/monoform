<script lang="ts">
  // The colour under the picker (HEX / RGB / HSL, click to copy, use it for
  // the brush) and the image's dominant colours (5, 8 or 12), copied as a
  // list or CSS variables, or saved as a GIMP/Inkscape palette.
  import { api, saveFile } from '../../core/backend';
  import { dirname, join, stem } from '../../core/paths';
  import { toastError, ui } from '../../core/ui.svelte';
  import type { ImageEditor } from './editor';
  import { extractPalette, formats, hex, toCss, toGpl, type PaletteColor } from './palette';

  let { editor, picked, title, onuse }: { editor: ImageEditor; picked: [number, number, number] | null; title: string; onuse: (hex: string) => void } = $props();

  let count = $state(8);
  let palette = $state<PaletteColor[]>([]);
  let busy = $state(false);

  /** Dominant colours from a small copy of the visible image. */
  async function analyse() {
    busy = true;
    await new Promise((r) => requestAnimationFrame(r));
    try {
      const src = editor.composite();
      const scale = Math.min(1, 160 / Math.max(src.width, src.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * scale));
      c.height = Math.max(1, Math.round(src.height * scale));
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, c.width, c.height);
      palette = extractPalette(g.getImageData(0, 0, c.width, c.height).data, count);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void count;
    void analyse();
  });

  async function copy(text: string, what = text) {
    await navigator.clipboard.writeText(text).catch(() => {});
    ui.toast(`Copied ${what}`, 'success');
  }

  async function savePalette() {
    const p = await api.SaveFileDialog('Save palette', join(dirname(title), `${stem(title)}.gpl`), [{ name: 'GIMP / Inkscape palette', patterns: '*.gpl' }]);
    if (!p) return;
    try {
      await saveFile(p.endsWith('.gpl') ? p : `${p}.gpl`, toGpl(stem(title), palette));
      ui.toast('Palette saved', 'success');
    } catch (e) {
      toastError(e);
    }
  }

  (globalThis as unknown as { __colours?: unknown }).__colours = { palette: () => palette, setCount: (n: number) => (count = n) };
</script>

<div class="colours">
  <section>
    <h4>Picked colour</h4>
    {#if picked}
      <div class="picked">
        <span class="big" style="background:{hex(picked)}"></span>
        <div class="fmts">
          {#each formats(picked) as f (f.label)}
            <button class="fmt" title="Copy" onclick={() => copy(f.value)}><span class="muted">{f.label}</span> {f.value}</button>
          {/each}
        </div>
      </div>
      <button class="btn ghost small" onclick={() => onuse(hex(picked!))}>Use for brush, shapes and text</button>
    {:else}
      <p class="muted">Choose the colour picker (I) and click the image.</p>
    {/if}
  </section>
  <section>
    <h4>
      Palette
      <select class="input small" bind:value={count} aria-label="Number of colours">
        <option value={5}>5</option><option value={8}>8</option><option value={12}>12</option>
      </select>
    </h4>
    {#if busy}<span class="spinner"></span>{/if}
    <div class="swatches">
      {#each palette as c, i (i)}
        <button class="sw" style="background:{hex(c.rgb)}" title="{hex(c.rgb)} · {Math.round(c.share * 100)}% — click to copy" aria-label={hex(c.rgb)} onclick={() => copy(hex(c.rgb))}><span>{hex(c.rgb)}</span></button>
      {/each}
    </div>
    <div class="row">
      <button class="btn ghost small" disabled={!palette.length} onclick={() => copy(palette.map((c) => hex(c.rgb)).join(', '), 'the colours')}>Copy list</button>
      <button class="btn ghost small" disabled={!palette.length} onclick={() => copy(toCss(palette), 'CSS variables')}>Copy CSS</button>
      <button class="btn ghost small" disabled={!palette.length} onclick={savePalette}>Save .gpl…</button>
    </div>
  </section>
</div>

<style>
  .colours {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 10px;
    overflow-y: auto;
  }
  h4 {
    margin: 0 0 6px;
    font-size: var(--fs-small);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .picked {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 6px;
  }
  .big {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    flex: none;
  }
  .fmts {
    display: flex;
    flex-direction: column;
  }
  .fmt {
    border: none;
    background: none;
    color: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    text-align: left;
    padding: 1px 0;
    cursor: copy;
  }
  .fmt:hover {
    color: var(--accent-text);
  }
  .muted {
    color: var(--text-muted);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .sw {
    height: 40px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    cursor: copy;
    display: flex;
    align-items: flex-end;
    padding: 2px 4px;
  }
  .sw span {
    font-size: 10px;
    font-family: var(--font-mono);
    background: rgba(255, 255, 255, 0.75);
    color: #111;
    border-radius: 3px;
    padding: 0 2px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .small {
    height: 24px;
    font-size: var(--fs-small);
  }
</style>
