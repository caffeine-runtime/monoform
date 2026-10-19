<script lang="ts">
  // Dialog, toasts and context menu.
  import Icon from './Icon.svelte';
  import { AlertTriangle, Check, Info, X } from '../core/icons';
  import { menu, ui } from '../core/ui.svelte';
  import { formatShortcut } from '../core/keys';

  let inputValue = $state('');
  let inputEl = $state<HTMLInputElement>();
  let dialogEl = $state<HTMLDivElement>();
  let menuEl = $state<HTMLDivElement>();
  let menuPos = $state({ x: 0, y: 0 });
  let menuSel = $state(-1);

  $effect(() => {
    const d = ui.dialog;
    if (!d) return;
    inputValue = d.input?.value ?? '';
    queueMicrotask(() => {
      if (inputEl) {
        inputEl.focus();
        const v = inputEl.value;
        const dot = v.lastIndexOf('.');
        if (d.input?.selectStem && dot > 0) inputEl.setSelectionRange(0, dot);
        else inputEl.select();
      } else {
        dialogEl?.querySelector<HTMLButtonElement>('button.primary, button:last-child')?.focus();
      }
    });
  });

  $effect(() => {
    const m = menu.open;
    if (!m) return;
    menuSel = -1;
    menuPos = { x: m.x, y: m.y };
    queueMicrotask(() => {
      if (!menuEl) return;
      const r = menuEl.getBoundingClientRect();
      menuPos = {
        x: Math.max(4, Math.min(m.x, innerWidth - r.width - 4)),
        y: Math.max(4, m.y + r.height > innerHeight - 4 ? m.y - r.height : m.y),
      };
      menuEl.focus();
    });
  });

  function dialogKey(e: KeyboardEvent) {
    const d = ui.dialog;
    if (!d) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      d.resolve({ button: 'cancel' });
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      const primary = d.buttons.find((b) => b.primary) ?? d.buttons[d.buttons.length - 1];
      d.resolve({ button: primary.id, value: inputValue });
    }
  }

  function menuKey(e: KeyboardEvent) {
    const m = menu.open;
    if (!m) return;
    const enabled = m.items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
    if (e.key === 'Escape') menu.close();
    else if (e.key === 'ArrowDown') menuSel = enabled.find((i) => i > menuSel) ?? enabled[0];
    else if (e.key === 'ArrowUp') menuSel = [...enabled].reverse().find((i) => i < menuSel) ?? enabled[enabled.length - 1];
    else if (e.key === 'Enter' && menuSel >= 0) run(m.items[menuSel]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function run(it: { run?: () => unknown; disabled?: boolean }) {
    if (it.disabled) return;
    menu.close();
    void Promise.resolve(it.run?.()).catch((e) => ui.toast(String(e?.message ?? e), 'error'));
  }
</script>

{#if ui.dialog}
  {@const d = ui.dialog}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="overlay" onclick={() => d.resolve({ button: 'cancel' })} onkeydown={dialogKey}>
    <div class="dialog" bind:this={dialogEl} role="dialog" aria-modal="true" aria-label={d.title} tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2>{d.title}</h2>
      {#if d.message}<p class="msg">{d.message}</p>{/if}
      {#if d.details?.length}
        <ul class="details">
          {#each d.details as line}<li>{line}</li>{/each}
        </ul>
      {/if}
      {#if d.input}
        <input class="input" bind:this={inputEl} bind:value={inputValue} placeholder={d.input.placeholder} spellcheck="false" />
      {/if}
      <div class="buttons">
        {#each d.buttons as b (b.id)}
          <button class="btn" class:primary={b.primary} class:danger={b.danger} onclick={() => d.resolve({ button: b.id, value: inputValue })}>{b.label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if menu.open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="menu-catcher" onclick={() => menu.close()} oncontextmenu={(e) => { e.preventDefault(); menu.close(); }}></div>
  <div class="menu" bind:this={menuEl} style:left="{menuPos.x}px" style:top="{menuPos.y}px" role="menu" tabindex="-1" onkeydown={menuKey}>
    {#each menu.open.items as it, i}
      {#if it.separator}
        {#if i > 0 && i < menu.open.items.length - 1}<div class="msep"></div>{/if}
      {:else}
        <button class="mi" class:sel={menuSel === i} disabled={it.disabled} role="menuitem" onmousemove={() => (menuSel = i)} onclick={() => run(it)}>
          <span>{it.label}</span>
          {#if it.shortcut}<span class="sc">{it.shortcut}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<div class="toasts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <span class="ti">
        {#if t.kind === 'error' || t.kind === 'warning'}<Icon icon={AlertTriangle} />{:else if t.kind === 'success'}<Icon icon={Check} />{:else}<Icon icon={Info} />{/if}
      </span>
      <span class="tm selectable">{t.message}</span>
      {#if t.action}
        <button class="btn ghost" onclick={() => { t.action!.run(); ui.dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="icon-btn" title="Dismiss" onclick={() => ui.dismiss(t.id)}><Icon icon={X} size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    width: min(440px, calc(100vw - 32px));
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 20px 22px 16px;
    border: 1px solid var(--border-soft);
    outline: none;
  }
  .dialog h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }
  .msg {
    margin: 0 0 14px;
    color: var(--text-muted);
    user-select: text;
    -webkit-user-select: text;
  }
  .details {
    margin: 0 0 14px;
    padding-left: 18px;
    max-height: 160px;
    overflow: auto;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .dialog .input {
    width: 100%;
    margin-bottom: 14px;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .menu-catcher {
    position: fixed;
    inset: 0;
    z-index: 300;
  }
  .menu {
    position: fixed;
    z-index: 301;
    min-width: 200px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 5px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    outline: none;
  }
  .mi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    width: 100%;
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .mi.sel {
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
  .msep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border-soft);
  }
  .toasts {
    position: fixed;
    right: 16px;
    bottom: calc(var(--statusbar-h) + 12px);
    z-index: 250;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 440px;
    padding: 8px 6px 8px 12px;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow);
    animation: rise 0.18s var(--ease);
  }
  .ti {
    display: inline-flex;
    color: var(--text-muted);
  }
  .toast.error .ti {
    color: var(--danger);
  }
  .toast.success .ti {
    color: var(--success);
  }
  .toast.warning .ti {
    color: var(--warning);
  }
  .tm {
    flex: 1;
    word-break: break-word;
    cursor: auto;
  }
  @keyframes rise {
    from {
      transform: translateY(6px);
      opacity: 0;
    }
  }
</style>
