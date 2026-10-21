<script lang="ts">
  // Two modes: the Hash tool (pick/drop a file, choose algorithms, compare
  // with an expected digest) and checksum files (.sha256, .md5, SHA256SUMS…)
  // whose listed files are verified one by one.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import FileIcon from '@lucide/svelte/icons/file';
  import Copy from '@lucide/svelte/icons/copy';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import { api } from '../../core/backend';
  import { jobs, type JobProgress } from '../../core/jobs.svelte';
  import { basename, dirname, formatBytes, relative } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import { ALGOS, compare } from './compare';
  import { hashControllers } from './controllers';

  let { tab }: { tab: Tab } = $props();

  const verifyMode = tab.source.kind === 'file';
  const ALGO_KEY = 'mf.hash.algos';
  function loadAlgos(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(ALGO_KEY) ?? 'null');
      if (Array.isArray(v) && v.length) return v;
    } catch {
      /* ignore */
    }
    return ['sha256'];
  }

  let file = $state(verifyMode ? '' : (tab.path ?? ''));
  let size = $state<number | null>(null);
  let algos = $state<string[]>(loadAlgos());
  let results = $state<Record<string, string>>({});
  let expected = $state((tab.restoredState as { expected?: string } | undefined)?.expected ?? '');
  let jobId = $state('');
  let progress = $state<{ done: number; total: number; started: number } | null>(null);
  let error = $state('');
  let rows = $state<{ name: string; path: string; algo: string; expected: string; actual: string; status: string; error?: string }[]>([]);
  let verifyDone = $state<{ ok: number; bad: number; missing: number; errors: number; millis: number } | null>(null);

  const verdict = $derived(compare(expected, results, algos));
  const speed = $derived(progress && progress.done > 0 ? progress.done / Math.max(0.05, (performance.now() - progress.started) / 1000) : 0);

  $effect(() => {
    // Expected digest needs an algorithm we haven't computed: add it.
    if (verdict.kind === 'pending' && file && !jobId && !algos.includes(verdict.algo)) {
      algos = [...algos, verdict.algo];
      void run();
    }
  });

  function onProgress(p: JobProgress) {
    if (!progress) return;
    progress = { ...progress, done: p.done, total: p.total };
  }

  // One hash at a time. Asking again while one runs (another algorithm ticked,
  // another file chosen) isn't dropped: when it ends, whatever is still
  // missing for the current file is hashed, and a finished hash of a file
  // that is no longer chosen is thrown away.
  let running: Promise<void> | null = null;
  let again = false;

  function run(): Promise<void> {
    if (!file) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let want = [...algos];
      for (;;) {
        again = false;
        if (!(await hashOnce(want))) break;
        want = algos.filter((a) => !results[a]);
        if (!again || !file || !want.length) break;
      }
    })().finally(() => (running = null));
    return running;
  }

  /** Hashes `file` with `want`; false if it was cancelled or failed. */
  async function hashOnce(want: string[]): Promise<boolean> {
    const f = file;
    error = '';
    try {
      size = (await api.Stat(f)).size;
    } catch (e) {
      if (f !== file) return (again = true);
      error = String((e as Error).message ?? e);
      return false;
    }
    progress = { done: 0, total: size ?? 0, started: performance.now() };
    const done = await jobs.run<Record<string, string>>(`Hashing ${basename(f)}`, async () => (jobId = await api.HashFile(f, want)), { onProgress });
    jobId = '';
    progress = null;
    if (f !== file) {
      again = true; // chosen file changed meanwhile: start over on the new one
      return true;
    }
    if (done.cancelled) return false;
    if (done.error) {
      error = done.error;
      return false;
    }
    results = { ...results, ...done.result };
    tab.status = { ...tab.status, info: `${formatBytes(size ?? 0)} in ${(done.millis / 1000).toFixed(1)} s` };
    return true;
  }

  function setFile(p: string) {
    file = p;
    results = {};
    tab.source = { kind: 'tool', tool: 'hash', path: p };
    workspace.touch();
    void run();
  }

  async function pick() {
    const r = await api.OpenFilesDialog('Choose a file to hash', []);
    if (r?.[0]) setFile(r[0]);
  }

  function toggle(id: string) {
    algos = algos.includes(id) ? algos.filter((a) => a !== id) : [...algos, id];
    if (!algos.length) algos = ['sha256'];
    try {
      localStorage.setItem(ALGO_KEY, JSON.stringify(algos));
    } catch {
      /* private mode */
    }
    if (file && algos.some((a) => !results[a])) void run();
  }

  function copy(v: string) {
    void navigator.clipboard.writeText(v).then(() => ui.toast('Copied', 'success'));
  }

  async function verify() {
    rows = [];
    verifyDone = null;
    error = '';
    const t0 = performance.now();
    progress = { done: 0, total: 0, started: t0 };
    const done = await jobs.run<unknown>(`Verifying ${tab.title}`, async () => (jobId = await api.HashVerify(tab.filePath!)), {
      onProgress,
      onData: (r: { name: string; path: string; algo: string; expected: string; actual: string; status: string; error?: string }) => (rows = [...rows, r]),
    });
    jobId = '';
    progress = null;
    if (done.error && !done.cancelled) error = done.error;
    const c = (s: string) => rows.filter((r) => r.status === s).length;
    verifyDone = { ok: c('ok'), bad: c('mismatch'), missing: c('missing'), errors: c('error'), millis: done.millis };
    tab.status = { ...tab.status, info: `${verifyDone.ok}/${rows.length} OK` };
  }

  hashControllers.set(tab.id, { setFile, pick });
  (tab as unknown as { hashTest: unknown }).hashTest = { results: () => results, rows: () => rows, verdict: () => verdict, setExpected: (v: string) => (expected = v), setFile, setAlgos: (a: string[]) => (algos = a), run, running: () => !!jobId, jobId: () => jobId, summary: () => verifyDone, progress: () => progress };

  onMount(() => {
    tab.handlers = {
      ...tab.handlers,
      getState: () => ({ expected }),
      reload: () => (verifyMode ? verify() : run()),
      save: async () => false,
    };
    tab.status = { ...tab.status, type: verifyMode ? 'Checksum file' : 'Hash' };
    if (verifyMode) void verify();
    else if (file) void run();
    return () => {
      hashControllers.delete(tab.id);
      if (jobId) jobs.cancel(jobId);
    };
  });
</script>

<div class="wrap">
  {#if !verifyMode}
    <div class="card">
      <div class="file">
        <span class="fi"><Icon icon={FileIcon} size={20} /></span>
        {#if file}
          <div class="fn">
            <div class="name selectable">{basename(file)}</div>
            <div class="muted small selectable">{dirname(file)}{size != null ? ` · ${formatBytes(size)}` : ''}</div>
          </div>
        {:else}
          <div class="fn muted">Drop a file here, or choose one.</div>
        {/if}
        <button class="btn" onclick={pick}>Choose file…</button>
      </div>
      <div class="algos" role="group" aria-label="Algorithms">
        {#each ALGOS as a (a.id)}
          <label class="algo" class:on={algos.includes(a.id)}>
            <input type="checkbox" checked={algos.includes(a.id)} onchange={() => toggle(a.id)} />
            {a.label}
          </label>
        {/each}
      </div>
    </div>

    {#if progress}
      <div class="progress">
        <div class="bar"><span style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span></div>
        <div class="pinfo">
          <span>{formatBytes(progress.done)} of {formatBytes(progress.total)}</span>
          <span>{speed ? `${formatBytes(speed)}/s` : ''}{speed && progress.total ? ` · ${Math.max(0, Math.ceil((progress.total - progress.done) / speed))} s left` : ''}</span>
          <button class="btn ghost" onclick={() => jobs.cancel(jobId)}>Cancel</button>
        </div>
      </div>
    {/if}
    {#if error}<p class="err">{error}</p>{/if}

    {#if Object.keys(results).length}
      <div class="results">
        {#each ALGOS.filter((a) => results[a.id]) as a (a.id)}
          {@const hit = verdict.kind === 'match' && verdict.algo === a.id}
          <div class="res" class:hit>
            <span class="al">{a.label}</span>
            <code class="digest selectable">{results[a.id]}</code>
            <button class="icon-btn" title="Copy" onclick={() => copy(results[a.id])}><Icon icon={Copy} size={14} /></button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="card">
      <label class="exp">
        <span class="muted small">Expected hash (paste to compare)</span>
        <input class="input mono" bind:value={expected} placeholder="e.g. 3a7bd3e2360a3d…" spellcheck="false" />
      </label>
      {#if verdict.kind === 'match'}
        <div class="verdict good"><Icon icon={CircleCheck} size={22} /> Match — the {ALGOS.find((a) => a.id === verdict.algo)?.label} hash is identical.</div>
      {:else if verdict.kind === 'mismatch'}
        <div class="verdict bad"><Icon icon={CircleX} size={22} /> Mismatch — this file is not the one the expected hash describes.</div>
      {:else if verdict.kind === 'invalid'}
        <div class="verdict unk"><Icon icon={CircleHelp} size={22} /> That doesn't look like an MD5, SHA or BLAKE3 hash.</div>
      {:else if verdict.kind === 'pending' && file}
        <div class="verdict unk"><span class="spinner"></span> Computing {ALGOS.find((a) => a.id === verdict.algo)?.label}…</div>
      {/if}
    </div>
  {:else}
    <div class="card">
      <div class="file">
        <span class="fi"><Icon icon={FileIcon} size={20} /></span>
        <div class="fn">
          <div class="name">Verifying files listed in {tab.title}</div>
          <div class="muted small">Paths are relative to {dirname(tab.filePath ?? '')}</div>
        </div>
        <button class="btn" disabled={!!jobId} onclick={verify}>Verify again</button>
      </div>
      {#if progress}
        <div class="progress inline">
          <div class="bar"><span style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span></div>
          <button class="btn ghost" onclick={() => jobs.cancel(jobId)}>Cancel</button>
        </div>
      {/if}
      {#if verifyDone}
        <div class="summary">
          <span class="good">{verifyDone.ok} OK</span>
          {#if verifyDone.bad}<span class="bad">{verifyDone.bad} mismatched</span>{/if}
          {#if verifyDone.missing}<span class="unk">{verifyDone.missing} missing</span>{/if}
          {#if verifyDone.errors}<span class="unk">{verifyDone.errors} unreadable</span>{/if}
          <span class="muted">· {(verifyDone.millis / 1000).toFixed(1)} s</span>
        </div>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
    </div>
    <div class="vlist">
      {#each rows as r, i (i)}
        <div class="vrow {r.status}">
          <span class="vs">
            {#if r.status === 'ok'}<Icon icon={CircleCheck} size={16} />{:else if r.status === 'mismatch'}<Icon icon={CircleX} size={16} />{:else}<Icon icon={CircleHelp} size={16} />{/if}
          </span>
          <span class="vn selectable" title={r.path}>{relative(dirname(tab.filePath ?? ''), r.path) ?? r.name}</span>
          <span class="va">{r.algo.toUpperCase()}</span>
          <span class="vt">{r.status === 'ok' ? 'OK' : r.status === 'mismatch' ? 'Mismatch' : r.status === 'missing' ? 'Missing' : (r.error ?? 'Error')}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    padding: 28px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
  }
  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  :global([data-theme='dark']) .card {
    background: var(--bg-sidebar);
  }
  .file {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .fi {
    display: inline-flex;
    color: var(--text-muted);
  }
  .fn {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .small {
    font-size: var(--fs-small);
  }
  .algos {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .algo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--bg-hover);
    cursor: pointer;
    user-select: none;
  }
  .algo.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .algo input {
    display: none;
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .progress.inline {
    flex-direction: row;
    align-items: center;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 6px;
    background: var(--bg-active);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.15s linear;
  }
  .pinfo {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text-muted);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .res {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 14px;
    border-radius: var(--radius);
    background: var(--bg-hover);
  }
  .res.hit {
    background: color-mix(in srgb, var(--success) 18%, transparent);
  }
  .al {
    width: 64px;
    color: var(--text-muted);
    font-size: var(--fs-small);
    flex: none;
  }
  .digest {
    flex: 1;
    word-break: break-all;
    font-size: calc(12.5px * var(--ui-scale));
  }
  .exp {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .exp .input {
    width: 100%;
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: calc(15px * var(--ui-scale));
    font-weight: 600;
  }
  .good {
    color: var(--success);
  }
  .bad {
    color: var(--danger);
  }
  .unk {
    color: var(--warning);
  }
  .err {
    color: var(--danger);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .vlist {
    display: flex;
    flex-direction: column;
  }
  .vrow {
    display: grid;
    grid-template-columns: 24px 1fr 70px 120px;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius);
  }
  .vrow:hover {
    background: var(--bg-hover);
  }
  .vrow.ok .vs {
    color: var(--success);
  }
  .vrow.mismatch .vs,
  .vrow.mismatch .vt {
    color: var(--danger);
  }
  .vrow.missing .vs,
  .vrow.error .vs {
    color: var(--warning);
  }
  .vn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .va,
  .vt {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
</style>
