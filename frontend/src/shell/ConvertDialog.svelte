<script lang="ts">
  // The Save and convert dialog: pick a format (arrows, digits, click),
  // optionally keep the copy updated on every save, see where it goes.
  import Icon from './Icon.svelte';
  import { AlertTriangle } from '../core/icons';
  import { api } from '../core/backend';
  import { companions, convertUI, defaultTarget, familyOf, formatInfo } from '../core/convert.svelte';
  import { basename, dirname, extname } from '../core/paths';
  import { t } from '../core/i18n';

  const req = $derived(convertUI.request!);
  const family = $derived(familyOf(req.src));
  const kept = $derived(companions(req.src));
  let selected = $state(0);
  let custom = $state<string | null>(null);
  let always = $state(false);
  let exists = $state(false);
  let listEl = $state<HTMLDivElement>();

  const ext = $derived(req.targets[selected]);
  const dst = $derived(custom ?? kept.find((d) => extname(d) === ext) ?? defaultTarget(req.src, ext));

  // Start on a format kept up to date already, if any.
  $effect.pre(() => {
    const i = req.targets.findIndex((e) => kept.some((d) => extname(d) === e));
    selected = Math.max(0, i);
  });
  $effect(() => {
    always = kept.some((d) => extname(d) === ext);
  });
  $effect(() => {
    const target = dst;
    exists = false;
    void api.Exists([target]).then((r) => {
      if (target === dst) exists = !!r?.[0] && !kept.includes(target);
    });
  });
  $effect(() => {
    listEl?.querySelector<HTMLElement>('.fmt.sel')?.scrollIntoView({ block: 'nearest' });
  });

  function pick(i: number) {
    selected = Math.max(0, Math.min(req.targets.length - 1, i));
    custom = null;
  }

  function done() {
    req.resolve({ ext, dst, always: req.canRepeat && always });
  }

  async function choosePlace() {
    const info = formatInfo(ext, family, req.src);
    let p = await api.SaveFileDialog(t('Save the converted file as'), dst, [{ name: info.label, patterns: `*.${ext}` }]);
    if (!p) return;
    if (extname(p) !== ext) p += `.${ext}`;
    custom = p;
  }

  function key(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.key === 'ArrowDown') pick(selected + 1);
    else if (e.key === 'ArrowUp') pick(selected - 1);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(req.targets.length - 1);
    else if (e.key === 'Enter') done();
    else if (e.key === 'Escape') req.resolve(null);
    else if (/^[1-9]$/.test(e.key) && +e.key <= req.targets.length) pick(+e.key - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function focus(node: HTMLElement) {
    queueMicrotask(() => node.focus());
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="overlay" onclick={() => req.resolve(null)} onkeydown={key}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Save and convert')} tabindex="-1" use:focus onclick={(e) => e.stopPropagation()}>
    <h2>{t('Save and convert')}</h2>
    <p class="src" title={req.src}>{basename(req.src)}</p>
    <div class="formats" role="listbox" aria-label={t('Format')} bind:this={listEl}>
      {#each req.targets as e, i (e)}
        {@const info = formatInfo(e, family, req.src)}
        <div class="fmt" class:sel={i === selected} role="option" tabindex="-1" aria-selected={i === selected} onclick={() => pick(i)} ondblclick={() => (pick(i), done())}>
          <span class="name">{info.label}</span>
          <span class="hint">{info.hint}</span>
          <span class="ext">.{e}</span>
        </div>
      {/each}
    </div>
    {#if req.canRepeat}
      <label class="always">
        <input type="checkbox" bind:checked={always} />
        <span>{t('Also update it every time I save')}</span>
      </label>
    {/if}
    <div class="dest">
      <span class="to" title={dst}>{dirname(dst) === dirname(req.src) ? t('Saves {name} next to the original', { name: basename(dst) }) : t('Saves {path}', { path: dst })}</span>
      <button class="btn ghost" onclick={choosePlace}>{t('Change…')}</button>
    </div>
    {#if exists}
      <p class="warn"><Icon icon={AlertTriangle} size={14} />{t('Replaces the {name} that is there now.', { name: basename(dst) })}</p>
    {/if}
    <div class="buttons">
      <button class="btn" onclick={() => req.resolve(null)}>{t('Cancel')}</button>
      <button class="btn primary" onclick={done}>{t('Convert')}</button>
    </div>
  </div>
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
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 20px 22px 16px;
    border: 1px solid var(--border-soft);
    outline: none;
    animation: mf-rise var(--dur-2) var(--ease-out);
  }
  h2 {
    margin: 0;
    font-size: calc(18px * var(--ui-scale));
  }
  .src {
    margin: 2px 0 14px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .formats {
    overflow-y: auto;
    min-height: 0;
    margin: 0 -8px 12px;
    padding: 2px 0;
    /* One set of columns for every row, so the descriptions line up. */
    display: grid;
    grid-template-columns: max-content 1fr auto;
    align-content: start;
  }
  .fmt {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: baseline;
    gap: 12px;
    padding: 7px 8px;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .fmt:hover {
    background: var(--bg-hover);
  }
  .fmt.sel {
    background: var(--accent-soft);
  }
  .name {
    font-weight: 600;
  }
  .fmt.sel .name {
    color: var(--accent-text);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .ext {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
  }
  .always {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    cursor: pointer;
  }
  .dest {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .to {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    color: var(--warning);
    font-size: var(--fs-small);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
