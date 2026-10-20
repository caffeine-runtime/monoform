<script lang="ts">
  import type { Component } from 'svelte';
  import { settings } from '../core/settings.svelte';
  let { icon, size = 16, stroke = 1.6, class: cls = '' }: { icon: Component<any>; size?: number; stroke?: number; class?: string } = $props();
  const Ico = $derived(icon);
  const px = $derived(Math.round(size * (settings.value.uiScale || 1)));
</script>

<Ico size={px} strokeWidth={stroke} class={cls} aria-hidden="true" />
