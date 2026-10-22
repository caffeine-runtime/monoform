<script lang="ts">
  // Adjustments with live GPU preview. Nothing changes until Apply; with a
  // selection, only the selected pixels are adjusted. The panel is a short
  // list (Light, Colour, … Clean up); each opens a page with just its own
  // controls. Changes on several pages add up to one preview and one Apply.
  import { BLUR_TYPES, EFFECTS, NEUTRAL, isNeutral, type Adjustments, type BlurType, type Effect } from './adjust';
  import type { EditorState, ImageEditor } from './editor';
  import { ui } from '../../core/ui.svelte';
  import { num, t } from '../../core/i18n';
  import Icon from '../../shell/Icon.svelte';
  import Pipette from '@lucide/svelte/icons/pipette';
  import X from '@lucide/svelte/icons/x';
  import Sun from '@lucide/svelte/icons/sun';
  import Palette from '@lucide/svelte/icons/palette';
  import Aperture from '@lucide/svelte/icons/aperture';
  import Droplets from '@lucide/svelte/icons/droplets';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Eraser from '@lucide/svelte/icons/eraser';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  let { editor, es, pick }: { editor: ImageEditor; es: EditorState; pick?: () => Promise<string | null> } = $props();

  let a = $state<Adjustments>({ ...NEUTRAL });
  let raf = 0;

  type Slider = { key: keyof Adjustments; label: string; min: number; max: number; step: number; scale?: number; unit?: string };
  const GROUPS: { title: string; sliders: Slider[] }[] = [
    {
      title: t('Light', {}, 'adjust'),
      sliders: [
        { key: 'exposure', label: t('Exposure'), min: -2, max: 2, step: 0.05, unit: ' EV' },
        { key: 'brightness', label: t('Brightness'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'contrast', label: t('Contrast'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'highlights', label: t('Highlights'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'shadows', label: t('Shadows'), min: -1, max: 1, step: 0.01, scale: 100 },
      ],
    },
    {
      title: t('Colour'),
      sliders: [
        { key: 'saturation', label: t('Saturation'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'vibrance', label: t('Vibrance'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'temperature', label: t('Temperature'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'tint', label: t('Tint'), min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'hue', label: t('Hue'), min: -180, max: 180, step: 1, unit: '°' },
      ],
    },
    {
      title: t('Detail'),
      sliders: [
        { key: 'sharpen', label: t('Sharpen'), min: 0, max: 1, step: 0.01, scale: 100 },
        { key: 'vignette', label: t('Vignette'), min: 0, max: 1, step: 0.01, scale: 100 },
      ],
    },
  ];

  type Page = 'light' | 'colour' | 'detail' | 'blur' | 'pixelate' | 'effects' | 'cleanup';
  const differs = (keys: (keyof Adjustments)[]) => keys.some((k) => a[k] !== NEUTRAL[k]);
  const PAGES: { id: Page; title: string; help: string; icon: typeof Sun; on: () => boolean }[] = [
    { id: 'light', title: GROUPS[0].title, help: t('Exposure, brightness, contrast, highlights, shadows'), icon: Sun, on: () => differs(GROUPS[0].sliders.map((s) => s.key)) },
    { id: 'colour', title: GROUPS[1].title, help: t('Saturation, vibrance, temperature, tint, hue'), icon: Palette, on: () => differs(GROUPS[1].sliders.map((s) => s.key)) },
    { id: 'detail', title: GROUPS[2].title, help: t('Sharpen, vignette'), icon: Aperture, on: () => differs(GROUPS[2].sliders.map((s) => s.key)) },
    { id: 'blur', title: t('Blur'), help: t('Gaussian, motion, zoom, spin, lens, tilt-shift, surface, frosted glass'), icon: Droplets, on: () => a.blur > 0 },
    { id: 'pixelate', title: t('Pixelate', {}, 'adjust'), help: t('Square blocks, to hide faces, plates or text'), icon: Grid3x3, on: () => a.pixelate > 0 },
    { id: 'effects', title: t('Effects'), help: t('Black & white, sepia, vintage, noir… with a strength each'), icon: Sparkles, on: () => Object.values(a.effects).some((v) => v) },
    { id: 'cleanup', title: t('Clean up'), help: t('Turn pale marks or one colour white (watermarks, scans)'), icon: Eraser, on: () => a.lightMarks > 0 || !!a.markColor },
  ];
  let page = $state<Page | null>(null);
  const current = $derived(PAGES.find((p) => p.id === page));

  /** Open a page (the selection bar's Blur and Pixelate start them at a visible strength). */
  export function open(p: Page | null, start = false) {
    page = p;
    if (start && p === 'blur' && !a.blur) set('blur', 8);
    if (start && p === 'pixelate' && !a.pixelate) set('pixelate', Math.max(6, Math.round(Math.max(editor.width, editor.height) / 80)));
  }

  function changed() {
    if (!es.adjusting && !editor.startAdjust()) {
      ui.toast(t('Adjustments need WebGL, which is not available here.'), 'error');
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => editor.previewAdjust($state.snapshot(a) as Adjustments));
  }

  // Blur controls that apply to the chosen kind of blur.
  const blurSliders = $derived.by((): Slider[] => {
    const k = a.blurType;
    const amount: Slider = { key: 'blur', label: k === 'zoom' || k === 'spin' ? t('Strength') : k === 'motion' ? t('Distance') : t('Radius'), min: 0, max: 100, step: 0.5, unit: k === 'zoom' || k === 'spin' ? '' : ' px' };
    const out = [amount];
    if (k === 'motion' || k === 'tiltshift') out.push({ key: 'blurAngle', label: t('Angle'), min: -180, max: 180, step: 1, unit: '°' });
    if (k === 'zoom' || k === 'spin' || k === 'tiltshift') {
      out.push({ key: 'blurX', label: t('Centre X'), min: 0, max: 1, step: 0.01, scale: 100, unit: '%' });
      out.push({ key: 'blurY', label: t('Centre Y'), min: 0, max: 1, step: 0.01, scale: 100, unit: '%' });
    }
    if (k === 'tiltshift') out.push({ key: 'blurBand', label: t('Sharp band'), min: 0, max: 0.5, step: 0.01, scale: 100, unit: '%' });
    return out;
  });

  function setBlurType(b: BlurType | string) {
    a.blurType = b as BlurType;
    if (a.blur) changed();
  }

  function set(key: keyof Adjustments, v: number | boolean | string) {
    (a as unknown as Record<string, number | boolean | string>)[key] = v;
    changed();
  }

  /** An effect chip: on at full strength (its slider shows below the chips), or off again. */
  function toggleEffect(id: Effect) {
    const fx = { ...a.effects };
    if (id in fx) delete fx[id];
    else fx[id] = 1;
    a.effects = fx;
    changed();
  }

  function setEffect(id: Effect, v: number) {
    a.effects = { ...a.effects, [id]: v };
    changed();
  }

  /** Clean up › A colour: click it in the image. */
  async function pickMark() {
    const c = await pick?.();
    if (c) set('markColor', c);
  }

  function apply() {
    cancelAnimationFrame(raf);
    if (!isNeutral(a)) editor.applyAdjust($state.snapshot(a) as Adjustments);
    else editor.cancelAdjust();
    a = { ...NEUTRAL };
  }

  function reset() {
    cancelAnimationFrame(raf);
    editor.cancelAdjust();
    a = { ...NEUTRAL };
  }

  const fmt = (s: Slider, v: number) => num(s.scale ? Math.round(v * s.scale) : Math.round(v * 100) / 100) + (s.unit ?? '');

  // Leaving the panel (or the tab) discards an unapplied preview.
  $effect(() => () => editor.cancelAdjust());
  // Hooks for the self-test.
  export const test = { set, setBlurType, toggleEffect, setEffect, apply, reset, open, page: () => page, get: () => $state.snapshot(a) as Adjustments };
</script>

<div class="adjust">
  {#if current}
    <button class="back" onclick={() => (page = null)} title={t('Back to all adjustments')}><Icon icon={ChevronLeft} size={16} /> <Icon icon={current.icon} size={14} /> <span>{current.title}</span></button>
  {/if}
  <div class="scroll">
    {#if es.pixelSelection}<p class="note">{t('Adjusting the selected area only.')}</p>{/if}
    {#if !page}
      <ul class="pages">
        {#each PAGES as p (p.id)}
          <li>
            <button class="page" data-page={p.id} title={p.help} onclick={() => open(p.id)}>
              <Icon icon={p.icon} size={16} />
              <span class="txt"><span class="name">{p.title}</span><span class="help">{p.help}</span></span>
              {#if p.on()}<span class="dot" title={t('Changed')}></span>{/if}
              <Icon icon={ChevronRight} size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {:else if page === 'cleanup'}
      <section class="cleanup">
        <label class="row" ondblclick={() => set('lightMarks', 0)} title={t('Turns pale marks white — a light watermark, scanner shading, a grey page. Dark lines and text stay.')}>
          <span class="lbl">{t('Light marks')}</span>
          <input type="range" min="0" max="1" step="0.01" value={a.lightMarks} oninput={(e) => set('lightMarks', +(e.target as HTMLInputElement).value)} />
          <span class="num">{a.lightMarks ? `${num(Math.round(a.lightMarks * 100))}%` : t('off')}</span>
        </label>
        <div class="row" title={t('Turns one colour white — a coloured watermark or stamp. Pick it in the image.')}>
          <span class="lbl">{t('A colour')}</span>
          <span class="pickrow">
            <input class="swatch" class:unset={!a.markColor} type="color" value={a.markColor || '#c8c8c8'} aria-label={t('Colour to remove')} oninput={(e) => set('markColor', (e.target as HTMLInputElement).value)} />
            {#if pick}<button class="icon-btn" title={t('Pick in the image')} aria-label={t('Pick in the image')} onclick={pickMark}><Icon icon={Pipette} size={14} /></button>{/if}
            {#if a.markColor}<button class="icon-btn" title={t('Keep this colour')} aria-label={t('Keep this colour')} onclick={() => set('markColor', '')}><Icon icon={X} size={14} /></button>{/if}
          </span>
          <span class="num">{a.markColor ? '' : t('off')}</span>
        </div>
        {#if a.markColor}
          <label class="row" ondblclick={() => set('markTolerance', NEUTRAL.markTolerance)} title={t('How different a colour can be and still be removed')}>
            <span class="lbl">{t('Tolerance')}</span>
            <input type="range" min="0.02" max="0.6" step="0.01" value={a.markTolerance} oninput={(e) => set('markTolerance', +(e.target as HTMLInputElement).value)} />
            <span class="num">{num(Math.round(a.markTolerance * 100))}%</span>
          </label>
        {/if}
      </section>
    {:else if page === 'light' || page === 'colour' || page === 'detail'}
      {#each GROUPS[page === 'light' ? 0 : page === 'colour' ? 1 : 2].sliders as s (s.key)}
        <label class="row" ondblclick={() => set(s.key, NEUTRAL[s.key] as number)} title={t('Double-click to reset')}>
          <span class="lbl">{s.label}</span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={a[s.key] as number} oninput={(e) => set(s.key, +(e.target as HTMLInputElement).value)} />
          <span class="num">{fmt(s, a[s.key] as number)}</span>
        </label>
      {/each}
    {:else if page === 'blur'}
      <div class="toggles" role="radiogroup" aria-label={t('Kind of blur')}>
        {#each BLUR_TYPES as b (b.id)}
          <button class="chip" role="radio" aria-checked={a.blurType === b.id} class:on={a.blurType === b.id} title={b.help} onclick={() => setBlurType(b.id)}>{b.label}</button>
        {/each}
      </div>
      {#each blurSliders as s (s.key)}
        <label class="row" ondblclick={() => set(s.key, NEUTRAL[s.key] as number)} title={t('Double-click to reset')}>
          <span class="lbl">{s.label}</span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={a[s.key] as number} oninput={(e) => set(s.key, +(e.target as HTMLInputElement).value)} />
          <span class="num">{fmt(s, a[s.key] as number)}</span>
        </label>
      {/each}
    {:else if page === 'pixelate'}
      <label class="row pixelate" ondblclick={() => set('pixelate', 0)} title={t('Double-click to turn off')}>
        <span class="lbl">{t('Block size')}</span>
        <input type="range" min="0" max="100" step="1" value={a.pixelate} oninput={(e) => set('pixelate', +(e.target as HTMLInputElement).value)} />
        <span class="num">{a.pixelate > 1 ? `${num(a.pixelate)} px` : t('off')}</span>
      </label>
    {:else if page === 'effects'}
      <div class="toggles looks">
        {#each EFFECTS as l (l.id)}
          <button class="chip" aria-pressed={l.id in a.effects} class:on={l.id in a.effects} title={l.help} onclick={() => toggleEffect(l.id)}>{l.label}</button>
        {/each}
      </div>
      {#each EFFECTS.filter((l) => l.id in a.effects) as l (l.id)}
        <label class="row effect" ondblclick={() => setEffect(l.id, 1)} title={t('Strength of {effect}. Double-click to reset.', { effect: l.label })}>
          <span class="lbl">{l.label}</span>
          <input type="range" min="0" max="1" step="0.01" value={a.effects[l.id]} oninput={(e) => setEffect(l.id, +(e.target as HTMLInputElement).value)} />
          <span class="num">{Math.round((a.effects[l.id] ?? 0) * 100)}%</span>
        </label>
      {/each}
    {/if}
  </div>
  <div class="actions">
    <button class="btn ghost" disabled={!es.adjusting} onclick={reset}>{t('Reset')}</button>
    <button class="btn primary" disabled={!es.adjusting} onclick={apply}>{t('Apply')}</button>
  </div>
</div>

<style>
  .adjust {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .scroll {
    flex: 1;
    overflow: auto;
    padding: 4px 12px 12px;
  }
  .back {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 8px 0;
    padding: 4px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .back:hover {
    background: var(--bg-hover);
  }
  .pages {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .page {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .page:hover {
    background: var(--bg-hover);
  }
  .page .txt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .page .help {
    font-size: var(--fs-small);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .toggles + .row,
  .row + .row {
    margin-top: 2px;
  }
  .toggles {
    margin: 8px 0 6px;
  }
  .pickrow {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row .swatch {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    flex: none;
    cursor: pointer;
  }
  .row .swatch.unset {
    opacity: 0.45;
  }
  .note {
    margin: 8px 0 0;
    font-size: var(--fs-small);
    color: var(--accent-text);
  }
  .row {
    display: grid;
    grid-template-columns: 78px 1fr 44px;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    min-height: 24px;
  }
  .row input {
    width: 100%;
    accent-color: var(--accent);
  }
  .num {
    text-align: right;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  button.chip {
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--fs-small);
  }
  .chip input {
    display: none;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid var(--border-soft);
  }
</style>
