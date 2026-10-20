<script lang="ts">
  import PaneDivider, { savedRatio } from '../../shell/PaneDivider.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Globe from '@lucide/svelte/icons/globe';
  import SquareCode from '@lucide/svelte/icons/square-code';
  import Eye from '@lucide/svelte/icons/eye';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import Icon from '../../shell/Icon.svelte';
  import Code from '@lucide/svelte/icons/code';
  import { fitBar } from '../../core/fit';
  // HTML pages: a sandboxed live preview next to the source. Scripts are off
  // and remote content is blocked unless the user turns them on; even then
  // the page runs in an opaque origin with no access to the app or files
  // outside its folder.
  import { onMount } from 'svelte';
  import { html as htmlLang } from '@codemirror/lang-html';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api } from '../../core/backend';
  import { dirname } from '../../core/paths';
  import { toastError } from '../../core/ui.svelte';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { buildPage } from './page';
  import { htmlViews, type ViewMode } from './views';

  let { tab }: { tab: Tab } = $props();

  const restored = (tab.restoredState as { view?: ViewMode; scripts?: boolean; remote?: boolean } | undefined) ?? {};
  let view = $state<ViewMode>(restored.view ?? 'preview');
  let ratio = $state(savedRatio('html'));
  let scripts = $state(!!restored.scripts);
  let remote = $state(!!restored.remote);
  let srcdoc = $state('');
  let info = $state({ title: '', remoteRefs: 0, externalLinks: 0 });
  let base = '';
  let ctl: TextController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  htmlViews.set(tab.id, {
    get: () => view,
    set: (v) => {
      view = v;
      workspace.touch();
      queueMicrotask(() => ctl?.view.requestMeasure());
      if (v !== 'source') render();
    },
    reload: () => render(),
  });

  const options = {
    language: htmlLang(),
    onDocChanged: () => schedule(),
    onLoaded: () => void init(),
    wrap: true,
  };

  async function init() {
    const dir = tab.filePath ? dirname(tab.filePath) : '';
    if (dir) {
      try {
        base = `${location.origin}/__hia/page/${await api.PageRoot(dir)}/`;
      } catch {
        base = '';
      }
    }
    render();
  }

  function schedule() {
    clearTimeout(timer);
    const len = ctl?.view.state.doc.length ?? 0;
    timer = setTimeout(render, len > 300_000 ? 900 : 300);
  }

  function render() {
    if (!ctl || view === 'source') return;
    const built = buildPage(ctl.view.state.doc.toString(), { base: base || `${location.origin}/__hia/page/none/`, origin: location.origin, scripts, remote });
    info = { title: built.title, remoteRefs: built.remoteRefs, externalLinks: built.externalLinks };
    srcdoc = built.html;
    tab.status = { ...tab.status, type: 'HTML page', info: built.title || undefined };
  }

  function toggle(which: 'scripts' | 'remote') {
    if (which === 'scripts') scripts = !scripts;
    else remote = !remote;
    workspace.touch();
    render();
  }

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view, scripts, remote });
  }

  onMount(() => () => {
    htmlViews.delete(tab.id);
    clearTimeout(timer);
  });

  (tab as unknown as { htmlTest: unknown }).htmlTest = { srcdoc: () => srcdoc, info: () => info, toggle, render, base: () => base };
</script>

<div class="toolbar" use:fitBar>
  <div class="seg" role="group" aria-label="View">
    <button class="btn ghost" class:on={view === 'source'} onclick={() => htmlViews.get(tab.id)?.set('source')}><Icon icon={Code} size={14} /> Source</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => htmlViews.get(tab.id)?.set('split')}><Icon icon={Columns2} size={14} /> Split</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => htmlViews.get(tab.id)?.set('preview')}><Icon icon={Eye} size={14} /> Page</button>
  </div>
  <span class="spacer"></span>
  {#if view !== 'source'}
    <button class="btn ghost" class:on={scripts} title="Run the page's JavaScript (sandboxed, no access to your files or the app)" onclick={() => toggle('scripts')}><Icon icon={SquareCode} size={14} /> Scripts</button>
    <button class="btn ghost" class:on={remote} title="Load images, fonts and styles from the internet" onclick={() => toggle('remote')}><Icon icon={Globe} size={14} /> Remote content</button>
    <button class="btn ghost" title="Reload" onclick={render}><Icon icon={RefreshCw} size={14} /> Reload</button>
    <span class="sep"></span>
  {/if}
  {#if tab.filePath}<button class="btn ghost" title="Open in your web browser" onclick={() => api.OpenInBrowser(tab.filePath!).catch((e) => toastError(e))}><Icon icon={ExternalLink} size={14} /> Open in browser</button>{/if}
</div>
{#if view !== 'source' && !remote && info.remoteRefs > 0}
  <div class="banner">
    <span class="grow">This page references {info.remoteRefs} item{info.remoteRefs === 1 ? '' : 's'} on the internet (images, fonts, styles or scripts), blocked to keep you offline.</span>
    <button class="btn" onclick={() => toggle('remote')}>Load remote content</button>
  </div>
{/if}
<div class="panes" data-view={view}>
  <div class="src" style:flex={view === 'split' ? `0 0 ${ratio * 100}%` : null}><TextEditor {tab} {options} onready={ready} /></div>
  {#if view === 'split'}<PaneDivider bind:ratio key="html" />{/if}
  {#if view !== 'source'}
    <div class="page">
      {#key `${scripts}`}
        <iframe title={info.title || tab.title} sandbox={scripts ? 'allow-scripts' : ''} {srcdoc}></iframe>
      {/key}
    </div>
  {/if}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg .btn {
    height: 26px;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .src {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .page {
    flex: 1;
    min-width: 0;
    display: flex;
    border-left: 1px solid var(--border-soft);
    background: #fff;
  }
  iframe {
    flex: 1;
    border: none;
    background: #fff;
  }
  .panes[data-view='preview'] .src {
    display: none;
  }
  .panes[data-view='preview'] .page {
    border-left: none;
  }
</style>
