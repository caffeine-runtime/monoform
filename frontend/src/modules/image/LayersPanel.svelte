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
  import { t } from '../../core/i18n';
  import type { Blend, EditorState, ImageEditor } from './editor';

  let { editor, es }: { editor: ImageEditor; es: EditorState } = $props();

  const BLENDS: { id: Blend; label: string }[] = [
    { id: 'source-over', label: t('Normal', {}, 'blend') },
    { id: 'multiply', label: t('Multiply', {}, 'blend') },
    { id: 'screen', label: t('Screen', {}, 'blend') },
    { id: 'overlay', label: t('Overlay', {}, 'blend') },
    { id: 'darken', label: t('Darken', {}, 'blend') },
    { id: 'lighten', label: t('Lighten', {}, 'blend') },
    { id: 'soft-light', label: t('Soft light', {}, 'blend') },
    { id: 'hard-light', label: t('Hard light', {}, 'blend') },
    { id: 'difference', label: t('Difference', {}, 'blend') },
    { id: 'color-dodge', label: t('Colour dodge', {}, 'blend') },
    { id: 'color-burn', label: t('Colour burn', {}, 'blend') },
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
      const tc = document.createElement('canvas');
      tc.width = node.width;
      tc.height = node.height;
      const tg = tc.getContext('2d')!;
      tg.fillStyle = '#fff';
      tg.fillRect(0, 0, tc.width, tc.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(m, (node.width - w) / 2, (node.height - h) / 2, w, h);
      g.drawImage(tc, 0, 0);
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
          { label: t('Show all (paint to hide)'), run: () => editor.addMask('show') },
          { label: t('Hide all (paint to show)'), run: () => editor.addMask('hide') },
          { label: t('Show only the selection'), disabled: !sel, run: () => editor.addMask('selection') },
        ]
      : [
          { label: es.editMask ? t('Paint on the pixels') : t('Paint on the mask'), run: () => editor.setEditMask(!es.editMask) },
          { separator: true },
          { label: sel ? t('Hide the selection') : t('Hide everything'), run: () => editor.fillMask(false) },
          { label: sel ? t('Show the selection') : t('Show everything'), run: () => editor.fillMask(true) },
          { label: t('Invert the mask'), run: () => editor.invertMask() },
          { separator: true },
          { label: active.maskOn ? t('Turn the mask off') : t('Turn the mask on'), run: () => editor.toggleMask() },
          { label: t('Apply the mask (erase what it hides)'), run: () => editor.applyMask() },
          { label: t('Delete the mask'), run: () => editor.deleteMask() },
        ];
    menu.show({ clientX: r.left, clientY: r.top - 4 }, items);
  }

  // Drag a layer up or down the list to put it elsewhere in the stack.
  let list = $state<HTMLDivElement>();
  let drag = $state<{ id: string; from: number; slot: number; moved: boolean } | null>(null);
  let justDragged = false;

  /** The gap (0 = above the top row … n = below the last) nearest the pointer. */
  function slotAt(y: number): number {
    const rows = [...list!.querySelectorAll<HTMLElement>('.layer')];
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  }

  function dragStart(e: PointerEvent, id: string, from: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const y0 = e.clientY;
    const row = e.currentTarget as HTMLElement;
    const move = (m: PointerEvent) => {
      if (!drag) {
        if (Math.abs(m.clientY - y0) < 4) return;
        drag = { id, from, slot: from, moved: true };
        try {
          row.setPointerCapture(m.pointerId);
        } catch {
          /* synthetic events */
        }
      }
      drag.slot = slotAt(m.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!drag) return;
      const d = drag;
      drag = null;
      justDragged = true;
      setTimeout(() => (justDragged = false));
      // Rows are listed top first; the stack is bottom first.
      const to = d.slot > d.from ? d.slot - 1 : d.slot;
      if (to !== d.from) editor.placeLayer(d.id, es.layers.length - 1 - to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function rename(id: string, name: string) {
    const n = await ui.prompt(t('Layer name'), name, t('Rename'));
    if (n && n !== name) editor.setLayerProps(id, { name: n });
  }
</script>

<div class="layers">
  <div class="list" role="listbox" aria-label={t('Layers')} bind:this={list} class:dragging={!!drag}>
    {#each top as l, i (l.id)}
      <div
        class="layer"
        class:active={l.id === es.activeId}
        class:lifted={drag?.id === l.id}
        class:drop-before={drag && drag.slot === i && drag.slot !== drag.from && drag.slot !== drag.from + 1}
        class:drop-after={drag && i === top.length - 1 && drag.slot === top.length && drag.from !== top.length - 1}
        role="option"
        aria-selected={l.id === es.activeId}
        tabindex="-1"
        title={t('Drag to move it up or down')}
        onpointerdown={(e) => dragStart(e, l.id, i)}
        onclick={() => !justDragged && editor.setActive(l.id)} ondblclick={() => rename(l.id, l.name)} onkeydown={() => {}}>
        <button class="icon-btn xs eye" title={l.visible ? t('Hide layer') : t('Show layer')} aria-label={l.visible ? t('Hide {name}', { name: l.name }) : t('Show {name}', { name: l.name })} onclick={(e) => (e.stopPropagation(), editor.setLayerProps(l.id, { visible: !l.visible }))}>
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
            title={l.maskOn ? t('Mask: shown parts are white (click to paint on it, Shift+click to turn it off)') : t('Mask: shown parts are white (click to paint on it, Shift+click to turn it on)')}
            use:maskThumb={{ id: l.id, v: es.version }}
            onclick={(e) => pick(e, l.id, true)}
          ></canvas>
        {/if}
        <span class="name" title={t('{name} (double-click to rename)', { name: l.name })}>{l.name}</span>
        {#if l.opacity < 1}<span class="op">{Math.round(l.opacity * 100)}%</span>{/if}
      </div>
    {/each}
  </div>
  {#if active?.mask && es.editMask}
    <p class="masknote">{editor.opts.maskHide ? t('Painting the mask: the brush hides, the eraser shows.') : t('Painting the mask: the brush shows, the eraser hides.')}</p>
  {/if}
  {#if active}
    <div class="props">
      <label class="row">
        <span>{t('Opacity')}</span>
        <input type="range" min="0" max="100" value={Math.round(active.opacity * 100)} oninput={(e) => editor.setLayerProps(active.id, { opacity: +(e.target as HTMLInputElement).value / 100 }, false)} onchange={(e) => editor.setLayerProps(active.id, { opacity: +(e.target as HTMLInputElement).value / 100 })} />
        <span class="num">{Math.round(active.opacity * 100)}%</span>
      </label>
      <label class="row">
        <span>{t('Blend')}</span>
        <select value={active.blend} onchange={(e) => editor.setLayerProps(active.id, { blend: (e.target as HTMLSelectElement).value as Blend })}>
          {#each BLENDS as b (b.id)}<option value={b.id}>{b.label}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
  <div class="actions">
    <button class="icon-btn" title={t('New layer')} onclick={() => editor.addLayer()}><Icon icon={Plus} size={15} /></button>
    <button class="icon-btn" title={t('Duplicate layer')} onclick={() => editor.duplicateLayer()}><Icon icon={Copy} size={15} /></button>
    <button class="icon-btn" title={t('Move up')} disabled={activeIndex >= es.layers.length - 1} onclick={() => editor.moveLayer(es.activeId, 1)}><Icon icon={ArrowUp} size={15} /></button>
    <button class="icon-btn" title={t('Move down')} disabled={activeIndex <= 0} onclick={() => editor.moveLayer(es.activeId, -1)}><Icon icon={ArrowDown} size={15} /></button>
    <button class="icon-btn" class:on={active?.mask} title={active?.mask ? t('Mask…') : t('Add a mask: hide parts of the layer without erasing them')} onclick={maskMenu}><Icon icon={Contrast} size={15} /></button>
    <button class="icon-btn" title={t('Merge down')} disabled={activeIndex <= 0} onclick={() => editor.mergeDown()}><Icon icon={Merge} size={15} /></button>
    <button class="icon-btn" title={t('Delete layer')} disabled={es.layers.length < 2} onclick={() => editor.deleteLayer()}><Icon icon={Trash} size={15} /></button>
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
    position: relative;
    touch-action: none;
  }
  .list.dragging .layer {
    cursor: grabbing;
  }
  .layer.lifted {
    opacity: 0.45;
  }
  .layer.drop-before::before,
  .layer.drop-after::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .layer.drop-before::before {
    top: -2px;
  }
  .layer.drop-after::after {
    bottom: -2px;
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
