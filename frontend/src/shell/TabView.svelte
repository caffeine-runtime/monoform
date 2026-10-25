<script lang="ts">
  // Hosts one tab's module. The module chunk loads on first activation and the
  // component stays mounted (hidden) while the tab is open, so editor state,
  // undo history and scroll position survive tab switches.
  import { modules, type LoadedModule } from '../core/modules';
  import { workspace, type Tab } from '../core/tabs.svelte';
  import ExternalChangeBanner from './ExternalChangeBanner.svelte';
  import { paneRect } from '../core/split';
  import { give, type Transfer } from '../core/transfer.svelte';
  import { t } from '../core/i18n';

  let { tab }: { tab: Tab } = $props();
  const active = $derived(workspace.activeId === tab.id);
  const shown = $derived(workspace.isShown(tab.id));
  // In split view the tab sits in its pane; the focused pane is outlined.
  const rect = $derived.by(() => {
    const s = workspace.split;
    const i = s ? s.panes.indexOf(tab.id) : -1;
    return s && i >= 0 ? paneRect(s, i) : null;
  });
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

  // HTML drops the module itself didn't take (text dragged out of an editor,
  // a file from the sidebar, a picture from a browser) go to the tab's accept.
  function fromDrop(e: DragEvent): Transfer | Promise<Transfer> | null {
    const dt = e.dataTransfer;
    if (!dt) return null;
    const path = dt.getData('application/x-mf-path');
    if (path) return { kind: 'files', paths: [path] };
    const img = Array.from(dt.files).find((f) => f.type.startsWith('image/'));
    if (img)
      return createImageBitmap(img).then((b) => {
        const c = document.createElement('canvas');
        c.width = b.width;
        c.height = b.height;
        c.getContext('2d')!.drawImage(b, 0, 0);
        b.close();
        return { kind: 'image', image: c, name: img.name.replace(/\.[^.]+$/, '') } as Transfer;
      });
    const text = dt.getData('text/plain');
    return text ? { kind: 'text', text } : null;
  }
  function takes(e: DragEvent): boolean {
    const kinds = tab.handlers.accept?.kinds ?? [];
    const types = e.dataTransfer?.types ?? [];
    return (types.includes('application/x-mf-path') && kinds.includes('files')) || (types.includes('Files') && kinds.includes('image')) || (types.includes('text/plain') && kinds.includes('text'));
  }
  async function drop(e: DragEvent) {
    if (e.defaultPrevented || !takes(e)) return;
    const t = fromDrop(e);
    if (!t) return;
    e.preventDefault();
    await give(tab, await t, { x: e.clientX, y: e.clientY });
  }
  let mod = $state<LoadedModule | null>(null);
  let error = $state('');
  let slow = $state(false);

  $effect(() => {
    const id = tab.moduleId;
    mod = null;
    error = '';
    const timer = setTimeout(() => (slow = true), 150);
    modules
      .load(id)
      .then((m) => {
        if (tab.moduleId === id) mod = m;
      })
      .catch((e) => (error = t("Couldn't load the {module} module: {error}", { module: id, error: String(e?.message ?? e) })))
      .finally(() => {
        clearTimeout(timer);
        slow = false;
      });
    return () => clearTimeout(timer);
  });
</script>

<div
  class="tabview"
  class:active
  class:shown
  class:pane={!!rect}
  data-module={tab.moduleId}
  data-tab-id={tab.id}
  role="tabpanel"
  aria-hidden={!shown}
  style:left={rect ? pct(rect.left) : null}
  style:top={rect ? pct(rect.top) : null}
  style:width={rect ? pct(rect.width) : null}
  style:height={rect ? pct(rect.height) : null}
  onpointerdowncapture={() => !active && shown && workspace.activate(tab)}
  ondragover={(e) => !e.defaultPrevented && takes(e) && e.preventDefault()}
  ondrop={drop}
  onfocusin={() => !active && shown && workspace.activate(tab)}
>
  {#if tab.external}
    <ExternalChangeBanner {tab} />
  {/if}
  <div class="body">
    {#if error}
      <div class="empty-state">{error}</div>
    {:else if mod}
      {@const C = mod.default}
      {#key tab.mountKey}
        <C {tab} />
      {/key}
    {:else if slow}
      <div class="empty-state"><span class="spinner"></span></div>
    {/if}
  </div>
</div>

<style>
  .tabview {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    background: var(--bg);
  }
  .tabview.shown {
    display: flex;
    animation: mf-fade var(--dur-1) var(--ease-out);
  }
  .tabview.pane {
    inset: auto;
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    overflow: hidden;
  }
  .tabview.pane.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    z-index: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
</style>
