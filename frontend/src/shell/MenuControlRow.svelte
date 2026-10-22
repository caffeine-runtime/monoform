<script lang="ts">
  // One menu row for what used to be several items: the theme as a
  // three-way toggle, the interface and text size as sliders, the split view
  // layouts as a row of buttons.
  import { UI_SCALES } from '../core/appCommands';
  import { commands } from '../core/commands';
  import { settings } from '../core/settings.svelte';
  import { theme } from '../core/theme.svelte';
  import { workspace } from '../core/tabs.svelte';
  import type { MenuControl } from '../core/ui.svelte';
  import { t } from '../core/i18n';
  import Icon from './Icon.svelte';
  import Square from '@lucide/svelte/icons/square';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import Rows2 from '@lucide/svelte/icons/rows-2';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import Grid2x2 from '@lucide/svelte/icons/grid-2x2';

  let { control }: { control: MenuControl } = $props();
  const s = $derived(settings.value);

  const THEMES = [
    { id: 'system', label: t('System', {}, 'theme') },
    { id: 'light', label: t('Light', {}, 'theme') },
    { id: 'dark', label: t('Dark', {}, 'theme') },
  ] as const;
  const scaleIndex = $derived(Math.max(0, UI_SCALES.findIndex((v) => Math.abs(v - (s.uiScale || 1)) < 1e-3)));
  // While the interface slider is dragged only its number changes: rescaling
  // the menu under the pointer would move the slider and make it jump.
  let dragScale = $state<number | null>(null);
  const layout = $derived.by(() => {
    const sp = workspace.split;
    if (!sp) return 'one';
    return sp.layout === 'grid' ? (sp.panes.length === 3 ? 'three' : 'grid') : sp.layout;
  });
  const LAYOUTS = [
    { id: 'one', title: t('One tab'), icon: Square, cmd: 'view.unsplit' },
    { id: 'columns', title: t('Two side by side'), icon: Columns2, cmd: 'view.splitColumns' },
    { id: 'rows', title: t('Two stacked'), icon: Rows2, cmd: 'view.splitRows' },
    { id: 'three', title: t('Three'), icon: Columns3, cmd: 'view.splitThree' },
    { id: 'grid', title: t('Four (grid)'), icon: Grid2x2, cmd: 'view.splitGrid' },
  ];
</script>

<!-- Clicks and keys inside a control stay in it (the menu stays open). -->
<div class="row" data-control={control} role="group" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
  {#if control === 'theme'}
    <span class="lbl">{t('Theme')}</span>
    <div class="seg" role="radiogroup" aria-label={t('Theme')}>
      {#each THEMES as th (th.id)}
        <button role="radio" aria-checked={s.theme === th.id} class:on={s.theme === th.id} onclick={() => theme.set(th.id)}>{th.label}</button>
      {/each}
    </div>
  {:else if control === 'uiScale'}
    <label class="lbl" for="menu-uis">{t('Interface')}</label>
    <input
      id="menu-uis"
      type="range"
      min="0"
      max={UI_SCALES.length - 1}
      step="1"
      value={scaleIndex}
      title={t('Double-click: {value}', { value: '100%' })}
      ondblclick={() => settings.update((x) => (x.uiScale = 1))}
      oninput={(e) => (dragScale = UI_SCALES[+(e.target as HTMLInputElement).value])}
      onchange={(e) => {
        dragScale = null;
        settings.update((x) => (x.uiScale = UI_SCALES[+(e.target as HTMLInputElement).value]));
      }}
    />
    <span class="val">{Math.round((dragScale ?? (s.uiScale || 1)) * 100)}%</span>
  {:else if control === 'fontSize'}
    <label class="lbl" for="menu-fs">{t('Text size')}</label>
    <input
      id="menu-fs"
      type="range"
      min="9"
      max="32"
      step="1"
      value={s.fontSize}
      title={t('Double-click: {value}', { value: '14' })}
      ondblclick={() => settings.update((x) => (x.fontSize = 14))}
      oninput={(e) => settings.update((x) => (x.fontSize = +(e.target as HTMLInputElement).value))}
    />
    <span class="val">{s.fontSize}</span>
  {:else if control === 'split'}
    <span class="lbl">{t('Split')}</span>
    <div class="seg icons" role="radiogroup" aria-label={t('Split view')}>
      {#each LAYOUTS as l (l.id)}
        <button
          role="radio"
          aria-checked={layout === l.id}
          class:on={layout === l.id}
          title={l.title}
          disabled={l.id !== 'one' && workspace.tabs.length < 2}
          onclick={() => commands.execute(l.cmd)}><Icon icon={l.icon} size={14} /></button
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    min-height: var(--row-h);
    font-size: var(--fs-ui);
  }
  .lbl {
    min-width: calc(62px * var(--ui-scale));
    color: var(--text);
  }
  input[type='range'] {
    flex: 1;
    min-width: calc(110px * var(--ui-scale));
    accent-color: var(--accent);
  }
  .val {
    min-width: 3.2em;
    text-align: right;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .seg {
    display: flex;
    flex: 1;
    padding: 2px;
    border-radius: 4px;
    background: var(--bg-input);
    border: 1px solid var(--border-soft);
  }
  .seg button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .seg button:hover:not(:disabled) {
    color: var(--text);
  }
  .seg button.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
