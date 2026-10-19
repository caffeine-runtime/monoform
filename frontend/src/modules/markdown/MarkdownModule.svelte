<script lang="ts">
  import { onMount } from 'svelte';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import type { Tab } from '../../core/tabs.svelte';
  import { workspace } from '../../core/tabs.svelte';
  import { api } from '../../core/backend';
  import { boot } from '../../core/boot';
  import TextEditor from '../text/TextEditor.svelte';
  import type { TextController } from '../text/controller';
  import { assetHandlers } from './assets';
  import { markdownViews, type ViewMode } from './views';
  import MdWorker from './mdWorker?worker';
  import './preview.css';

  let { tab }: { tab: Tab } = $props();

  const restored = (tab.restoredState as { view?: ViewMode } | undefined)?.view;
  let view = $state<ViewMode>(restored ?? 'split');
  let html = $state('');
  let previewEl = $state<HTMLDivElement>();
  let ctl: TextController | null = null;
  let worker: Worker | null = null;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncing = false;

  markdownViews.set(tab.id, {
    get: () => view,
    set: (v) => {
      view = v;
      workspace.touch();
      queueMicrotask(() => ctl?.view.requestMeasure());
    },
  });

  const options = {
    language: markdown({ codeLanguages: languages }),
    extensions: [assetHandlers(tab)],
    onDocChanged: () => schedule(),
    onLoaded: () => render(),
    wrap: true,
  };

  function schedule() {
    clearTimeout(timer);
    const len = ctl?.view.state.doc.length ?? 0;
    timer = setTimeout(render, len > 500_000 ? 600 : 120);
  }

  function render() {
    if (!ctl || view === 'source') return;
    worker ??= new MdWorker();
    const id = ++seq;
    worker.onmessage = (e) => {
      if (e.data.id === seq) html = e.data.html;
    };
    worker.postMessage({ id, text: ctl.view.state.doc.toString(), base: tab.path ?? '', token: boot.token });
  }

  $effect(() => {
    if (view !== 'source') render();
  });

  function ready(c: TextController) {
    ctl = c;
    tab.handlers.getState = () => ({ view });
    const prevShow = tab.handlers.onShow;
    tab.handlers.onShow = () => {
      prevShow?.();
      if (view !== 'source') render();
    };
    c.view.scrollDOM.addEventListener('scroll', syncFromEditor, { passive: true });
  }

  // Editor → preview scroll sync using data-line markers.
  function syncFromEditor() {
    if (!ctl || !previewEl || view !== 'split' || syncing) return;
    const v = ctl.view;
    const top = v.scrollDOM.scrollTop;
    const block = v.lineBlockAtHeight(top);
    const line = v.state.doc.lineAt(block.from).number;
    const els = previewEl.querySelectorAll<HTMLElement>('[data-line]');
    let target: HTMLElement | null = null;
    for (const el of els) {
      if (Number(el.dataset.line) <= line) target = el;
      else break;
    }
    if (v.scrollDOM.scrollTop + v.scrollDOM.clientHeight >= v.scrollDOM.scrollHeight - 4) {
      previewEl.scrollTop = previewEl.scrollHeight;
      return;
    }
    previewEl.scrollTop = target ? target.offsetTop - 12 : 0;
  }

  function click(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const { file, anchor, external } = a.dataset;
    if (external) {
      void api.OpenExternal(external);
    } else if (file) {
      void workspace.openPath(file);
    } else if (anchor && previewEl) {
      previewEl.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  onMount(() => () => {
    markdownViews.delete(tab.id);
    worker?.terminate();
    clearTimeout(timer);
  });
</script>

<div class="toolbar">
  <div class="seg" role="group" aria-label="View">
    <button class="btn ghost" class:on={view === 'source'} onclick={() => markdownViews.get(tab.id)?.set('source')}>Source</button>
    <button class="btn ghost" class:on={view === 'split'} onclick={() => markdownViews.get(tab.id)?.set('split')}>Split</button>
    <button class="btn ghost" class:on={view === 'preview'} onclick={() => markdownViews.get(tab.id)?.set('preview')}>Preview</button>
  </div>
</div>
<div class="panes" data-view={view}>
  <div class="src"><TextEditor {tab} {options} onready={ready} /></div>
  {#if view !== 'source'}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="preview selectable" bind:this={previewEl} onclick={click}>
      <article class="md">{@html html}</article>
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
  .preview {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    border-left: 1px solid var(--border-soft);
    position: relative;
  }
  .panes[data-view='preview'] .src {
    display: none;
  }
  .panes[data-view='preview'] .preview {
    border-left: none;
  }
</style>
