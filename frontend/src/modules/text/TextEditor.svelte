<script lang="ts">
  // A CodeMirror editor bound to a tab. Used directly by the text module and
  // embedded by the markdown module.
  import { onMount } from 'svelte';
  import type { Tab } from '../../core/tabs.svelte';
  import { toastError } from '../../core/ui.svelte';
  import { TextController, type ControllerOptions } from './controller';
  import { controllers } from './controllers';

  let { tab, options = {}, onready }: { tab: Tab; options?: ControllerOptions; onready?: (c: TextController) => void } = $props();

  let host: HTMLDivElement;
  let failed = $state('');

  onMount(() => {
    const ctl = new TextController(tab, host, options);
    controllers.set(tab.id, ctl);
    tab.handlers = {
      ...tab.handlers,
      save: () => ctl.save(),
      saveAs: () => ctl.saveAs(),
      find: () => ctl.find(),
      reload: () => ctl.load(),
      focus: () => ctl.view.focus(),
      onShow: () => {
        ctl.view.requestMeasure();
        ctl.updateStatus();
        ctl.revealPending();
      },
    };
    onready?.(ctl);
    ctl
      .load()
      .then(() => ctl.view.focus())
      .catch((e) => {
        failed = String(e?.message ?? e);
        toastError(e, `Couldn't open ${tab.title}`);
      });
    return () => {
      controllers.delete(tab.id);
      ctl.destroy();
    };
  });

  // A search result clicked while the tab is already open.
  $effect(() => {
    if (tab.reveal) controllers.get(tab.id)?.revealPending();
  });
</script>

<div class="editor" bind:this={host}>
  {#if failed}<div class="empty-state">{failed}</div>{/if}
</div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  .editor :global(.cm-editor) {
    position: absolute;
    inset: 0;
  }
</style>
