<script lang="ts">
  // Convert with Monoform: the window a file manager's right-click menu opens
  // (monoform --convert FILE…). The format dialog fills it; then each file's
  // progress. When everything went well it closes itself a moment later.
  import Icon from './Icon.svelte';
  import ConvertDialog from './ConvertDialog.svelte';
  import { api } from '../core/backend';
  import { jobs } from '../core/jobs.svelte';
  import { Check, FolderOpen, X } from '../core/icons';
  import { convertUI, convertWindow, plan, targetsForAll } from '../core/convert.svelte';
  import { basename } from '../core/paths';
  import { t, tn } from '../core/i18n';

  interface Row {
    src: string;
    dst: string;
    state: 'waiting' | 'working' | 'done' | 'failed';
    error?: string;
    progress?: number;
  }

  let phase = $state<'choosing' | 'converting' | 'done' | 'nothing'>('choosing');
  let rows = $state<Row[]>([]);
  let chosen = '';
  let current = ''; // the running job
  let quitting = false;
  const failed = $derived(rows.filter((r) => r.state === 'failed').length);

  async function start() {
    const targets = await targetsForAll(convertWindow.files);
    if (!targets.length) {
      phase = 'nothing';
      return;
    }
    const choice = await convertUI.choose(convertWindow.files, targets, { standalone: true });
    if (!choice) return void api.Quit(0);
    chosen = choice.ext;
    phase = 'converting';
    rows = plan(convertWindow.files, chosen).jobs.map((j) => ({ ...j, state: 'waiting' }));
    if (rows.length === 1) rows[0].dst = choice.dst; // the single file's place may have been changed
    await work();
  }

  async function work() {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.state !== 'waiting') continue;
      r.state = 'working';
      if (quitting) return;
      const done = await jobs.run(t('Converting {name}', { name: basename(r.src) }), () => api.ConvertFile(r.src, r.dst).then((id) => (current = id)), {
        silent: true,
        onProgress: (p) => (r.progress = p.total ? p.done / p.total : undefined),
      });
      if (done.error || done.cancelled) {
        r.state = 'failed';
        r.error = done.error || t('Cancelled');
      } else r.state = 'done';
      current = '';
    }
    if (quitting) return void api.Quit(0);
    phase = 'done';
    if (!failed && !convertWindow.testing) setTimeout(() => void api.Quit(0), 1600);
  }

  /** Close: a running conversion is cancelled first (no half-written file stays behind). */
  function close() {
    if (phase !== 'converting' || !current) return void api.Quit(0);
    quitting = true;
    void api.CancelJob(current);
  }

  // Files from later launches (the rest of a file manager's selection).
  $effect(() => {
    const files = [...convertWindow.files];
    if (phase === 'choosing' && convertUI.request) {
      void targetsForAll(files).then((targets) => {
        if (convertUI.request) {
          convertUI.request.srcs = files;
          convertUI.request.targets = targets;
        }
      });
    } else if (phase === 'converting' || phase === 'done') {
      const known = new Set(rows.map((r) => r.src));
      const more = plan(
        files.filter((f) => !known.has(f)),
        chosen,
      ).jobs;
      if (more.length) {
        rows.push(...more.map((j) => ({ ...j, state: 'waiting' as const })));
        if (phase === 'done') {
          phase = 'converting';
          void work();
        }
      }
    }
  });

  void start();
</script>

{#if phase === 'choosing'}
  {#if convertUI.request}<ConvertDialog />{/if}
{:else}
  <div class="win">
    <h2>{phase === 'nothing' ? t('Nothing to convert') : phase === 'done' ? (failed ? t('Some files weren’t converted') : t('Converted')) : t('Converting…')}</h2>
    {#if phase === 'nothing'}
      <p class="msg">{tn('This file doesn’t convert to other formats here.', 'These files don’t convert to other formats here.', convertWindow.files.length)}</p>
    {:else}
      <ul class="rows">
        {#each rows as r (r.src)}
          <li class={r.state}>
            <span class="st">
              {#if r.state === 'done'}<Icon icon={Check} size={14} />{:else if r.state === 'failed'}<Icon icon={X} size={14} />{:else if r.state === 'working'}<span class="spin"></span>{/if}
            </span>
            <span class="names" title={r.dst}>{basename(r.src)} → <b>{basename(r.dst)}</b></span>
            {#if r.state === 'working' && r.progress !== undefined}<span class="pct">{Math.round(r.progress * 100)}%</span>{/if}
            {#if r.error}<span class="err" title={r.error}>{r.error}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="buttons">
      {#if phase === 'done' && rows.some((r) => r.state === 'done')}
        <button class="btn ghost" onclick={() => void api.ShowInFolder(rows.find((r) => r.state === 'done')!.dst)}><Icon icon={FolderOpen} size={14} /> {t('Show in folder')}</button>
      {/if}
      <span class="grow"></span>
      <button class="btn" class:primary={phase !== 'converting'} onclick={close}>{phase === 'converting' ? t('Cancel') : t('Close')}</button>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(e) => phase !== 'choosing' && e.key === 'Escape' && close()} />

<style>
  .win {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 22px 24px 18px;
    background: var(--bg-elevated);
  }
  h2 {
    margin: 0 0 14px;
    font-size: calc(18px * var(--ui-scale));
  }
  .msg {
    flex: 1;
    color: var(--text-muted);
  }
  .rows {
    flex: 1;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-soft);
  }
  .st {
    display: inline-flex;
    width: 16px;
    justify-content: center;
    color: var(--text-faint);
  }
  li.done .st {
    color: var(--success);
  }
  li.failed .st,
  .err {
    color: var(--danger);
  }
  .names {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pct,
  .err {
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .err {
    color: var(--danger);
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spin {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .buttons {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .grow {
    flex: 1;
  }
</style>
