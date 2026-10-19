<script lang="ts">
  import type { Tab } from '../../core/tabs.svelte';
  import TextEditor from './TextEditor.svelte';
  let { tab }: { tab: Tab } = $props();
</script>

<TextEditor {tab} />
