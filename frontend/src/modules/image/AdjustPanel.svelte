<script lang="ts">
  // Adjustment sliders with live GPU preview. Nothing changes until Apply;
  // with a selection, only the selected pixels are adjusted.
  import { BLUR_TYPES, LOOKS, NEUTRAL, isNeutral, type Adjustments, type BlurType, type Look } from './adjust';
  import type { EditorState, ImageEditor } from './editor';
  import { ui } from '../../core/ui.svelte';
  import { num, t } from '../../core/i18n';
  import Icon from '../../shell/Icon.svelte';
  import Pipette from '@lucide/svelte/icons/pipette';
  import X from '@lucide/svelte/icons/x';

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
  export const test = { set, setBlurType, apply, reset, get: () => $state.snapshot(a) as Adjustments };
</script>

<div class="adjust">
  <div class="scroll">
    {#if es.pixelSelection}<p class="note">{t('Adjusting the selected area only.')}</p>{/if}
    <section class="cleanup">
      <h4>{t('Clean up')}</h4>
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
    {#each GROUPS as g (g.title)}
      <h4>{g.title}</h4>
      {#each g.sliders as s (s.key)}
        <label class="row" ondblclick={() => set(s.key, NEUTRAL[s.key] as number)} title={t('Double-click to reset')}>
          <span class="lbl">{s.label}</span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={a[s.key] as number} oninput={(e) => set(s.key, +(e.target as HTMLInputElement).value)} />
          <span class="num">{fmt(s, a[s.key] as number)}</span>
        </label>
      {/each}
    {/each}
    <h4>{t('Blur')}</h4>
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
    <h4>{t('Effects')}</h4>
    <div class="toggles looks" role="radiogroup" aria-label={t('Look')}>
      {#each LOOKS as l (l.id)}
        <button class="chip" role="radio" aria-checked={a.look === l.id} class:on={a.look === l.id} title={l.help} onclick={() => set('look', a.look === l.id ? '' : (l.id as Look))}>{l.label}</button>
      {/each}
    </div>
    {#if a.look}
      <label class="row" ondblclick={() => set('lookAmount', 1)} title={t('Double-click to reset')}>
        <span class="lbl">{t('Amount')}</span>
        <input type="range" min="0" max="1" step="0.01" value={a.lookAmount} oninput={(e) => set('lookAmount', +(e.target as HTMLInputElement).value)} />
        <span class="num">{Math.round(a.lookAmount * 100)}</span>
      </label>
    {/if}
    <div class="toggles">
      {#each [['grayscale', t('Black & white')], ['sepia', t('Sepia')], ['invert', t('Invert')]] as [k, label] (k)}
        <label class="chip" class:on={a[k as keyof Adjustments]}><input type="checkbox" checked={a[k as keyof Adjustments] as boolean} onchange={(e) => set(k as keyof Adjustments, (e.target as HTMLInputElement).checked)} />{label}</label>
      {/each}
    </div>
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
  h4 {
    margin: 12px 0 4px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-weight: 600;
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
