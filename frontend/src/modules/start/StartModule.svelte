<script lang="ts">
  // A "new tab": the start page in a tab. Whatever is opened from it takes
  // its place (see workspace.add).
  import { onMount } from 'svelte';
  import Welcome from '../../shell/Welcome.svelte';
  import type { ModuleProps } from '../../core/modules';

  let { tab }: ModuleProps = $props();
  onMount(() => {
    tab.status = { ...tab.status, type: 'New tab' };
  });
</script>

<Welcome />
