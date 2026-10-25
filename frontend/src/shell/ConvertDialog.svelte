<script lang="ts">
  // The Save and convert dialog: pick a format (arrows, digits, click),
  // optionally keep the copy updated on every save, see where it goes. With
  // several files (a file manager's selection) each copy goes next to its
  // original; standalone, it is the whole window.
  import Icon from './Icon.svelte';
  import { AlertTriangle } from '../core/icons';
  import { api } from '../core/backend';
  import { companions, convertUI, defaultTarget, familyOf, formatInfo, plan } from '../core/convert.svelte';
  import { basename, dirname, extname } from '../core/paths';
  import { t, tn } from '../core/i18n';

  const req = $derived(convertUI.request!);
  const src = $derived(req.srcs[0]);
  const many = $derived(req.srcs.length > 1);
  // The family whose formats are listed: the first file that becomes any of them.
  const family = $derived(familyOf(req.srcs.find((p) => req.targets.some((e) => plan([p], e).jobs.length)) ?? src));
  const kept = $derived(many ? [] : companions(src));
  let selected = $state(0);
  let custom = $state<string | null>(null);
  let always = $state(false);
  let replacing = $state(0);
  let listEl = $state<HTMLDivElement>();

  const ext = $derived(req.targets[Math.min(selected, req.targets.length - 1)]);
  const dst = $derived(custom ?? kept.find((d) => extname(d) === ext) ?? defaultTarget(src, ext));
  const work = $derived(many ? plan(req.srcs, ext) : { jobs: [{ src, dst }], left: [] as string[] });

  // Start on a format kept up to date already, if any.
  $effect.pre(() => {
    const i = req.targets.findIndex((e) => kept.some((d) => extname(d) === e));
    selected = Math.max(0, i);
  });
  $effect(() => {
    always = kept.some((d) => extname(d) === ext);
  });
  $effect(() => {
    const targets = work.jobs.map((j) => j.dst);
    replacing = 0;
    void api.Exists(targets).then((r) => {
      if (targets.join('\n') === work.jobs.map((j) => j.dst).join('\n')) replacing = targets.filter((d, i) => r?.[i] && !kept.includes(d)).length;
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
    if (!work.jobs.length) return;
    req.resolve({ ext, dst, always: req.canRepeat && always });
  }

  async function choosePlace() {
    const info = formatInfo(ext, family, src);
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
<div class="overlay" class:standalone={req.standalone} onclick={() => !req.standalone && req.resolve(null)} onkeydown={key}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={req.standalone ? t('Convert') : t('Save and convert')} tabindex="-1" use:focus onclick={(e) => e.stopPropagation()}>
    <h2>{req.standalone ? t('Convert') : t('Save and convert')}</h2>
    {#if many}
      <p class="src" title={req.srcs.join('\n')}>{tn('{n} file', '{n} files', req.srcs.length)}: {req.srcs.map((p) => basename(p)).join(', ')}</p>
    {:else}
      <p class="src" title={src}>{basename(src)}</p>
    {/if}
    <div class="formats" role="listbox" aria-label={t('Format')} bind:this={listEl}>
      {#each req.targets as e, i (e)}
        {@const info = formatInfo(e, family, src)}
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
      {#if many}
        <span class="to">{tn('Saves {n} file next to its original', 'Saves {n} files, each next to its original', work.jobs.length)}</span>
      {:else}
        <span class="to" title={dst}>{dirname(dst) === dirname(src) ? t('Saves {name} next to the original', { name: basename(dst) }) : t('Saves {path}', { path: dst })}</span>
        <button class="btn ghost" onclick={choosePlace}>{t('Change…')}</button>
      {/if}
    </div>
    {#if work.left.length}
      <p class="note" title={work.left.join('\n')}>{tn('Left out: {n} file already in this format or that can’t become it', 'Left out: {n} files already in this format or that can’t become it', work.left.length)}</p>
    {/if}
    {#if replacing}
      <p class="warn">
        <Icon icon={AlertTriangle} size={14} />
        {many ? tn('Replaces {n} file that is there now.', 'Replaces {n} files that are there now.', replacing) : t('Replaces the {name} that is there now.', { name: basename(dst) })}
      </p>
    {/if}
    <div class="buttons">
      <button class="btn" onclick={() => req.resolve(null)}>{t('Cancel')}</button>
      <button class="btn primary" disabled={!work.jobs.length} onclick={done}>{t('Convert')}</button>
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
  /* The whole window: no dimming, no card. */
  .overlay.standalone {
    background: var(--bg-elevated);
  }
  .standalone .dialog {
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    animation: none;
    padding: 22px 24px 18px;
  }
  .standalone .formats {
    flex: 1;
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
    min-height: calc(28px * var(--ui-scale));
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .to {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: var(--fs-small);
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
