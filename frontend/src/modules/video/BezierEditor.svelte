<script lang="ts">
  // Drag two handles to shape a timing curve (CSS cubic-bezier). x stays
  // within 0..1; y may overshoot for anticipation/overshoot motion.
  import { cubicBezier } from './project';
  import { t } from '../../core/i18n';

  let { value, onchange }: { value: [number, number, number, number]; onchange: (v: [number, number, number, number]) => void } = $props();

  const S = 120;
  const PAD = 18;
  const toX = (x: number) => PAD + x * S;
  const toY = (y: number) => PAD + (1 - y) * S;
  let svg = $state<SVGSVGElement>();
  let drag: 0 | 1 | null = null;

  const curve = $derived.by(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      pts.push(`${toX(x)},${toY(cubicBezier(value[0], value[1], value[2], value[3], x))}`);
    }
    return pts.join(' ');
  });

  function move(e: PointerEvent) {
    if (drag === null || !svg) return;
    const r = svg.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / S));
    const y = Math.min(1.6, Math.max(-0.6, 1 - (e.clientY - r.top - PAD) / S));
    const v: [number, number, number, number] = [...value];
    v[drag * 2] = Math.round(x * 100) / 100;
    v[drag * 2 + 1] = Math.round(y * 100) / 100;
    onchange(v);
  }
</script>

<svg
  bind:this={svg}
  class="bez"
  width={S + PAD * 2}
  height={S + PAD * 2}
  role="application"
  aria-label={t('Timing curve')}
  onpointermove={move}
  onpointerup={() => (drag = null)}
  onpointerleave={() => (drag = null)}
>
  <rect x={PAD} y={PAD} width={S} height={S} class="frame" />
  <line x1={toX(0)} y1={toY(0)} x2={toX(value[0])} y2={toY(value[1])} class="arm" />
  <line x1={toX(1)} y1={toY(1)} x2={toX(value[2])} y2={toY(value[3])} class="arm" />
  <polyline points={curve} class="curve" />
  {#each [0, 1] as h (h)}
    <circle
      cx={toX(value[h * 2])}
      cy={toY(value[h * 2 + 1])}
      r="6"
      class="handle"
      role="slider"
      aria-label={h ? t('End handle') : t('Start handle')}
      aria-valuenow={value[h * 2]}
      tabindex="0"
      onpointerdown={(e) => {
        drag = h as 0 | 1;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
    />
  {/each}
  <text x={PAD} y={S + PAD * 2 - 4} class="lbl">{t('time →')}</text>
</svg>
<div class="vals">cubic-bezier({value.join(', ')})</div><!-- i18n-ignore: CSS function -->

<style>
  .bez {
    display: block;
    touch-action: none;
  }
  .frame {
    fill: var(--bg-sidebar);
    stroke: var(--border);
  }
  .arm {
    stroke: var(--text-faint);
    stroke-dasharray: 3 3;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
  }
  .handle {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 2;
    cursor: grab;
  }
  .lbl {
    font-size: calc(10px * var(--ui-scale));
    fill: var(--text-faint);
  }
  .vals {
    font-family: var(--font-mono);
    font-size: calc(10.5px * var(--ui-scale));
    color: var(--text-muted);
  }
</style>
