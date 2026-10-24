<script lang="ts">
  // A tone curve over the picture's histogram (Adjust › Curves): click the
  // curve or the graph to add a point, drag a point to move it (between its
  // neighbours), double-click a point to remove it (the end points stay).
  import { t } from '../../core/i18n';
  import { curveFn, type CurvePoint } from './tone';

  let { points, hist, colour = 'var(--text)', onchange }: { points: CurvePoint[]; hist: Uint32Array | null; colour?: string; onchange: (p: CurvePoint[]) => void } = $props();

  const S = 256;
  let svg = $state<SVGSVGElement>();
  let dragging = $state(-1);

  const sorted = $derived([...points].sort((a, b) => a[0] - b[0]));
  const path = $derived.by(() => {
    const f = curveFn(sorted);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${(x * S).toFixed(1)} ${((1 - Math.min(1, Math.max(0, f(x)))) * S).toFixed(1)}`;
    }
    return d;
  });
  const histPath = $derived.by(() => {
    if (!hist) return '';
    let max = 1;
    for (let i = 1; i < 255; i++) max = Math.max(max, hist[i]); // the ends are often huge (clipped)
    let d = `M0 ${S}`;
    for (let i = 0; i < 256; i++) d += `L${i} ${(S - Math.min(1, hist[i] / max) * S * 0.9).toFixed(1)}`;
    return `${d}L${S} ${S}Z`;
  });

  function at(e: PointerEvent | MouseEvent): CurvePoint {
    const r = svg!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    return [x, y];
  }

  function down(e: PointerEvent, i = -1) {
    e.preventDefault();
    svg!.setPointerCapture(e.pointerId);
    if (i < 0) {
      // A new point where clicked (not too close to another).
      const [x, y] = at(e);
      if (sorted.some((q) => Math.abs(q[0] - x) < 0.02)) return;
      const next = [...sorted, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
      onchange(next);
      dragging = next.findIndex((q) => q[0] === x);
    } else dragging = i;
  }

  function move(e: PointerEvent) {
    if (dragging < 0) return;
    let [x, y] = at(e);
    const p = sorted;
    // Ends keep their place along the input axis' end; others stay between their neighbours.
    const lo = dragging > 0 ? p[dragging - 1][0] + 0.01 : 0;
    const hi = dragging < p.length - 1 ? p[dragging + 1][0] - 0.01 : 1;
    x = Math.min(hi, Math.max(lo, x));
    const next = p.map((q, i) => (i === dragging ? ([x, y] as CurvePoint) : q));
    onchange(next);
  }

  function remove(i: number) {
    if (i === 0 || i === sorted.length - 1) return;
    onchange(sorted.filter((_, k) => k !== i));
  }
</script>

<svg
  bind:this={svg}
  class="curve"
  viewBox="0 0 {S} {S}"
  role="application"
  aria-label={t('Tone curve: click to add a point, drag to move it, double-click to remove it')}
  onpointerdown={(e) => down(e)}
  onpointermove={move}
  onpointerup={() => (dragging = -1)}
>
  {#if histPath}<path class="hist" d={histPath} />{/if}
  {#each [0.25, 0.5, 0.75] as g (g)}
    <line class="grid" x1={g * S} y1="0" x2={g * S} y2={S} />
    <line class="grid" x1="0" y1={g * S} x2={S} y2={g * S} />
  {/each}
  <line class="diag" x1="0" y1={S} x2={S} y2="0" />
  <path class="line" d={path} style:stroke={colour} />
  {#each sorted as [x, y], i (i)}
    <circle
      class="pt"
      class:on={dragging === i}
      cx={x * S}
      cy={(1 - y) * S}
      r="5"
      style:stroke={colour}
      role="button"
      tabindex="-1"
      aria-label={t('Point {x}, {y}', { x: String(Math.round(x * 255)), y: String(Math.round(y * 255)) })}
      onpointerdown={(e) => {
        e.stopPropagation();
        down(e, i);
      }}
      ondblclick={() => remove(i)}
    />
  {/each}
</svg>

<style>
  .curve {
    width: 100%;
    aspect-ratio: 1;
    display: block;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    touch-action: none;
    cursor: crosshair;
    margin: 6px 0;
  }
  .hist {
    fill: var(--text-muted);
    opacity: 0.25;
  }
  .grid {
    stroke: var(--border-soft);
    stroke-width: 1;
  }
  .diag {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .line {
    fill: none;
    stroke-width: 2;
  }
  .pt {
    fill: var(--bg-elevated);
    stroke-width: 2;
    cursor: grab;
  }
  .pt.on {
    fill: var(--accent);
  }
</style>
