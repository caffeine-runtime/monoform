<script lang="ts" module>
  // The ratio each kind of split (Markdown, HTML, …) was last left at.
  export function savedRatio(key: string): number {
    try {
      const v = Number(localStorage.getItem(`hia.split.${key}`));
      if (v >= MIN && v <= MAX) return v;
    } catch {
      /* no storage */
    }
    return 0.5;
  }
  const MIN = 0.15;
  const MAX = 0.85;
</script>

<script lang="ts">
  // A draggable divider between the two halves of an editor's split view
  // (source | preview). The first half gets `ratio` of the width; drag,
  // arrow keys or double-click (back to 50 %) change it.
  let { ratio = $bindable(0.5), key }: { ratio?: number; key: string } = $props();

  let el = $state<HTMLDivElement>();
  let dragging = $state(false);

  function set(v: number) {
    ratio = Math.min(MAX, Math.max(MIN, v));
  }
  function save() {
    try {
      localStorage.setItem(`hia.split.${key}`, String(ratio));
    } catch {
      /* no storage */
    }
  }
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    el!.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    const r = el!.parentElement!.getBoundingClientRect();
    set((e.clientX - r.left) / r.width);
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    save();
  }
  function key_(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') set(ratio - step);
    else if (e.key === 'ArrowRight') set(ratio + step);
    else if (e.key === 'Home') set(MIN);
    else if (e.key === 'End') set(MAX);
    else return;
    e.preventDefault();
    save();
  }
</script>

<!-- A focusable separator is the ARIA pattern for a resizable divider. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="divider"
  class:dragging
  bind:this={el}
  role="separator"
  aria-orientation="vertical"
  aria-valuemin={MIN * 100}
  aria-valuemax={MAX * 100}
  aria-valuenow={Math.round(ratio * 100)}
  aria-label="Resize editor and preview"
  tabindex="0"
  title="Drag to resize · double-click: 50 / 50"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={() => (set(0.5), save())}
  onkeydown={key_}
>
  <span class="grip"></span>
  {#if dragging}<span class="pct">{Math.round(ratio * 100)} % · {Math.round((1 - ratio) * 100)} %</span>{/if}
</div>

<style>
  .divider {
    flex: none;
    width: 7px;
    margin: 0 -3px;
    position: relative;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
    display: grid;
    place-items: center;
  }
  .divider::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: var(--border-soft);
  }
  .divider:hover::before,
  .divider.dragging::before,
  .divider:focus-visible::before {
    left: 2px;
    width: 3px;
    background: var(--accent);
  }
  .divider:focus-visible {
    outline: none;
  }
  .grip {
    position: relative;
    width: 5px;
    height: 28px;
    border-radius: 3px;
    background: var(--border);
  }
  .divider:hover .grip,
  .divider.dragging .grip {
    background: var(--accent);
  }
  .pct {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: var(--fs-small);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    pointer-events: none;
  }
</style>
