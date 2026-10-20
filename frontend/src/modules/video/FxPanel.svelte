<script lang="ts">
  // Effects panel: the selected overlay's properties and keyframes (with
  // timing curves), or — with nothing selected — the project's overlays,
  // speed changes, transitions and fades.
  import BezierEditor from './BezierEditor.svelte';
  import { BLUR_KINDS, EASINGS, TRANSITIONS, bezierOf, stateAt, type Easing, type Layer, type Project, type State } from './project';
  import { formatTime } from '../audio/waveform';

  let {
    project,
    selected,
    time,
    autoKey = $bindable(),
    tracking,
    onselect,
    onlayer,
    onproject,
    onstate,
    onseek,
    ontrack,
    ondelete,
  }: {
    project: Project;
    selected: Layer | null;
    time: number;
    autoKey: boolean;
    tracking: string;
    onselect: (id: string | null) => void;
    onlayer: (l: Layer) => void;
    onproject: (p: Project) => void;
    onstate: (l: Layer, s: Partial<State>) => void;
    onseek: (t: number) => void;
    ontrack: (l: Layer) => void;
    ondelete: (l: Layer) => void;
  } = $props();

  const now = $derived(selected ? stateAt({ ...selected, fadeIn: 0, fadeOut: 0 }, time) : null);
  const easeId = (e: Easing) => (typeof e === 'object' ? 'custom' : e);
  let curveFor = $state(-1);

  function setEase(i: number, id: string) {
    if (!selected) return;
    const keys = selected.keys.map((k) => ({ ...k }));
    keys[i].ease = id === 'custom' ? { bezier: bezierOf(keys[i].ease) } : (id as Easing);
    if (id === 'custom') curveFor = i;
    onlayer({ ...selected, keys });
  }

  function setCurve(i: number, v: [number, number, number, number]) {
    if (!selected) return;
    const keys = selected.keys.map((k) => ({ ...k }));
    keys[i].ease = { bezier: v };
    onlayer({ ...selected, keys });
  }

  function removeKey(i: number) {
    if (!selected || selected.keys.length < 2) return;
    onlayer({ ...selected, keys: selected.keys.filter((_, k) => k !== i), tracked: selected.tracked && selected.keys.length > 2 });
  }

  const num = (e: Event) => +(e.target as HTMLInputElement).value;
</script>

<aside class="fxpanel" aria-label="Effects">
  {#if selected && now}
    <div class="head">
      <input class="input name" value={selected.name} aria-label="Name" onchange={(e) => onlayer({ ...selected, name: (e.target as HTMLInputElement).value })} />
      <button class="btn ghost" title="Back to all effects" onclick={() => onselect(null)}>All</button>
    </div>
    <h4>Timing</h4>
    <div class="grid">
      <span>Shown</span>
      <span class="mono">{formatTime(selected.start, 2)} – {formatTime(selected.end, 2)}</span>
      <span></span>
      <span class="btns">
        <button class="btn ghost sm" title="Start at the playhead" onclick={() => onlayer({ ...selected, start: Math.min(time, selected.end - 0.1) })}>Start here</button>
        <button class="btn ghost sm" title="End at the playhead" onclick={() => onlayer({ ...selected, end: Math.max(time, selected.start + 0.1) })}>End here</button>
      </span>
      <label for="fi">Fade in</label>
      <span class="rng"><input id="fi" type="range" min="0" max="3" step="0.1" value={selected.fadeIn} oninput={(e) => onlayer({ ...selected, fadeIn: num(e) })} /> {selected.fadeIn.toFixed(1)} s</span>
      <label for="fo">Fade out</label>
      <span class="rng"><input id="fo" type="range" min="0" max="3" step="0.1" value={selected.fadeOut} oninput={(e) => onlayer({ ...selected, fadeOut: num(e) })} /> {selected.fadeOut.toFixed(1)} s</span>
    </div>

    <h4>Look at {formatTime(time, 2)}</h4>
    <div class="grid">
      <label for="op">Opacity</label>
      <span class="rng"><input id="op" type="range" min="0" max="1" step="0.01" value={now.opacity} oninput={(e) => onstate(selected, { opacity: num(e) })} /> {Math.round(now.opacity * 100)}%</span>
      <label for="sc">Scale</label>
      <span class="rng"><input id="sc" type="range" min="0.05" max="4" step="0.01" value={now.scale} oninput={(e) => onstate(selected, { scale: num(e) })} /> {Math.round(now.scale * 100)}%</span>
      <label for="ro">Rotation</label>
      <span class="rng"><input id="ro" type="range" min="-180" max="180" step="1" value={now.rotation} oninput={(e) => onstate(selected, { rotation: num(e) })} /> {Math.round(now.rotation)}°</span>
    </div>
    <label class="chk" title="When on, moving or changing the overlay adds a keyframe at the playhead, so it animates"><input type="checkbox" bind:checked={autoKey} /> Animate: changes add keyframes</label>

    {#if selected.kind === 'blur' && selected.blur}
      {@const b = selected.blur}
      <h4>Blur</h4>
      <div class="chips" role="radiogroup" aria-label="Kind of blur">
        {#each BLUR_KINDS as k (k.id)}
          <button class="chip" class:on={b.kind === k.id} role="radio" aria-checked={b.kind === k.id} onclick={() => onlayer({ ...selected, blur: { ...b, kind: k.id } })}>{k.label}</button>
        {/each}
      </div>
      <div class="grid">
        <label for="am">Strength</label>
        <span class="rng"><input id="am" type="range" min="1" max="80" step="1" value={b.amount} oninput={(e) => onlayer({ ...selected, blur: { ...b, amount: num(e) } })} /> {b.amount}</span>
        <label for="fe">Soft edge</label>
        <span class="rng"><input id="fe" type="range" min="0" max="1" step="0.05" value={b.feather} oninput={(e) => onlayer({ ...selected, blur: { ...b, feather: num(e) } })} /> {Math.round(b.feather * 100)}%</span>
        {#if b.kind === 'motion'}
          <label for="an">Direction</label>
          <span class="rng"><input id="an" type="range" min="-180" max="180" step="1" value={b.angle} oninput={(e) => onlayer({ ...selected, blur: { ...b, angle: num(e) } })} /> {b.angle}°</span>
        {/if}
        <span>Shape</span>
        <span class="btns">
          <button class="btn ghost sm" class:on={b.shape === 'ellipse'} onclick={() => onlayer({ ...selected, blur: { ...b, shape: 'ellipse' } })}>Ellipse</button>
          <button class="btn ghost sm" class:on={b.shape === 'rect'} onclick={() => onlayer({ ...selected, blur: { ...b, shape: 'rect' } })}>Rectangle</button>
        </span>
      </div>
    {/if}

    <h4>Movement</h4>
    <div class="btns">
      <button class="btn ghost sm" class:on={selected.path === 'smooth'} title="Curved path through the keyframes" onclick={() => onlayer({ ...selected, path: 'smooth' })}>Curved path</button>
      <button class="btn ghost sm" class:on={selected.path === 'straight'} title="Straight lines between keyframes" onclick={() => onlayer({ ...selected, path: 'straight' })}>Straight path</button>
    </div>
    <button class="btn wide" disabled={!!tracking} title="Follow what is under the overlay as it moves, from the playhead to the overlay's end" onclick={() => ontrack(selected)}>
      {tracking ? tracking : '⌖ Pin to moving object (track)'}
    </button>
    <div class="keys">
      {#each selected.keys as k, i (i)}
        <div class="key" class:here={Math.abs(k.t - time) < 0.02}>
          <button class="t mono" title="Go to this keyframe" onclick={() => onseek(k.t)}>◆ {formatTime(k.t, 2)}</button>
          {#if i < selected.keys.length - 1}
            <select value={easeId(k.ease)} title="Timing curve to the next keyframe" onchange={(e) => setEase(i, (e.target as HTMLSelectElement).value)}>
              {#each EASINGS as ez (ez.id)}<option value={ez.id}>{ez.label}</option>{/each}
            </select>
            {#if typeof k.ease === 'object'}<button class="btn ghost sm" onclick={() => (curveFor = curveFor === i ? -1 : i)}>Curve</button>{/if}
          {:else}
            <span class="muted">last</span>
          {/if}
          <button class="x" title="Delete keyframe" disabled={selected.keys.length < 2} onclick={() => removeKey(i)}>×</button>
        </div>
        {#if curveFor === i && typeof k.ease === 'object'}
          <div class="curve"><BezierEditor value={k.ease.bezier} onchange={(v) => setCurve(i, v)} /></div>
        {/if}
      {/each}
      {#if selected.tracked}<p class="muted note">{selected.keys.length} keyframes from tracking.</p>{/if}
    </div>
    <button class="btn ghost danger wide" onclick={() => ondelete(selected)}>Delete overlay</button>
  {:else}
    <h4>Overlays</h4>
    {#if project.layers.length}
      {#each project.layers as l (l.id)}
        <button class="item" onclick={() => onselect(l.id)}>{l.kind === 'blur' ? '◌' : '▣'} {l.name} <span class="muted">{formatTime(l.start, 1)}–{formatTime(l.end, 1)}</span></button>
      {/each}
    {:else}
      <p class="muted note">Drop an image on the video, or use Add image / Blur area in the toolbar.</p>
    {/if}
    <h4>Whole video</h4>
    <div class="grid">
      <label for="pfi">Fade in</label>
      <span class="rng"><input id="pfi" type="range" min="0" max="3" step="0.1" value={project.fadeIn} oninput={(e) => onproject({ ...project, fadeIn: num(e) })} /> {project.fadeIn.toFixed(1)} s</span>
      <label for="pfo">Fade out</label>
      <span class="rng"><input id="pfo" type="range" min="0" max="3" step="0.1" value={project.fadeOut} oninput={(e) => onproject({ ...project, fadeOut: num(e) })} /> {project.fadeOut.toFixed(1)} s</span>
    </div>
    {#if project.speeds.length}
      <h4>Speed changes</h4>
      {#each project.speeds as s, i (i)}
        <div class="item row">
          <span>{s.rate}× <span class="muted">{formatTime(s.a, 1)}–{formatTime(s.b, 1)}</span></span>
          <button class="x" title="Back to normal speed" onclick={() => onproject({ ...project, speeds: project.speeds.filter((_, k) => k !== i) })}>×</button>
        </div>
      {/each}
    {/if}
    {#if project.transitions.length}
      <h4>Transitions</h4>
      {#each project.transitions as t, i (i)}
        <div class="item row">
          <span>{TRANSITIONS.find((x) => x.id === t.kind)?.label} <span class="muted">at {formatTime(t.at, 1)}, {t.dur} s</span></span>
          <button class="x" title="Remove the transition" onclick={() => onproject({ ...project, transitions: project.transitions.filter((_, k) => k !== i) })}>×</button>
        </div>
      {/each}
    {/if}
    <p class="muted note">Transitions: cut a part out, then click the ⧉ marker on the timeline where the parts meet.</p>
  {/if}
</aside>

<style>
  .fxpanel {
    width: 270px;
    flex: none;
    overflow-y: auto;
    padding: 6px 12px 12px;
    border-left: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
    font-size: var(--fs-small);
  }
  .head {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  h4 {
    margin: 12px 0 6px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 4px 8px;
    align-items: center;
  }
  .rng {
    display: flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  .rng input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .btns,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    border: none;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .sm {
    padding: 2px 8px;
    font-size: var(--fs-small);
  }
  .wide {
    width: 100%;
    margin-top: 8px;
    justify-content: center;
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 8px;
  }
  .keys {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 260px;
    overflow-y: auto;
  }
  .key {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .key.here .t {
    color: var(--accent-text);
  }
  .key select {
    flex: 1;
    min-width: 0;
  }
  .t {
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0 2px;
  }
  .mono {
    font-variant-numeric: tabular-nums;
  }
  .x {
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: calc(14px * var(--ui-scale));
  }
  .curve {
    padding: 4px 0 8px 14px;
  }
  .item {
    display: flex;
    width: 100%;
    gap: 6px;
    text-align: left;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    padding: 4px 2px;
    border-radius: 4px;
    cursor: pointer;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .item.row {
    justify-content: space-between;
    cursor: default;
  }
  .muted {
    color: var(--text-muted);
  }
  .note {
    margin: 6px 0;
  }
  .danger {
    color: var(--danger);
  }
</style>
