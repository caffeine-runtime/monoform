<script lang="ts">
  // The history, oldest first, as in Photoshop: click a step to go back (or
  // forward again) to it; the steps after it stay until something new is done.
  import { t } from '../../core/i18n';
  import { MAX_HISTORY, type EditorState, type ImageEditor } from './editor';

  let { editor, es }: { editor: ImageEditor; es: EditorState } = $props();

  let list = $state<HTMLOListElement>();

  // Keep the current step in view.
  $effect(() => {
    void es.step;
    void es.steps.length;
    list?.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="history">
  <ol class="steps" bind:this={list} aria-label={t('History')}>
    {#each es.steps as name, i (i)}
      <li>
        <button class="step" class:current={i === es.step} class:future={i > es.step} aria-current={i === es.step ? 'step' : undefined} title={i > es.step ? t('Undone: click to redo up to here') : t('Go back to here')} onclick={() => editor.goTo(i)}>
          <span class="n">{i + 1}</span>
          <span class="name">{name}</span>
        </button>
      </li>
    {/each}
  </ol>
  <p class="note">{t('Click a step to go back to it. Up to {n} steps are kept.', { n: String(MAX_HISTORY) })}</p>
</div>

<style>
  .history {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .step:hover {
    background: var(--bg-hover);
  }
  .step.current {
    background: var(--accent-soft);
    font-weight: 600;
  }
  .step.future {
    color: var(--text-faint);
    font-style: italic;
  }
  .n {
    min-width: 20px;
    color: var(--text-faint);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 0;
    padding: 6px 10px;
    border-top: 1px solid var(--border-soft);
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
</style>
