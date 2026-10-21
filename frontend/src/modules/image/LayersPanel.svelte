<script lang="ts">
  // Layer list: top layer first, like every image editor. A layer with a
  // mask shows it beside its thumbnail: click either to paint on it.
  import Icon from '../../shell/Icon.svelte';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Merge from '@lucide/svelte/icons/merge';
  import Contrast from '@lucide/svelte/icons/contrast';
  import { menu, ui, type MenuItem } from '../../core/ui.svelte';
  import type { Blend, EditorState, ImageEditor } from './editor';

  let { editor, es }: { editor: ImageEditor; es: EditorState } = $props();

  const BLENDS: { id: Blend; label: string }[] = [
    { id: 'source-over', label: 'Normal' },
    { id: 'multiply', label: 'Multiply' },
    { id: 'screen', label: 'Screen' },
    { id: 'overlay', label: 'Overlay' },
    { id: 'darken', label: 'Darken' },
    { id: 'lighten', label: 'Lighten' },
    { id: 'soft-light', label: 'Soft light' },
    { id: 'hard-light', label: 'Hard light' },
    { id: 'difference', label: 'Difference' },
    { id: 'color-dodge', label: 'Colour dodge' },
    { id: 'color-burn', label: 'Colour burn' },
  ];

  const top = $derived([...es.layers].reverse());
  const active = $derived(es.layers.find((l) => l.id === es.activeId));
  const activeIndex = $derived(es.layers.findIndex((l) => l.id === es.activeId));

  /** Draw a layer thumbnail (re-run, debounced, when the document changes). */
  function thumb(node: HTMLCanvasElement, args: { id: string; v: number }) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (a: { id: string; v: number }) => {
      const src = editor.layerPreview(a.id);
      const g = node.getContext('2d')!;
      g.clearRect(0, 0, node.width, node.height);
      if (!src) return;
      const k = Math.min(node.width / src.width, node.height / src.height);
      const w = src.width * k;
      const h = src.height * k;
      g.imageSmoothingQuality = 'medium';
      g.drawImage(src, (node.width - w) / 2, (node.height - h) / 2, w, h);
    };
    draw(args);
    return {
      update: (a: { id: string; v: number }) => {
        clearTimeout(timer);
        timer = setTimeout(() => draw(a), 250);
      },
      destroy: () => clearTimeout(timer),
    };
  }

  /** Draw a mask thumbnail: shown parts white on black. */
  function maskThumb(node: HTMLCanvasElement, args: { id: string; v: number }) {
    const draw = (a: { id: string; v: number }) => {
      const m = editor.layerMask(a.id);
      const g = node.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, node.width, node.height);
      if (!m) return;
      const k = Math.min(node.width / m.width, node.height / m.height);
      const w = m.width * k;
      const h = m.height * k;
      const t = document.createElement('canvas');
      t.width = node.width;
      t.height = node.height;
      const tg = t.getContext('2d')!;
      tg.fillStyle = '#fff';
      tg.fillRect(0, 0, t.width, t.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(m, (node.width - w) / 2, (node.height - h) / 2, w, h);
      g.drawImage(t, 0, 0);
    };
    draw(args);
    return { update: draw };
  }

  function pick(e: MouseEvent, id: string, mask: boolean) {
    e.stopPropagation();
    editor.setActive(id);
    if (mask && e.shiftKey) editor.toggleMask();
    else editor.setEditMask(mask);
  }

  function maskMenu(e: MouseEvent) {
    if (!active) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sel = !!es.pixelSelection;
    const items: MenuItem[] = !active.mask
      ? [
          { label: 'Show all (paint to hide)', run: () => editor.addMask('show') },
          { label: 'Hide all (paint to show)', run: () => editor.addMask('hide') },
          { label: 'Show only the selection', disabled: !sel, run: () => editor.addMask('selection') },
        ]
      : [
          { label: es.editMask ? 'Paint on the pixels' : 'Paint on the mask', run: () => editor.setEditMask(!es.editMask) },
          { separator: true },
          { label: sel ? 'Hide the selection' : 'Hide everything', run: () => editor.fillMask(false) },
          { label: sel ? 'Show the selection' : 'Show everything', run: () => editor.fillMask(true) },
          { label: 'Invert the mask', run: () => editor.invertMask() },
          { separator: true },
          { label: active.maskOn ? 'Turn the mask off' : 'Turn the mask on', run: () => editor.toggleMask() },
          { label: 'Apply the mask (erase what it hides)', run: () => editor.applyMask() },
          { label: 'Delete the mask', run: () => editor.deleteMask() },
        ];
    menu.show({ clientX: r.left, clientY: r.top - 4 }, items);
  }

  async function rename(id: string, name: string) {
    const n = await ui.prompt('Layer name', name, 'Rename');
    if (n && n !== name) editor.setLayerProps(id, { name: n });
  }
</script>

<div class="layers">
  <div class="list" role="listbox" aria-label="Layers">
    {#each top as l (l.id)}
      <div class="layer" class:active={l.id === es.activeId} role="option" aria-selected={l.id === es.activeId} tabindex="-1" onclick={() => editor.setActive(l.id)} ondblclick={() => rename(l.id, l.name)} onkeydown={() => {}}>
        <button class="icon-btn xs eye" title={l.visible ? 'Hide layer' : 'Show layer'} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onclick={(e) => (e.stopPropagation(), editor.setLayerProps(l.id, { visible: !l.visible }))}>
          <Icon icon={l.visible ? Eye : EyeOff} size={13} />
        </button>
        <canvas class="thumb checker-sm" class:target={l.id === es.activeId && l.mask && !es.editMask} width="40" height="30" use:thumb={{ id: l.id, v: es.version }} onclick={(e) => pick(e, l.id, false)}></canvas>
        {#if l.mask}
          <canvas
            class="thumb mask"
            class:target={l.id === es.activeId && es.editMask}
            class:off={!l.maskOn}
            width="40"
            height="30"
            title="Mask: shown parts are white (click to paint on it, Shift+click to turn it {l.maskOn ? 'off' : 'on'})"
            use:maskThumb={{ id: l.id, v: es.version }}
            onclick={(e) => pick(e, l.id, true)}
          ></canvas>
        {/if}
        <span class="name" title="{l.name} (double-click to rename)">{l.name}</span>
        {#if l.opacity < 1}<span class="op">{Math.round(l.opacity * 100)}%</span>{/if}
      </div>
    {/each}
  </div>
  {#if active?.mask && es.editMask}
    <p class="masknote">Painting the mask: the brush {editor.opts.maskHide ? 'hides' : 'shows'}, the eraser {editor.opts.maskHide ? 'shows' : 'hides'}.</p>
  {/if}
  {#if active}
    <div class="props">
      <label class="row">
        <span>Opacity</span>
        <input type="range" min="0" max="100" value={Math.round(active.opacity * 100)} oninput={(e) => editor.setLayerProps(active.id, { opacity: +(e.target as HTMLInputElement).value / 100 }, false)} onchange={(e) => editor.setLayerProps(active.id, { opacity: +(e.target as HTMLInputElement).value / 100 })} />
        <span class="num">{Math.round(active.opacity * 100)}%</span>
      </label>
      <label class="row">
        <span>Blend</span>
        <select value={active.blend} onchange={(e) => editor.setLayerProps(active.id, { blend: (e.target as HTMLSelectElement).value as Blend })}>
          {#each BLENDS as b (b.id)}<option value={b.id}>{b.label}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
  <div class="actions">
    <button class="icon-btn" title="New layer" onclick={() => editor.addLayer()}><Icon icon={Plus} size={15} /></button>
    <button class="icon-btn" title="Duplicate layer" onclick={() => editor.duplicateLayer()}><Icon icon={Copy} size={15} /></button>
    <button class="icon-btn" title="Move up" disabled={activeIndex >= es.layers.length - 1} onclick={() => editor.moveLayer(es.activeId, 1)}><Icon icon={ArrowUp} size={15} /></button>
    <button class="icon-btn" title="Move down" disabled={activeIndex <= 0} onclick={() => editor.moveLayer(es.activeId, -1)}><Icon icon={ArrowDown} size={15} /></button>
    <button class="icon-btn" class:on={active?.mask} title={active?.mask ? 'Mask…' : 'Add a mask: hide parts of the layer without erasing them'} onclick={maskMenu}><Icon icon={Contrast} size={15} /></button>
    <button class="icon-btn" title="Merge down" disabled={activeIndex <= 0} onclick={() => editor.mergeDown()}><Icon icon={Merge} size={15} /></button>
    <button class="icon-btn" title="Delete layer" disabled={es.layers.length < 2} onclick={() => editor.deleteLayer()}><Icon icon={Trash} size={15} /></button>
  </div>
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .layer:hover {
    background: var(--bg-hover);
  }
  .layer.active {
    background: var(--accent-soft);
  }
  .thumb {
    width: 40px;
    height: 30px;
    border-radius: 3px;
    flex: none;
    box-shadow: 0 0 0 1px var(--border-soft);
  }
  .thumb.target {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .thumb.mask.off {
    opacity: 0.35;
  }
  .masknote {
    margin: 0;
    padding: 6px 10px;
    border-top: 1px solid var(--border-soft);
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .checker-sm {
    background-color: var(--checker-b);
    background-image: linear-gradient(45deg, var(--checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-a) 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .op {
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .props {
    padding: 8px 10px;
    border-top: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .row span:first-child {
    width: 52px;
  }
  .row input[type='range'] {
    accent-color: var(--accent);
  }
  .row input[type='range'],
  .row select {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 36px;
    text-align: right;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    padding: 6px 8px;
    border-top: 1px solid var(--border-soft);
  }
</style>
