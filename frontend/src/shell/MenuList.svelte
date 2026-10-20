<script lang="ts">
  // One level of a menu: items, separators and submenus (▸). A submenu opens
  // beside its item on hover (after a short pause, so passing over doesn't
  // flicker), on click, Enter or →; ← or Escape goes back a level.
  import Self from './MenuList.svelte';
  import { menu, ui, type MenuItem } from '../core/ui.svelte';

  let {
    items,
    x,
    y,
    anchor = null,
    onback,
  }: {
    items: MenuItem[];
    x: number;
    y: number;
    /** The parent item's box (submenus): open to its right, or left if there's no room. */
    anchor?: DOMRect | null;
    onback?: () => void;
  } = $props();

  let el = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let sel = $state(-1);
  let child = $state<{ i: number; rect: DOMRect; focus: boolean } | null>(null);
  let timer = 0;

  $effect(() => {
    pos = { x, y };
    queueMicrotask(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (anchor) {
        const right = anchor.right - 2;
        pos = {
          x: right + r.width <= innerWidth - 4 ? right : Math.max(4, anchor.left - r.width + 2),
          y: Math.max(4, Math.min(anchor.top - 5, innerHeight - r.height - 4)),
        };
      } else {
        pos = {
          x: Math.max(4, Math.min(x, innerWidth - r.width - 4)),
          y: Math.max(4, y + r.height > innerHeight - 4 ? y - r.height : y),
        };
      }
      el.focus();
    });
  });

  const enabled = $derived(items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0));

  function openChild(i: number, focus: boolean) {
    clearTimeout(timer);
    const btn = el?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!btn || !items[i].items) return;
    child = { i, rect: btn.getBoundingClientRect(), focus };
  }

  function hover(i: number) {
    sel = i;
    clearTimeout(timer);
    if (child?.i === i) return;
    timer = window.setTimeout(() => {
      if (items[i].items) openChild(i, false);
      else child = null;
    }, 140);
  }

  function activate(i: number) {
    const it = items[i];
    if (it.disabled) return;
    if (it.items) {
      openChild(i, true);
      return;
    }
    menu.close();
    void Promise.resolve(it.run?.()).catch((e) => ui.toast(String(e?.message ?? e), 'error'));
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && onback)) {
      if (onback) onback();
      else menu.close();
    } else if (e.key === 'ArrowDown') sel = enabled.find((i) => i > sel) ?? enabled[0];
    else if (e.key === 'ArrowUp') sel = [...enabled].reverse().find((i) => i < sel) ?? enabled[enabled.length - 1];
    else if ((e.key === 'Enter' || e.key === ' ') && sel >= 0) activate(sel);
    else if (e.key === 'ArrowRight' && sel >= 0 && items[sel].items) openChild(sel, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function back() {
    child = null;
    el?.focus();
  }
</script>

<div class="menu" class:sub={!!anchor} bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" role="menu" tabindex="-1" onkeydown={key} onmouseleave={() => clearTimeout(timer)}>
  {#each items as it, i}
    {#if it.separator}
      {#if i > 0 && i < items.length - 1}<div class="msep"></div>{/if}
    {:else}
      <button
        class="mi"
        class:sel={sel === i}
        class:open={child?.i === i}
        data-i={i}
        disabled={it.disabled}
        role="menuitem"
        aria-haspopup={it.items ? 'menu' : undefined}
        aria-expanded={it.items ? child?.i === i : undefined}
        onmousemove={() => sel !== i && hover(i)}
        onmouseenter={() => hover(i)}
        onclick={() => activate(i)}
      >
        <span>{it.label}</span>
        {#if it.items}<span class="arrow" aria-hidden="true">›</span>{:else if it.shortcut}<span class="sc">{it.shortcut}</span>{/if}
      </button>
    {/if}
  {/each}
</div>
{#if child}
  {#key child.i}
    <Self items={items[child.i].items ?? []} x={0} y={0} anchor={child.rect} onback={back} />
  {/key}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 301;
    min-width: calc(200px * var(--ui-scale));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 5px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    outline: none;
  }
  .menu.sub {
    z-index: 302;
  }
  .mi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    width: 100%;
    height: calc(28px * var(--ui-scale));
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .mi.sel,
  .mi.open {
    background: var(--bg-hover);
  }
  .mi:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .sc {
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .arrow {
    color: var(--text-muted);
    font-size: 1.15em;
    line-height: 1;
  }
  .msep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border-soft);
  }
</style>
