<script lang="ts">
  import type { Tab } from '../../core/tabs.svelte';
  let { tab }: { tab: Tab } = $props();
  let text = $state('');
  $effect(() => {
    tab.read().then((b) => (text = new TextDecoder().decode(b)));
  });
</script>

<pre class="selectable">{text}</pre>
