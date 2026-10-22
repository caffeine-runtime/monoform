<script lang="ts">
  // One row per overlay under the timeline: drag the bar to move it in time,
  // its ends to trim, a keyframe diamond to retime it (click seeks there).
  import type { Layer } from './project';
  import { t, num } from '../../core/i18n';

  let {
    layers,
    dur,
    lineW,
    time,
    selected,
    onselect,
    onchange,
    onseek,
  }: {
    layers: Layer[];
    dur: number;
    lineW: number;
    time: number;
    selected: string | null;
    onselect: (id: string) => void;
    onchange: (l: Layer, done: boolean) => void;
    onseek: (t: number) => void;
  } = $props();

  const xOf = (t: number) => (dur ? (t / dur) * lineW : 0);
  type Drag = { l: Layer; mode: 'move' | 'start' | 'end' | 'key'; key: number; x: number; moved: boolean };
  let drag: Drag | null = null;

  function down(e: PointerEvent, l: Layer, mode: Drag['mode'], key = -1) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onselect(l.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { l, mode, key, x: e.clientX, moved: false };
  }

  function move(e: PointerEvent, done = false) {
    const d = drag;
    if (!d) return;
    const dt = ((e.clientX - d.x) / (lineW || 1)) * dur;
    if (!d.moved && Math.abs(e.clientX - d.x) < 3) {
      if (done) {
        drag = null;
        if (d.mode === 'key') onseek(d.l.keys[d.key].t);
      }
      return;
    }
    d.moved = true;
    const l = d.l;
    let next: Layer;
    if (d.mode === 'move') {
      const shift = Math.max(-l.start, Math.min(dur - l.end, dt));
      next = { ...l, start: l.start + shift, end: l.end + shift, keys: l.keys.map((k) => ({ ...k, t: k.t + shift })) };
    } else if (d.mode === 'start') next = { ...l, start: Math.max(0, Math.min(l.end - 0.1, l.start + dt)) };
    else if (d.mode === 'end') next = { ...l, end: Math.min(dur, Math.max(l.start + 0.1, l.end + dt)) };
    else {
      const keys = l.keys.map((k) => ({ ...k }));
      keys[d.key].t = Math.max(0, Math.min(dur, keys[d.key].t + dt));
      keys.sort((a, b) => a.t - b.t);
      next = { ...l, keys };
    }
    onchange(next, done);
    if (done) drag = null;
  }
</script>

{#if layers.length}
  <div class="tracks" role="list" aria-label={t('Overlays')}>
    {#each layers as l (l.id)}
      <div class="row" role="listitem">
        <span class="name" class:sel={l.id === selected} title={l.name}>{l.kind === 'blur' ? '◌' : '▣'} {l.name}</span>
        <div class="lane">
          <div
            class="bar"
            class:sel={l.id === selected}
            class:blur={l.kind === 'blur'}
            style:left="{xOf(l.start)}px"
            style:width="{Math.max(4, xOf(l.end) - xOf(l.start))}px"
            role="button"
            tabindex="-1"
            title={t('{name}: drag to move in time, drag the ends to trim', { name: l.name })}
            onpointerdown={(e) => down(e, l, 'move')}
            onpointermove={(e) => move(e)}
            onpointerup={(e) => move(e, true)}
          >
            <span class="end s" role="presentation" onpointerdown={(e) => down(e, l, 'start')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
            <span class="end e" role="presentation" onpointerdown={(e) => down(e, l, 'end')} onpointermove={(e) => move(e)} onpointerup={(e) => move(e, true)}></span>
          </div>
          {#if l.keys.length > 1 || l.id === selected}
            {#each l.keys as k, i (i)}
              <span
                class="key"
                class:tracked={l.tracked}
                style:left="{xOf(k.t)}px"
                role="button"
                tabindex="-1"
                title={t('Keyframe at {s} s — click to go there, drag to retime', { s: num(k.t, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                onpointerdown={(e) => down(e, l, 'key', i)}
                onpointermove={(e) => move(e)}
                onpointerup={(e) => move(e, true)}
              ></span>
            {/each}
          {/if}
          <div class="now" style:left="{xOf(time)}px"></div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .tracks {
    margin: 2px 8px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 120px;
    overflow-y: auto;
  }
  .row {
    display: grid;
    grid-template-columns: 0 1fr;
    position: relative;
  }
  .name {
    position: absolute;
    left: 4px;
    top: 2px;
    z-index: 2;
    font-size: calc(10.5px * var(--ui-scale));
    color: var(--text-muted);
    pointer-events: none;
    white-space: nowrap;
  }
  .name.sel {
    color: var(--accent-text);
  }
  .lane {
    position: relative;
    height: 20px;
    border-radius: 4px;
    background: var(--bg-sidebar);
  }
  .bar {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 3px;
    background: rgba(91, 141, 239, 0.45);
    border: 1px solid rgba(91, 141, 239, 0.9);
    cursor: grab;
    touch-action: none;
  }
  .bar.blur {
    background: rgba(160, 120, 220, 0.4);
    border-color: rgba(160, 120, 220, 0.9);
  }
  .bar.sel {
    border: 2px solid var(--accent);
  }
  .end {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .end.s {
    left: -3px;
  }
  .end.e {
    right: -3px;
  }
  .key {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    margin: -4.5px 0 0 -4.5px;
    background: #fff;
    border: 1.5px solid var(--accent);
    transform: rotate(45deg);
    cursor: pointer;
    z-index: 1;
  }
  .key.tracked {
    width: 5px;
    height: 5px;
    margin: -2.5px 0 0 -2.5px;
    border-width: 1px;
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }
</style>
