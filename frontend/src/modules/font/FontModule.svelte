<script lang="ts">
  import { fitBar } from '../../core/fit';
  // Font files (TTF, OTF, TTC, WOFF, WOFF2): the font's names and licence,
  // your own sample text at a chosen size, a size waterfall, a paragraph, and
  // every character it covers grouped by Unicode block (click one to copy it).
  // Variable fonts get a slider per axis.
  import { onMount } from 'svelte';
  import type { Tab } from '../../core/tabs.svelte';
  import { ui } from '../../core/ui.svelte';
  import { blockOf, fontInfo, WEIGHTS, type FontInfo } from './fontinfo';

  let { tab }: { tab: Tab } = $props();

  // svelte-ignore state_referenced_locally
  const family = `hia-font-${tab.id}`;
  let face: FontFace | null = null;
  let info = $state<FontInfo | null>(null);
  let error = $state('');
  let loaded = $state(false);
  let sample = $state('The quick brown fox jumps over the lazy dog 0123456789');
  let size = $state(48);
  let axisValues = $state<Record<string, number>>({});
  let showAll = $state(false);
  let picked = $state<number | null>(null);
  const SIZES = [12, 14, 16, 20, 24, 32, 40, 48, 64, 72, 96];
  const PARA = 'Typography is the craft of endowing human language with a durable visual form. Grumpy wizards make a toxic brew for the jovial queen; Zażółć gęślą jaźń; Съешь же ещё этих мягких французских булок.';

  const variation = $derived(Object.entries(axisValues).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal');
  const groups = $derived.by(() => {
    if (!info) return [];
    const list = showAll ? info.chars : info.chars.slice(0, 1500);
    const out: { name: string; chars: number[] }[] = [];
    for (const c of list) {
      if (c < 0x20 || (c >= 0x7f && c < 0xa0)) continue;
      const b = blockOf(c);
      const last = out[out.length - 1];
      if (last?.name === b) last.chars.push(c);
      else out.push({ name: b, chars: [c] });
    }
    return out;
  });

  async function load() {
    error = '';
    try {
      const buf = await tab.read();
      try {
        info = await fontInfo(buf);
        axisValues = Object.fromEntries(info.axes.map((a) => [a.tag, a.def]));
      } catch (e) {
        info = null;
        error = e instanceof Error ? e.message : String(e);
      }
      if (face) document.fonts.delete(face);
      face = new FontFace(family, buf);
      await face.load();
      document.fonts.add(face);
      loaded = true;
      const name = info?.family ? `${info.family}${info.style ? ` ${info.style}` : ''}` : tab.title;
      tab.status = { ...tab.status, type: `${info?.format ?? 'Font'}`, position: info?.glyphs ? `${info.glyphs.toLocaleString()} glyphs` : undefined, info: name };
    } catch (e) {
      error = `This font can't be shown: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function copyChar(c: number) {
    picked = c;
    await navigator.clipboard.writeText(String.fromCodePoint(c)).catch(() => {});
    ui.toast(`Copied ${String.fromCodePoint(c)} (U+${c.toString(16).toUpperCase().padStart(4, '0')})`, 'success');
  }

  (tab as unknown as { fontTest: unknown }).fontTest = { info: () => info, loaded: () => loaded, family, error: () => error };

  onMount(() => {
    tab.handlers = { ...tab.handlers, reload: load };
    void load();
    return () => {
      if (face) document.fonts.delete(face);
    };
  });
</script>

<div class="toolbar" use:fitBar>
  <input class="input sample" bind:value={sample} placeholder="Type to preview" aria-label="Sample text" />
  <label class="opt">Size <input type="range" min="8" max="200" bind:value={size} /><span class="v">{size}px</span></label>
  {#each info?.axes ?? [] as a (a.tag)}
    <label class="opt" title="{a.name} ({a.min}–{a.max})">{a.name} <input type="range" min={a.min} max={a.max} step={a.max - a.min > 20 ? 1 : 0.1} bind:value={axisValues[a.tag]} /><span class="v">{Math.round(axisValues[a.tag] * 10) / 10}</span></label>
  {/each}
</div>

<div class="body" style:--ff="'{family}', system-ui" style:--fv={variation}>
  {#if error && !loaded}
    <div class="empty-state">{error}</div>
  {:else}
    <header>
      <h1 class="f">{info?.family || tab.title}</h1>
      <div class="meta">
        {#if info}
          <span>{info.style || (WEIGHTS[info.weight] ?? info.weight)}{info.italic ? ' italic' : ''}</span>
          <span>{info.format}{info.fonts > 1 ? ` (${info.fonts} fonts; showing the first)` : ''}</span>
          {#if info.version}<span>{info.version}</span>{/if}
          {#if info.glyphs}<span>{info.glyphs.toLocaleString()} glyphs · {info.chars.length.toLocaleString()} characters</span>{/if}
          {#if info.axes.length}<span>Variable: {info.axes.map((a) => a.tag).join(', ')}</span>{/if}
        {:else}
          <span>{error || 'WOFF2 (names not read)'}</span>
        {/if}
      </div>
      {#if info?.copyright || info?.license || info?.designer}
        <dl>
          {#if info.designer}<dt>Designer</dt><dd>{info.designer}</dd>{/if}
          {#if info.copyright}<dt>Copyright</dt><dd>{info.copyright}</dd>{/if}
          {#if info.license}<dt>Licence</dt><dd class="lic">{info.license}</dd>{/if}
        </dl>
      {/if}
    </header>

    <section>
      <p class="f big" style:font-size="{size}px">{sample}</p>
    </section>

    <section>
      <h2>Sizes</h2>
      {#each SIZES as s (s)}
        <div class="row"><span class="px">{s}</span><span class="f line" style:font-size="{s}px">{sample}</span></div>
      {/each}
    </section>

    <section>
      <h2>Paragraph</h2>
      <p class="f para">{PARA}</p>
      <p class="f para upper">{PARA.toUpperCase()}</p>
    </section>

    {#if info?.chars.length}
      <section>
        <h2>Characters</h2>
        {#each groups as g (g.name + g.chars[0])}
          <h3>{g.name}</h3>
          <div class="grid">
            {#each g.chars as c (c)}
              <button class="ch" class:on={picked === c} title="U+{c.toString(16).toUpperCase().padStart(4, '0')} — click to copy" onclick={() => copyChar(c)}><span class="f">{String.fromCodePoint(c)}</span></button>
            {/each}
          </div>
        {/each}
        {#if !showAll && info.chars.length > 1500}<button class="btn" onclick={() => (showAll = true)}>Show all {info.chars.length.toLocaleString()} characters</button>{/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .sample {
    flex: 1;
    min-width: 160px;
    max-width: 520px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    margin-left: 10px;
    white-space: nowrap;
  }
  .v {
    min-width: 4ch;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 20px 28px 40px;
  }
  .f {
    font-family: var(--ff);
    font-variation-settings: var(--fv);
  }
  h1.f {
    font-size: 44px;
    margin: 0 0 6px;
    font-weight: normal;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    font-size: var(--fs-small);
    margin: 10px 0 0;
    max-width: 900px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  .lic {
    white-space: pre-wrap;
    max-height: 6em;
    overflow: auto;
  }
  section {
    margin-top: 26px;
  }
  h2 {
    font-size: var(--fs-ui);
    color: var(--text-muted);
    font-weight: 600;
    margin: 0 0 8px;
    border-bottom: 1px solid var(--border-soft);
    padding-bottom: 4px;
  }
  h3 {
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-weight: 500;
    margin: 14px 0 6px;
  }
  .big {
    margin: 0;
    line-height: 1.25;
    word-break: break-word;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .px {
    width: 3ch;
    flex: none;
    color: var(--text-faint);
    font-size: 11px;
    text-align: right;
  }
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .para {
    font-size: 17px;
    line-height: 1.55;
    max-width: 70ch;
    margin: 0 0 10px;
  }
  .upper {
    letter-spacing: 0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 4px;
  }
  .ch {
    height: 48px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ch:hover,
  .ch.on {
    border-color: var(--accent);
  }
</style>
