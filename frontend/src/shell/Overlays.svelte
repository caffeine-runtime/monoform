<script lang="ts">
  // Dialog, toasts and context menu.
  import Icon from './Icon.svelte';
  import MenuList from './MenuList.svelte';
  import { AlertTriangle, Check, Info, X } from '../core/icons';
  import { menu, ui } from '../core/ui.svelte';
  import { formatShortcut } from '../core/keys';
  import { t } from '../core/i18n';

  let inputValue = $state('');
  let inputEl = $state<HTMLInputElement>();
  let dialogEl = $state<HTMLDivElement>();

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


  /** A right-click while a menu is open: the menu for what is under the pointer instead. */
  function reopenMenu(e: MouseEvent) {
    e.preventDefault();
    menu.close();
    const { clientX, clientY } = e;
    requestAnimationFrame(() => document.elementFromPoint(clientX, clientY)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 })));
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
  <div class="menu-catcher" onclick={() => menu.close()} oncontextmenu={reopenMenu}></div>
  <MenuList items={menu.open.items} x={menu.open.x} y={menu.open.y} />
{/if}

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast {toast.kind}">
      <span class="ti">
        {#if toast.kind === 'error' || toast.kind === 'warning'}<Icon icon={AlertTriangle} />{:else if toast.kind === 'success'}<Icon icon={Check} />{:else}<Icon icon={Info} />{/if}
      </span>
      <span class="tm selectable">{toast.message}</span>
      {#if toast.action}
        <button class="btn ghost" onclick={() => { toast.action!.run(); ui.dismiss(toast.id); }}>{toast.action.label}</button>
      {/if}
      <button class="icon-btn" title={t('Dismiss')} onclick={() => ui.dismiss(toast.id)}><Icon icon={X} size={14} /></button>
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
    animation: mf-rise var(--dur-2) var(--ease-out);
  }
  .dialog h2 {
    margin: 0 0 8px;
    font-size: calc(18px * var(--ui-scale));
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
    transform-origin: right center;
    animation: mf-toast var(--dur-3) var(--ease-spring);
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
</style>
