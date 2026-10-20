<script lang="ts">
  // Create or pick a signature, like Preview's: draw it with the mouse,
  // trackpad or pen; type it; or take a photo/scan of it (the paper turns
  // transparent). Saved signatures are kept in the settings for next time.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, fileUrl } from '../../core/backend';
  import { settings } from '../../core/settings.svelte';
  import { toastError } from '../../core/ui.svelte';
  import { inkBox, paperToAlpha } from './marks';

  let { onpick, oncancel }: { onpick: (dataUrl: string, aspect: number) => void; oncancel: () => void } = $props();

  type Mode = 'draw' | 'type' | 'image';
  let mode = $state<Mode>('draw');
  let pad = $state<HTMLCanvasElement>();
  let typed = $state('');
  let font = $state(0);
  let color = $state('#1a1a1a');
  let keep = $state(true);
  let imported = $state<HTMLCanvasElement | null>(null);
  let empty = $state(true);
  let stroke: { x: number; y: number }[] | null = null;
  const saved = $derived(settings.value.signatures ?? []);
  const FONTS = [
    '"Segoe Script", "Brush Script MT", "URW Chancery L", "Z003", cursive',
    '"Lucida Handwriting", "Apple Chancery", "TeX Gyre Chorus", cursive',
    'Georgia, "Times New Roman", serif',
  ];
  const W = 560;
  const H = 180;

  function clearPad() {
    const ctx = pad?.getContext('2d');
    if (!ctx || !pad) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    empty = true;
  }

  function point(e: PointerEvent) {
    const r = pad!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pad!.width, y: ((e.clientY - r.top) / r.height) * pad!.height };
  }

  function down(e: PointerEvent) {
    try {
      pad!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    stroke = [point(e)];
  }

  function move(e: PointerEvent) {
    if (!stroke || !pad) return;
    const p = point(e);
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
    stroke.push(p);
    const ctx = pad.getContext('2d')!;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Width follows pen pressure when there is one, else a little with speed.
    const pr = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5;
    ctx.lineWidth = (pad.width / W) * (1.6 + pr * 3);
    const n = stroke.length;
    ctx.beginPath();
    if (n < 3) {
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
    } else {
      // Smooth: quadratic through midpoints.
      const a = stroke[n - 3];
      const b = stroke[n - 2];
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2);
    }
    ctx.stroke();
    empty = false;
  }

  function up() {
    if (stroke?.length === 1 && pad) {
      const ctx = pad.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, 2.5 * (pad.width / W), 0, 2 * Math.PI);
      ctx.fill();
      empty = false;
    }
    stroke = null;
  }

  async function chooseImage() {
    const files = await api.OpenFilesDialog('Signature image', [{ name: 'Images', patterns: '*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif' }]);
    if (!files?.length) return;
    try {
      const img = new Image();
      img.src = fileUrl(files[0]);
      await img.decode();
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      paperToAlpha(d.data);
      ctx.putImageData(d, 0, 0);
      imported = c;
    } catch (e) {
      toastError(e, 'Couldn’t read that image');
    }
  }

  /** Render the current input to a canvas (high resolution, transparent). */
  function source(): HTMLCanvasElement | null {
    if (mode === 'draw') return empty ? null : pad!;
    if (mode === 'image') return imported;
    if (!typed.trim()) return null;
    const c = document.createElement('canvas');
    c.width = 1400;
    c.height = 360;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = `200px ${FONTS[font]}`;
    ctx.textBaseline = 'middle';
    let size = 200;
    while (ctx.measureText(typed).width > c.width - 40 && size > 40) ctx.font = `${(size -= 10)}px ${FONTS[font]}`;
    ctx.fillText(typed, 20, c.height / 2);
    return c;
  }

  /** Crop to the ink (with a little margin) → PNG data URL. */
  function trimmed(c: HTMLCanvasElement): { url: string; aspect: number } | null {
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const b = inkBox(d.data, c.width, c.height);
    if (!b) return null;
    const m = Math.round(Math.max(b.w, b.h) * 0.04);
    const out = document.createElement('canvas');
    out.width = b.w + 2 * m;
    out.height = b.h + 2 * m;
    out.getContext('2d')!.drawImage(c, b.x - m, b.y - m, out.width, out.height, 0, 0, out.width, out.height);
    return { url: out.toDataURL('image/png'), aspect: out.width / out.height };
  }

  function use() {
    const c = source();
    const t = c && trimmed(c);
    if (!t) return;
    if (keep) settings.update((s) => (s.signatures = [t.url, ...(s.signatures ?? []).filter((x) => x !== t.url)].slice(0, 12)));
    onpick(t.url, t.aspect);
  }

  async function pickSaved(url: string) {
    const img = new Image();
    img.src = url;
    await img.decode();
    onpick(url, img.naturalWidth / img.naturalHeight);
  }

  function forget(url: string) {
    settings.update((s) => (s.signatures = (s.signatures ?? []).filter((x) => x !== url)));
  }

  onMount(() => {
    if (pad) {
      const dpr = window.devicePixelRatio || 1;
      pad.width = W * 2 * dpr;
      pad.height = H * 2 * dpr;
    }
  });

  (globalThis as unknown as { __sigPad?: unknown }).__sigPad = {
    drawLine: (pts: [number, number][]) => {
      const r = pad!.getBoundingClientRect();
      const ev = (type: string, [x, y]: [number, number]) => new PointerEvent(type, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, pointerId: 3, bubbles: true });
      pad!.dispatchEvent(ev('pointerdown', pts[0]));
      for (const p of pts.slice(1)) pad!.dispatchEvent(ev('pointermove', p));
      pad!.dispatchEvent(ev('pointerup', pts[pts.length - 1]));
    },
    setMode: (m: Mode) => (mode = m),
    type: (t: string) => (typed = t),
    use,
    setKeep: (k: boolean) => (keep = k),
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={oncancel}>
  <div class="dialog" role="dialog" aria-label="Signature" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && oncancel()}>
    <div class="head">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'draw'} class:on={mode === 'draw'} onclick={() => (mode = 'draw')}>Draw</button>
        <button role="tab" aria-selected={mode === 'type'} class:on={mode === 'type'} onclick={() => (mode = 'type')}>Type</button>
        <button role="tab" aria-selected={mode === 'image'} class:on={mode === 'image'} onclick={() => (mode = 'image')}>Image</button>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" title="Close (Esc)" onclick={oncancel}><Icon icon={XIcon} /></button>
    </div>

    <div class="stage" class:hidden={mode !== 'draw'}>
      <canvas bind:this={pad} class="pad" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
      <div class="line"></div>
      <span class="hint">{empty ? 'Sign here with the mouse, trackpad or a pen' : ''}</span>
    </div>
    {#if mode === 'type'}
      <div class="stage typed">
        <input class="input" placeholder="Your name" bind:value={typed} />
        <div class="preview" style:font-family={FONTS[font]} style:color>{typed || 'Your name'}</div>
        <div class="fonts">
          {#each FONTS as f, i (i)}<button class="btn ghost" class:on={font === i} style:font-family={f} onclick={() => (font = i)}>Signature</button>{/each}
        </div>
      </div>
    {:else if mode === 'image'}
      <div class="stage typed">
        <button class="btn" onclick={chooseImage}>Choose a photo or scan…</button>
        <p class="muted">Sign on white paper; the paper becomes transparent.</p>
        {#if imported}<img class="imported" src={imported.toDataURL()} alt="Imported signature" />{/if}
      </div>
    {/if}

    <div class="row">
      {#if mode !== 'image'}
        <span class="label">Ink</span>
        {#each ['#1a1a1a', '#1f3fa8', '#0b6b3a'] as c (c)}
          <button class="swatch" class:on={color === c} style:background={c} aria-label="Ink {c}" onclick={() => (color = c)}></button>
        {/each}
      {/if}
      {#if mode === 'draw'}<button class="btn ghost" onclick={clearPad}>Clear</button>{/if}
      <span class="spacer"></span>
      <label class="chk"><input type="checkbox" bind:checked={keep} /> Remember</label>
      <button class="btn primary" onclick={use}>Place signature</button>
    </div>

    {#if saved.length}
      <div class="saved">
        <span class="label">Saved — click one to place it</span>
        <div class="list">
          {#each saved as s (s)}
            <div class="item">
              <button class="use" title="Place this signature" onclick={() => pickSaved(s)}><img src={s} alt="Saved signature" /></button>
              <button class="forget" title="Forget this signature" onclick={() => forget(s)}><Icon icon={XIcon} size={12} /></button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    width: min(620px, calc(100vw - 32px));
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head,
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tabs {
    display: flex;
    gap: 2px;
  }
  .tabs button {
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
  }
  .tabs button.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .stage {
    position: relative;
    height: 180px;
    border-radius: var(--radius);
    background: #fff;
    border: 1px solid var(--border);
  }
  .stage.hidden {
    display: none;
  }
  .pad {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .line {
    position: absolute;
    left: 8%;
    right: 8%;
    bottom: 34px;
    border-bottom: 1px solid #c8c8c8;
    pointer-events: none;
  }
  .hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 10px;
    text-align: center;
    color: #999;
    font-size: var(--fs-small);
    pointer-events: none;
  }
  .typed {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    color: #222;
  }
  .typed .input {
    width: 70%;
  }
  .preview {
    font-size: 44px;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .fonts {
    display: flex;
    gap: 6px;
  }
  .fonts .on {
    background: #eee;
  }
  .imported {
    max-height: 90px;
    max-width: 90%;
    background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 12px 12px;
  }
  .muted {
    color: #777;
    margin: 0;
    font-size: var(--fs-small);
  }
  .label {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .swatch.on {
    border-color: var(--accent);
  }
  .chk {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .saved {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border-soft);
    padding-top: 10px;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .item {
    position: relative;
  }
  .use {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
    cursor: pointer;
    height: 54px;
  }
  .use:hover {
    border-color: var(--accent);
  }
  .use img {
    height: 44px;
    max-width: 160px;
    object-fit: contain;
  }
  .forget {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-muted);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }
  .item:hover .forget {
    display: flex;
  }
</style>
