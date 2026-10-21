<script lang="ts">
  // "Take this somewhere else": click copies it (Ctrl+V pastes it into any
  // tab that takes it), dragging carries it onto another tab's view.
  import Icon from './Icon.svelte';
  import Grip from '@lucide/svelte/icons/grip-vertical';
  import type { Tab } from '../core/tabs.svelte';
  import { copyTransfer, describe, transferDrag, type Transfer } from '../core/transfer.svelte';
  import { ui } from '../core/ui.svelte';

  let { tab, get, what }: { tab: Tab; get: () => Transfer | null | Promise<Transfer | null>; what: string } = $props();

  async function copy() {
    if (transferDrag.justDropped) return;
    const t = await get();
    if (!t) return;
    await copyTransfer(t);
    ui.toast(`Copied ${describe(t)} — paste it into another tab with Ctrl+V, or drag this button there.`, 'success');
  }
</script>

<button class="icon-btn give" title="Copy {what}, or drag it into another tab" aria-label="Copy or drag {what}" onclick={copy} onpointerdown={(e) => transferDrag.start(e, tab, get)}>
  <Icon icon={Grip} size={15} />
</button>

<style>
  .give {
    cursor: grab;
    touch-action: none;
  }
</style>
