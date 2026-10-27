<script lang="ts">
  // Dialog, toasts and context menu.
  import Icon from './Icon.svelte';
  import MenuList from './MenuList.svelte';
  import { AlertTriangle, Check, ExternalLink, Info, X } from '../core/icons';
  import { menu, ui } from '../core/ui.svelte';
  import { formatShortcut } from '../core/keys';
  import { t } from '../core/i18n';
  import { iconFor, kindOf } from '../core/fileicons';

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
        // The main button, or the last of the right-hand ones: never one set aside.
        const main = [...(dialogEl?.querySelectorAll<HTMLButtonElement>('.buttons .main button') ?? [])];
        (main.find((b) => b.classList.contains('primary')) ?? main.at(-1))?.focus();
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
      const primary = d.buttons.find((b) => b.primary) ?? d.buttons.filter((b) => !b.aside).at(-1) ?? d.buttons[d.buttons.length - 1];
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
      {#if d.file}
        <div class="file" title={d.file.tip}>
          <span class="ficon"><Icon icon={iconFor(d.file.name, kindOf(d.file.name))} size={20} /></span>
          <span class="ftext">
            <span class="fname">{d.file.name}</span>
            {#if d.file.where}<span class="fwhere">{d.file.where}</span>{/if}
          </span>
        </div>
      {/if}
      {#if d.message}<p class="msg">{d.message}</p>{/if}
      {#if d.details?.length}
        <ul class="details">
          {#each d.details as line}<li>{line}</li>{/each}
        </ul>
      {/if}
      {#if d.items?.length}
        <ul class="items">
          {#each d.items as it (it.id)}
            <li>
              <button class="item" title={it.tip} onclick={() => d.resolve({ button: 'item', value: it.id })}>
                <span class="dot"></span><span class="name">{it.label}</span>{#if it.detail}<span class="where">{it.detail}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if d.input}
        <input class="input" bind:this={inputEl} bind:value={inputValue} placeholder={d.input.placeholder} spellcheck="false" />
      {/if}
      {#if d.footnote || d.link}
        <p class="footnote">
          {#if d.footnote}<span>{d.footnote}</span>{/if}
          {#if d.link}<button class="link" onclick={() => d.link!.run()}>{d.link.label}<Icon icon={ExternalLink} size={12} /></button>{/if}
        </p>
      {/if}
      <div class="buttons">
        {#each [d.buttons.filter((b) => b.aside), d.buttons.filter((b) => !b.aside)] as group, side}
          <div class={side ? 'main' : 'aside'}>
            {#each group as b (b.id)}
              <button class="btn" class:primary={b.primary} class:danger={b.danger} class:ghost={b.aside} onclick={() => d.resolve({ button: b.id, value: inputValue })}>{b.label}</button>
            {/each}
          </div>
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
  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 0 14px;
    padding: 10px 12px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .file .ficon {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }
  .file .ftext {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .file .fname,
  .file .fwhere {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file .fname {
    font-weight: 600;
    color: var(--text);
  }
  .file .fwhere {
    color: var(--text-muted);
    font-size: var(--fs-small);
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
  .items {
    list-style: none;
    margin: -6px 0 14px;
    padding: 4px;
    max-height: 200px;
    overflow: auto;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--bg-hover);
  }
  .item .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .item .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item .where {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .footnote {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 0 0 16px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .footnote .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .footnote .link:hover {
    text-decoration: underline;
  }
  .dialog .input {
    width: 100%;
    margin-bottom: 14px;
  }
  .buttons {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .buttons .aside,
  .buttons .main {
    display: flex;
    gap: 8px;
  }
  .buttons .main {
    margin-left: auto;
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
