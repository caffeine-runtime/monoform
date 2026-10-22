<script lang="ts">
  // While something is dragged from one view to another: a chip under the
  // pointer saying what it is and whether the view below takes it, and an
  // outline around that view. Hovering a tab in the tab bar brings it up, so
  // a tab that isn't showing can still be the target.
  import { describe, transferDrag } from '../core/transfer.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { t } from '../core/i18n';

  const item = $derived(transferDrag.item);
  // A small picture of an image being dragged (made once per drag).
  const thumb = $derived.by(() => {
    const t = item?.t;
    if (t?.kind !== 'image') return '';
    const k = Math.min(1, 72 / Math.max(t.image.width, t.image.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(t.image.width * k));
    c.height = Math.max(1, Math.round(t.image.height * k));
    c.getContext('2d')!.drawImage(t.image, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
  const target = $derived(transferDrag.over ? workspace.tabs.find((t) => t.id === transferDrag.over!.id) : undefined);
  const box = $derived.by(() => {
    if (!target) return null;
    void transferDrag.x; // re-measure while moving (split panes, a tab brought up)
    return document.querySelector(`.tabview[data-tab-id="${target.id}"]`)?.getBoundingClientRect() ?? null;
  });

  let hoverTab = '';
  let hoverTimer = 0;
  $effect(() => {
    if (!item) return;
    const el = document.elementFromPoint(transferDrag.x, transferDrag.y)?.closest<HTMLElement>('.tabbar .tab[data-tab]');
    const id = el?.dataset.tab ?? '';
    if (id === hoverTab) return;
    hoverTab = id;
    clearTimeout(hoverTimer);
    if (id)
      hoverTimer = window.setTimeout(() => {
        const t = workspace.tabs.find((x) => x.id === id);
        if (t && transferDrag.item) workspace.activate(t);
      }, 450);
  });
</script>

{#if item}
  {#if box && target}
    <div class="xfer-target" class:no={!transferDrag.over?.ok} style:left="{box.left}px" style:top="{box.top}px" style:width="{box.width}px" style:height="{box.height}px"></div>
  {/if}
  <div class="xfer-chip" style:left="{Math.min(transferDrag.x + 14, innerWidth - 280)}px" style:top="{Math.min(transferDrag.y + 16, innerHeight - 60)}px" aria-hidden="true">
    {#if thumb}<span class="thumb" style:background-image="url({thumb})"></span>{/if}
    <span class="what">{describe(item.t)}</span>
    {#if target}<span class="hint">{transferDrag.over?.ok ? t('Drop into {name}', { name: target.title }) : t('{name} can’t take this', { name: target.title })}</span>
    {:else}<span class="hint muted">{t('Drop on another tab’s view, or hover a tab to bring it up')}</span>{/if}
  </div>
{/if}

<style>
  .xfer-target {
    position: fixed;
    z-index: 450;
    pointer-events: none;
    border: 2px solid var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .xfer-target.no {
    border-color: var(--text-faint);
    border-style: dashed;
    background: transparent;
  }
  .xfer-chip {
    position: fixed;
    z-index: 500;
    pointer-events: none;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    align-items: center;
    max-width: 280px;
    padding: 6px 10px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow);
    font-size: var(--fs-small);
  }
  .thumb {
    grid-row: span 2;
    width: 36px;
    height: 28px;
    border-radius: 4px;
    background: center / contain no-repeat var(--bg-hover);
  }
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    color: var(--accent-text);
  }
  .muted {
    color: var(--text-muted);
  }
</style>
