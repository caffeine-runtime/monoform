<script lang="ts">
  import type { Component } from 'svelte';
  let { icon, size = 16, stroke = 1.6, class: cls = '' }: { icon: Component<any>; size?: number; stroke?: number; class?: string } = $props();
  const Ico = $derived(icon);
</script>

<Ico {size} strokeWidth={stroke} class={cls} aria-hidden="true" />
