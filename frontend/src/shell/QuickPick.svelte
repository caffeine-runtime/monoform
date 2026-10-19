<script lang="ts">
  import { fuzzyFilter, highlightSegments } from '../core/fuzzy';
  import { ui } from '../core/ui.svelte';

  let query = $state('');
  let selected = $state(0);
  let input: HTMLInputElement;
  const req = $derived(ui.picker!);
  const list = $derived(fuzzyFilter(query, req.items, (i) => i.label));

  $effect(() => {
    input?.focus();
  });
  $effect(() => {
    void query;
    selected = 0;
  });

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') selected = Math.min(list.length - 1, selected + 1);
    else if (e.key === 'ArrowUp') selected = Math.max(0, selected - 1);
    else if (e.key === 'Enter') req.resolve(list[selected]?.item.id ?? null);
    else if (e.key === 'Escape') req.resolve(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => req.resolve(null)}>
  <div class="palette" role="dialog" tabindex="-1" aria-label={req.title} onclick={(e) => e.stopPropagation()}>
    <input bind:this={input} bind:value={query} class="q" placeholder={req.title} spellcheck="false" onkeydown={key} />
    <div class="list" role="listbox">
      {#each list as r, i (r.item.id)}
        <div class="item" class:sel={i === selected} role="option" tabindex="-1" aria-selected={i === selected} onmousemove={() => (selected = i)} onclick={() => req.resolve(r.item.id)}>
          <span class="label">{#each highlightSegments(r.item.label, r.match.positions) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}</span>
          {#if r.item.detail}<span class="detail">{r.item.detail}</span>{/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.18);
  }
  .palette {
    width: min(520px, calc(100vw - 32px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .q {
    height: 44px;
    border: none;
    outline: none;
    padding: 0 16px;
    background: transparent;
    font-size: 14px;
    border-bottom: 1px solid var(--border-soft);
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .item.sel {
    background: var(--bg-hover);
  }
  mark {
    background: none;
    color: var(--accent-text);
    font-weight: 600;
  }
  .detail {
    margin-left: auto;
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
</style>
