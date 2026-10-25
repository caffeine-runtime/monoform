<script lang="ts">
  // A CodeMirror editor bound to a tab. Used directly by the text module and
  // embedded by the markdown module.
  import { onMount, untrack } from 'svelte';
  import type { Tab } from '../../core/tabs.svelte';
  import { toastError } from '../../core/ui.svelte';
  import { t } from '../../core/i18n';
  import { TextController, type ControllerOptions } from './controller';
  import { controllers } from './controllers';
  import { settings } from '../../core/settings.svelte';

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
      // Text from another tab goes in at the drop point or the cursor.
      accept: {
        kinds: ['text'],
        take: (t, at) => {
          if (tab.readOnly || ctl.view.state.readOnly || t.kind !== 'text') return false;
          const text = t.text;
          const pos = (at && ctl.view.posAtCoords(at)) ?? ctl.view.state.selection.main.head;
          ctl.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
          ctl.view.focus();
          return true;
        },
      },
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
        toastError(e, t("Couldn't open {name}", { name: tab.title }));
      });
    return () => {
      controllers.delete(tab.id);
      ctl.destroy();
    };
  });

  // Text or interface size changed (settings, sliders): the font is CSS, so
  // CodeMirror doesn't notice — have it measure its lines again, else it keeps
  // the old line height (lines overlap or gap, clicks land on the wrong line).
  $effect(() => {
    void settings.value.fontSize;
    void settings.value.uiScale;
    const ctl = controllers.get(tab.id);
    if (!ctl) return;
    // After App's effect has set the new CSS variables and the browser has applied them.
    requestAnimationFrame(() => ctl.view.requestMeasure());
  });

  // Word wrap turned on or off (tool bar button, Alt+Z, menu, Settings) in any tab.
  $effect(() => {
    const on = settings.value.wordWrap;
    untrack(() => controllers.get(tab.id)?.followWrap(on));
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
