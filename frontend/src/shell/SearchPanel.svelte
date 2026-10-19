<script lang="ts">
  import { sidebar } from '../core/sidebar.svelte';
</script>

<div class="empty-state">
  <p>Folder search arrives in M1.</p>
  <button class="btn" onclick={() => (sidebar.mode = 'files')}>Back</button>
</div>
