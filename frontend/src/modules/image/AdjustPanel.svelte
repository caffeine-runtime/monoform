<script lang="ts">
  // Adjustment sliders with live GPU preview. Nothing changes until Apply;
  // with a selection, only the selected pixels are adjusted.
  import { BLUR_TYPES, NEUTRAL, isNeutral, type Adjustments, type BlurType } from './adjust';
  import type { EditorState, ImageEditor } from './editor';
  import { ui } from '../../core/ui.svelte';

  let { editor, es }: { editor: ImageEditor; es: EditorState } = $props();

  let a = $state<Adjustments>({ ...NEUTRAL });
  let raf = 0;

  type Slider = { key: keyof Adjustments; label: string; min: number; max: number; step: number; scale?: number; unit?: string };
  const GROUPS: { title: string; sliders: Slider[] }[] = [
    {
      title: 'Light',
      sliders: [
        { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05, unit: ' EV' },
        { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, scale: 100 },
      ],
    },
    {
      title: 'Colour',
      sliders: [
        { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, scale: 100 },
        { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, unit: '°' },
      ],
    },
    {
      title: 'Detail',
      sliders: [
        { key: 'sharpen', label: 'Sharpen', min: 0, max: 1, step: 0.01, scale: 100 },
        { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, scale: 100 },
      ],
    },
  ];

  function changed() {
    if (!es.adjusting && !editor.startAdjust()) {
      ui.toast('Adjustments need WebGL, which is not available here.', 'error');
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => editor.previewAdjust($state.snapshot(a) as Adjustments));
  }

  // Blur controls that apply to the chosen kind of blur.
  const blurSliders = $derived.by((): Slider[] => {
    const t = a.blurType;
    const amount: Slider = { key: 'blur', label: t === 'zoom' || t === 'spin' ? 'Strength' : t === 'motion' ? 'Distance' : 'Radius', min: 0, max: 100, step: 0.5, unit: t === 'zoom' || t === 'spin' ? '' : ' px' };
    const out = [amount];
    if (t === 'motion' || t === 'tiltshift') out.push({ key: 'blurAngle', label: 'Angle', min: -180, max: 180, step: 1, unit: '°' });
    if (t === 'zoom' || t === 'spin' || t === 'tiltshift') {
      out.push({ key: 'blurX', label: 'Centre X', min: 0, max: 1, step: 0.01, scale: 100, unit: '%' });
      out.push({ key: 'blurY', label: 'Centre Y', min: 0, max: 1, step: 0.01, scale: 100, unit: '%' });
    }
    if (t === 'tiltshift') out.push({ key: 'blurBand', label: 'Sharp band', min: 0, max: 0.5, step: 0.01, scale: 100, unit: '%' });
    return out;
  });

  function setBlurType(t: BlurType | string) {
    a.blurType = t as BlurType;
    if (a.blur) changed();
  }

  function set(key: keyof Adjustments, v: number | boolean) {
    (a as unknown as Record<string, number | boolean>)[key] = v;
    changed();
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

  const fmt = (s: Slider, v: number) => (s.scale ? Math.round(v * s.scale) : Math.round(v * 100) / 100) + (s.unit ?? '');

  // Leaving the panel (or the tab) discards an unapplied preview.
  $effect(() => () => editor.cancelAdjust());
  // Hooks for the self-test.
  export const test = { set, setBlurType, apply, reset };
</script>

<div class="adjust">
  <div class="scroll">
    {#if es.pixelSelection}<p class="note">Adjusting the selected area only.</p>{/if}
    {#each GROUPS as g (g.title)}
      <h4>{g.title}</h4>
      {#each g.sliders as s (s.key)}
        <label class="row" ondblclick={() => set(s.key, NEUTRAL[s.key] as number)} title="Double-click to reset">
          <span class="lbl">{s.label}</span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={a[s.key] as number} oninput={(e) => set(s.key, +(e.target as HTMLInputElement).value)} />
          <span class="num">{fmt(s, a[s.key] as number)}</span>
        </label>
      {/each}
    {/each}
    <h4>Blur</h4>
    <div class="toggles" role="radiogroup" aria-label="Kind of blur">
      {#each BLUR_TYPES as b (b.id)}
        <button class="chip" role="radio" aria-checked={a.blurType === b.id} class:on={a.blurType === b.id} title={b.help} onclick={() => setBlurType(b.id)}>{b.label}</button>
      {/each}
    </div>
    {#each blurSliders as s (s.key)}
      <label class="row" ondblclick={() => set(s.key, NEUTRAL[s.key] as number)} title="Double-click to reset">
        <span class="lbl">{s.label}</span>
        <input type="range" min={s.min} max={s.max} step={s.step} value={a[s.key] as number} oninput={(e) => set(s.key, +(e.target as HTMLInputElement).value)} />
        <span class="num">{fmt(s, a[s.key] as number)}</span>
      </label>
    {/each}
    <h4>Effects</h4>
    <div class="toggles">
      {#each [['grayscale', 'Black & white'], ['sepia', 'Sepia'], ['invert', 'Invert']] as [k, label] (k)}
        <label class="chip" class:on={a[k as keyof Adjustments]}><input type="checkbox" checked={a[k as keyof Adjustments] as boolean} onchange={(e) => set(k as keyof Adjustments, (e.target as HTMLInputElement).checked)} />{label}</label>
      {/each}
    </div>
  </div>
  <div class="actions">
    <button class="btn ghost" disabled={!es.adjusting} onclick={reset}>Reset</button>
    <button class="btn primary" disabled={!es.adjusting} onclick={apply}>Apply</button>
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
    border-radius: 999px;
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
