<script lang="ts">
  // Monoform's own setup: one calm card in the app's colours instead of
  // the stock installer pages. Install (with a few options), progress, done;
  // run as the uninstaller it offers to remove the app.
  import { onMount } from 'svelte';
  import Icon from '../src/shell/Icon.svelte';
  import X from '@lucide/svelte/icons/x';
  import Minus from '@lucide/svelte/icons/minus';
  import Folder from '@lucide/svelte/icons/folder-open';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import appIcon from '../../build/appicon.png';
  import { api, type Info, type Options, type Progress } from './api';

  let info = $state<Info | null>(null);
  let page = $state<'start' | 'working' | 'done' | 'removed' | 'error'>('start');
  let more = $state(false);
  let error = $state('');
  let progress = $state<Progress>({ step: '', done: 0, total: 1 });
  let removeData = $state(false);
  let closing = $state(false);
  let o = $state<Options>({ dir: '', everyone: false, desktop: false, defaults: false, command: true, version: '' });

  const update = $derived(!!info?.installed);
  const pct = $derived(progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0);

  onMount(() => {
    const off = api.onProgress((p) => (progress = p));
    void api.info().then((i) => {
      info = i;
      const prev = i.installed;
      o = { dir: prev?.dir ?? i.userDir, everyone: prev?.everyone ?? false, desktop: prev?.desktop ?? false, defaults: prev?.defaults ?? false, command: prev?.command ?? true, version: i.version };
      if (i.test) void selfTest();
    });
    return off;
  });

  function setEveryone(v: boolean) {
    if (!info) return;
    // Follow the usual folder for the choice unless the user picked another.
    if (o.dir === info.userDir || o.dir === info.everyoneDir) o.dir = v ? info.everyoneDir : info.userDir;
    o.everyone = v;
  }

  async function browse() {
    const d = await api.browse(o.dir);
    if (d) o.dir = d.toLowerCase().endsWith('monoform') ? d : `${d}${d.includes('\\') ? '\\' : '/'}Monoform`;
  }

  async function closeApp() {
    closing = true;
    const closed = await api.closeApp();
    closing = false;
    if (info) info.running = !closed;
  }

  async function run(work: () => Promise<void>, next: 'done' | 'removed') {
    page = 'working';
    progress = { step: 'Starting', done: 0, total: 1 };
    try {
      await work();
      page = next;
    } catch (e) {
      error = String((e as Error)?.message ?? e);
      page = 'error';
    }
  }

  const install = () => run(() => api.install($state.snapshot(o)), 'done');
  const remove = () => run(() => api.uninstall(removeData), 'removed');

  /** MF_SETUP_TEST: go through the pages by themselves and report. */
  async function selfTest() {
    await new Promise((r) => setTimeout(r, 400));
    if (info!.mode === 'install') await install();
    else await remove();
    await api.log(page === 'error' ? `SETUP FAIL ${error}` : `SETUP PASS ${info!.mode} → ${page}`);
    api.quit();
  }
</script>

<div class="win">
  <header class="bar" style="--wails-draggable: drag">
    <img src={appIcon} alt="" class="logo" />
    <span class="title">Monoform {info?.mode === 'uninstall' ? 'Uninstall' : 'Setup'}</span>
    {#if info?.demo}<span class="demo" title="Nothing is changed on this computer: files go to a test folder">demo</span>{/if}
    <span class="spacer"></span>
    <button class="wbtn" title="Minimise" aria-label="Minimise" onclick={api.minimise}><Icon icon={Minus} size={14} /></button>
    <button class="wbtn close" title="Close" aria-label="Close" disabled={page === 'working'} onclick={api.quit}><Icon icon={X} size={14} /></button>
  </header>

  {#if !info}
    <main class="center"><span class="muted">One moment…</span></main>
  {:else if page === 'start' && info.mode === 'install'}
    <main>
      <div class="hero">
        <img src={appIcon} alt="" class="big" />
        <div>
          <h1>{update ? 'Update' : 'Install'} Monoform</h1>
          <p class="muted">Version {info.version}{update && info.installed?.version ? ` · replaces ${info.installed.version}` : ''}. One window for your everyday files — offline, no account.</p>
        </div>
      </div>

      {#if info.running}
        <div class="note warn">
          <span>Monoform is open. Close it first (unsaved work will be asked about).</span>
          <button class="btn" disabled={closing} onclick={closeApp}>{closing ? 'Closing…' : 'Close it'}</button>
        </div>
      {/if}

      <button class="more" aria-expanded={more} onclick={() => (more = !more)}><Icon icon={ChevronDown} size={14} /> Options</button>
      {#if more}
        <div class="opts">
          <label class="row path">
            <span>Folder</span>
            <input class="input" bind:value={o.dir} spellcheck="false" />
            <button class="icon-btn" title="Choose a folder" onclick={browse}><Icon icon={Folder} size={15} /></button>
          </label>
          <label class="chk"><input type="checkbox" checked={o.everyone} onchange={(e) => setEveryone((e.target as HTMLInputElement).checked)} /> For everyone on this computer <span class="muted">(asks for permission)</span></label>
          <label class="chk"><input type="checkbox" bind:checked={o.desktop} /> Shortcut on the desktop</label>
          <label class="chk"><input type="checkbox" bind:checked={o.command} /> The <code>monoform</code> command in the terminal</label>
          <label class="chk"><input type="checkbox" bind:checked={o.defaults} /> Open text, Markdown, PDF, images, Office files and archives with Monoform by default</label>
        </div>
      {:else}
        <p class="summary muted">Into {o.dir}{o.desktop ? ' · desktop shortcut' : ''}{o.defaults ? ' · default app' : ''}. Always listed in “Open with”.</p>
      {/if}
    </main>
    <footer>
      <button class="btn ghost" onclick={api.quit}>Cancel</button>
      <button class="btn primary" disabled={info.running || !o.dir} onclick={install}>{update ? 'Update' : 'Install'}</button>
    </footer>
  {:else if page === 'start'}
    <main>
      <div class="hero">
        <img src={appIcon} alt="" class="big" />
        <div>
          <h1>Remove Monoform?</h1>
          <p class="muted">The app, its shortcuts and its file-type settings are removed{info.installed ? ` from ${info.installed.dir}` : ''}. Your own files are never touched.</p>
        </div>
      </div>
      {#if info.running}
        <div class="note warn">
          <span>Monoform is open. Close it first.</span>
          <button class="btn" disabled={closing} onclick={closeApp}>{closing ? 'Closing…' : 'Close it'}</button>
        </div>
      {/if}
      <label class="chk"><input type="checkbox" bind:checked={removeData} /> Also delete my settings, file history and search index</label>
    </main>
    <footer>
      <button class="btn ghost" onclick={api.quit}>Keep it</button>
      <button class="btn primary danger" disabled={info.running} onclick={remove}>Remove</button>
    </footer>
  {:else if page === 'working'}
    <main class="center">
      <h2>{info.mode === 'install' ? (update ? 'Updating…' : 'Installing…') : 'Removing…'}</h2>
      <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style:width="{pct}%"></span></div>
      <p class="muted step">{progress.step}</p>
    </main>
  {:else if page === 'done'}
    <main class="center">
      <span class="ok"><Icon icon={Check} size={22} /></span>
      <h2>Monoform is {update ? 'updated' : 'installed'}</h2>
      <p class="muted">Find it in the Start menu{o.desktop ? ' and on the desktop' : ''}. Right-click any file for “Quick peek with Monoform”.</p>
    </main>
    <footer>
      <button class="btn ghost" onclick={api.quit}>Close</button>
      <button class="btn primary" onclick={() => void api.launch().then(api.quit)}>Open Monoform</button>
    </footer>
  {:else if page === 'removed'}
    <main class="center">
      <span class="ok"><Icon icon={Check} size={22} /></span>
      <h2>Monoform is removed</h2>
      <p class="muted">{removeData ? 'Its settings and history are gone too.' : 'Your settings stay, in case you install it again.'}</p>
    </main>
    <footer><button class="btn primary" onclick={api.quit}>Close</button></footer>
  {:else}
    <main class="center">
      <h2>That didn’t work</h2>
      <p class="err">{error}</p>
    </main>
    <footer>
      <button class="btn ghost" onclick={api.quit}>Close</button>
      <button class="btn primary" onclick={() => (page = 'start')}>Back</button>
    </footer>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: var(--bg);
    overflow: hidden;
  }
  .win {
    height: 100vh;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-soft);
    box-sizing: border-box;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 6px 0 12px;
    flex: none;
    user-select: none;
  }
  .logo {
    width: 16px;
    height: 16px;
  }
  .title {
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .demo {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .spacer {
    flex: 1;
  }
  .wbtn {
    --wails-draggable: no-drag;
    display: grid;
    place-items: center;
    width: 32px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .wbtn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .wbtn.close:hover {
    background: var(--danger);
    color: #fff;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 18px 32px 8px;
  }
  main.center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 6px;
  }
  .hero {
    display: flex;
    gap: 18px;
    align-items: center;
    margin-bottom: 18px;
  }
  .big {
    width: 72px;
    height: 72px;
    flex: none;
  }
  h1 {
    margin: 0 0 6px;
    font-family: 'Source Serif 4 Variable', Georgia, serif;
    font-size: 26px;
    font-weight: 600;
  }
  h2 {
    margin: 4px 0;
    font-size: 18px;
  }
  p {
    margin: 0;
    line-height: 1.5;
    overflow-wrap: anywhere; /* long install folders */
  }
  .muted {
    color: var(--text-muted);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: space-between;
    padding: 10px 12px;
    margin-bottom: 12px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    font-size: var(--fs-small);
  }
  .note.warn {
    border-color: color-mix(in srgb, var(--warning) 50%, transparent);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    padding: 4px 0;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
  }
  .more[aria-expanded='true'] :global(svg) {
    transform: rotate(180deg);
  }
  .summary {
    font-size: var(--fs-small);
    margin-top: 2px;
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row span {
    width: 52px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .chk {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    line-height: 1.4;
  }
  .chk input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  code {
    font-size: 0.92em;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px 18px;
    flex: none;
  }
  footer .btn {
    min-width: 96px;
    justify-content: center;
  }
  .btn.danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
  .meter {
    width: 70%;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-hover);
    overflow: hidden;
    margin: 10px 0 4px;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .step {
    font-size: var(--fs-small);
  }
  .ok {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin-bottom: 6px;
  }
  .err {
    color: var(--danger);
    max-width: 90%;
    word-break: break-word;
  }
</style>
