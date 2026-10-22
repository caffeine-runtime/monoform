<script lang="ts">
  // Page thumbnails: rendered lazily when scrolled into view; click/Ctrl/Shift
  // to select; drag to reorder (a multi-selection moves as a block).
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { clickSelect, moveOrder, isIdentity } from './pages';
  import { t } from '../../core/i18n';

  let {
    doc,
    current,
    selected = $bindable([]),
    onnavigate,
    onreorder,
    onmenu,
  }: {
    doc: PDFDocumentProxy;
    current: number;
    selected: number[];
    onnavigate: (p: number) => void;
    onreorder: (order: number[]) => void;
    onmenu: (e: MouseEvent, p: number) => void;
  } = $props();

  const WIDTH = 132;
  let list = $state<HTMLDivElement>();
  let anchor = 0;
  let dropAt = $state(-1);
  let dragging: number[] = [];
  const pages = $derived(Array.from({ length: doc.numPages }, (_, i) => i + 1));
  const rendered = new Map<number, HTMLCanvasElement>();
  let observer: IntersectionObserver | null = null;
  let generation = 0;

  async function render(el: HTMLElement, p: number, gen: number) {
    if (rendered.has(p)) return;
    const page = await doc.getPage(p);
    if (gen !== generation) return;
    const vp0 = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (WIDTH / vp0.width) * dpr;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${Math.round(vp.height / dpr)}px`;
    rendered.set(p, canvas);
    try {
      await page.render({ canvas, viewport: vp }).promise;
    } catch {
      rendered.delete(p);
      return;
    }
    if (gen !== generation) return;
    const holder = el.querySelector('.img');
    holder?.replaceChildren(canvas);
  }

  function observe(el: HTMLElement, p: number) {
    el.dataset.page = String(p);
    observer?.observe(el);
    return { destroy: () => observer?.unobserve(el) };
  }

  $effect(() => {
    // New document (after a page operation): drop old renders.
    void doc;
    generation++;
    rendered.clear();
    const gen = generation;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) void render(e.target as HTMLElement, Number((e.target as HTMLElement).dataset.page), gen);
      },
      { root: list, rootMargin: '400px 0px' },
    );
    queueMicrotask(() => list?.querySelectorAll<HTMLElement>('.thumb').forEach((el) => observer?.observe(el)));
  });

  $effect(() => {
    // Keep the current page visible.
    const el = list?.querySelector(`[data-page="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });

  onMount(() => () => observer?.disconnect());

  function click(e: MouseEvent, p: number) {
    const r = clickSelect(selected, anchor, p, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
    selected = r.sel;
    anchor = r.anchor;
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) onnavigate(p);
  }

  function dragStart(e: DragEvent, p: number) {
    dragging = selected.includes(p) ? [...selected] : [p];
    if (!selected.includes(p)) selected = [p];
    e.dataTransfer?.setData('text/plain', 'pages');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function dragOver(e: DragEvent, i: number) {
    if (!dragging.length) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = e.clientY < r.top + r.height / 2 ? i : i + 1;
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    if (dragging.length && dropAt >= 0) {
      const order = moveOrder(doc.numPages, dragging, dropAt);
      if (!isIdentity(order)) onreorder(order);
    }
    dragging = [];
    dropAt = -1;
  }
</script>

<div class="thumbs" bind:this={list} role="listbox" aria-label={t('Pages')} aria-multiselectable="true" ondragover={(e) => e.preventDefault()} ondrop={drop}>
  {#each pages as p, i (p)}
    <div
      class="thumb"
      class:current={p === current}
      class:selected={selected.includes(p)}
      class:drop-before={dropAt === i}
      class:drop-after={dropAt === i + 1 && i === pages.length - 1}
      role="option"
      tabindex="-1"
      aria-selected={selected.includes(p)}
      draggable="true"
      use:observe={p}
      onclick={(e) => click(e, p)}
      onkeydown={(e) => e.key === 'Enter' && onnavigate(p)}
      oncontextmenu={(e) => {
        if (!selected.includes(p)) selected = [p];
        onmenu(e, p);
      }}
      ondragstart={(e) => dragStart(e, p)}
      ondragover={(e) => dragOver(e, i)}
      ondragend={() => {
        dragging = [];
        dropAt = -1;
      }}
    >
      <div class="img"></div>
      <div class="num">{p}</div>
    </div>
  {/each}
</div>

<style>
  .thumbs {
    width: 176px;
    flex: none;
    overflow-y: auto;
    padding: 12px 10px 24px;
    background: var(--bg-sidebar);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .thumb {
    position: relative;
    padding: 8px 8px 4px;
    border-radius: var(--radius);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .thumb:hover {
    background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  }
  .thumb.selected {
    background: var(--bg-hover);
  }
  .thumb.current .img {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .img {
    width: 132px;
    min-height: 60px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    display: flex;
  }
  .img :global(canvas) {
    display: block;
    border-radius: 2px;
  }
  .num {
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .drop-before::before,
  .drop-after::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 3px;
    border-radius: 3px;
    background: var(--accent);
  }
  .drop-before::before {
    top: -4px;
  }
  .drop-after::after {
    bottom: -4px;
  }
</style>
