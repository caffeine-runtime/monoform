<script lang="ts">
  // The screen recorder's window (monoform --record): the options, then —
  // once a screen or window is chosen in the system's share step — a small
  // bar at the bottom of the screen (left out of the recording) with the
  // time, microphone, pause, stop and discard.
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Timer from '@lucide/svelte/icons/timer';
  import Film from '@lucide/svelte/icons/film';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { AlertTriangle, FolderOpen, X } from '../core/icons';
  import { api } from '../core/backend';
  import { recorder } from '../core/recorder.svelte';
  import { clock, shortFolder } from '../core/record';
  import { t } from '../core/i18n';

  const r = recorder;
  const bar = $derived(r.phase === 'countdown' || r.phase === 'recording' || r.phase === 'saving' || r.phase === 'done');
  let confirmDiscard = $state(false);
  let panelEl = $state<HTMLElement>();
  let barEl = $state<HTMLElement>();
  let sized = '';

  // The window takes the size of what it shows.
  async function fit() {
    await tick();
    const el = bar ? barEl : panelEl;
    if (!el) return;
    const w = Math.ceil(el.offsetWidth);
    const h = Math.ceil(el.offsetHeight);
    const key = `${bar ? 'bar' : 'panel'} ${w}×${h}`;
    if (key === sized || !w || !h) return;
    sized = key;
    await api.RecorderLayout(bar ? 'bar' : 'panel', w, h);
  }

  $effect(() => {
    const el = bar ? barEl : panelEl;
    if (!el) return;
    const ro = new ResizeObserver(() => void fit());
    ro.observe(el);
    return () => ro.disconnect();
  });
  $effect(() => {
    if (r.phase !== 'recording') confirmDiscard = false;
  });

  onMount(() => {
    void r.startMic();
    void document.fonts?.ready.then(fit);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (confirmDiscard) confirmDiscard = false;
    else if (r.phase === 'countdown') r.cancelCountdown();
    else if (!bar) r.close();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if !bar}
  <section class="panel" bind:this={panelEl} aria-label={t('Record the screen')}>
    <header style="--wails-draggable: drag">
      <span class="rdot" aria-hidden="true"></span>
      <h1>{t('Record the screen')}</h1>
      <button class="icon-btn close" title={t('Close')} onclick={() => r.close()}><Icon icon={X} size={15} /></button>
    </header>

    {#if !r.available}
      <p class="notice"><Icon icon={AlertTriangle} size={15} /> {t('Screen recording isn’t available on this system.')}</p>
      <footer><span class="spacer"></span><button class="btn" onclick={() => r.close()}>{t('Close')}</button></footer>
    {:else}
      <div class="opts">
        <div class="opt">
          <span class="ico"><Icon icon={Mic} /></span>
          <label class="txt" for="rec-mic">
            <span class="name">{t('Microphone')}</span>
            {#if !r.prefs.mic}<span class="hint">{t('Record your voice too.')}</span>{/if}
          </label>
          <button id="rec-mic" class="switch" role="switch" aria-checked={r.prefs.mic} aria-label={t('Microphone')} onclick={() => r.setPrefs({ mic: !r.prefs.mic })}><span></span></button>
        </div>
        {#if r.prefs.mic}
          <div class="sub">
            {#if r.micError}
              <p class="err">
                {r.micError}
                {#if r.micBlocked}<button class="link" onclick={() => void api.OpenMicrophoneSettings()}>{t('Open privacy settings')}</button>{/if}
                <button class="link" onclick={() => void r.startMic()}>{t('Try again')}</button>
              </p>
            {:else}
              <select class="input" aria-label={t('Which microphone')} value={r.prefs.micId} onchange={(e) => r.setPrefs({ micId: (e.currentTarget as HTMLSelectElement).value })}>
                <option value="">{t('Default microphone')}</option>
                {#each r.mics as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
              </select>
              <div class="meter" role="meter" aria-label={t('Microphone level')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.round(r.level * 100) / 100}>
                <div class="fill" style:transform="scaleX({r.level})"></div>
              </div>
            {/if}
          </div>
        {/if}

        <div class="opt">
          <span class="ico"><Icon icon={Volume2} /></span>
          <div class="txt">
            <span class="name">{t('Sound from the computer')}</span>
            <span class="hint">{t('Choose a whole screen and turn on “Share system audio” in the next step.')}</span>
          </div>
        </div>

        <div class="opt">
          <span class="ico"><Icon icon={Timer} /></span>
          <label class="txt" for="rec-count"><span class="name">{t('Count down 3 seconds')}</span></label>
          <button id="rec-count" class="switch" role="switch" aria-checked={r.prefs.countdown} aria-label={t('Count down 3 seconds')} onclick={() => r.setPrefs({ countdown: !r.prefs.countdown })}><span></span></button>
        </div>

        <div class="opt">
          <span class="ico"><Icon icon={Film} /></span>
          <div class="txt">
            <span class="name">{t('Frame rate')}</span>
            <span class="hint">{r.prefs.fps === 60 ? t('Smooth motion, for games and animation; bigger files.') : t('Right for apps, slides and the web.')}</span>
          </div>
          <div class="seg" role="radiogroup" aria-label={t('Frame rate')}>
            {#each [30, 60] as const as fps (fps)}
              <button role="radio" aria-checked={r.prefs.fps === fps} class:on={r.prefs.fps === fps} onclick={() => r.setPrefs({ fps })}>{t('{n} fps', { n: fps })}</button>
            {/each}
          </div>
        </div>
      </div>

      {#if r.error}
        <p class="error" role="alert"><Icon icon={AlertTriangle} size={14} /> <span>{r.error}</span></p>
      {/if}

      <button class="where" title={t('Recordings are saved in {folder}', { folder: r.folder })} onclick={() => void api.ShowInFolder(r.folder)}>
        <Icon icon={FolderOpen} size={13} /> <span>{t('Saved to {folder}', { folder: shortFolder(r.folder) })}</span>
      </button>

      <footer>
        <span class="spacer"></span>
        <button class="btn" onclick={() => r.close()}>{t('Cancel')}</button>
        <button class="btn primary go" disabled={r.phase === 'picking'} onclick={() => void r.choose()}>
          {#if r.phase === 'picking'}<Icon icon={LoaderCircle} size={14} class="spin" /> {t('Choose in the other window…')}{:else}<span class="rdot white" aria-hidden="true"></span> {t('Choose what to record…')}{/if}
        </button>
      </footer>
    {/if}
  </section>
{:else}
  <div class="bar" bind:this={barEl} style="--wails-draggable: drag" role="toolbar" aria-label={t('Recording')}>
    {#if r.phase === 'countdown'}
      <span class="count" aria-live="assertive">{r.count}</span>
      <span class="label">{t('Recording starts…')}</span>
      <button class="btn" onclick={() => r.cancelCountdown()}>{t('Cancel')}</button>
    {:else if r.phase === 'saving' || r.phase === 'done'}
      <Icon icon={LoaderCircle} size={16} class="spin" />
      <span class="label">{t('Saving the recording…')}</span>
    {:else if confirmDiscard}
      <span class="label">{t('Throw this recording away?')}</span>
      <button class="btn" onclick={() => (confirmDiscard = false)}>{t('Keep recording')}</button>
      <button class="btn discard" onclick={() => void r.discard()}>{t('Discard')}</button>
    {:else}
      <span class="grip" title={t('Drag to move')}><Icon icon={GripVertical} size={14} /></span>
      <span class="rdot live" class:paused={r.paused} aria-hidden="true"></span>
      <span class="time" class:paused={r.paused} aria-label={r.paused ? t('Paused at {time}', { time: clock(r.elapsed) }) : t('Recording: {time}', { time: clock(r.elapsed) })}>{clock(r.elapsed)}</span>
      <span class="sep"></span>
      {#if r.prefs.mic && !r.micError}
        <button class="icon-btn" class:off={r.muted} title={r.muted ? t('Turn the microphone on') : t('Mute the microphone')} onclick={() => r.toggleMute()}>
          <Icon icon={r.muted ? MicOff : Mic} />
        </button>
      {/if}
      <button class="icon-btn" title={r.paused ? t('Resume') : t('Pause')} onclick={() => r.togglePause()}><Icon icon={r.paused ? Play : Pause} /></button>
      <button class="btn stop" title={t('Stop and save the recording')} onclick={() => void r.stop()}><span class="sq" aria-hidden="true"></span> {t('Stop')}</button>
      <button class="icon-btn" title={t('Discard the recording…')} onclick={() => (confirmDiscard = true)}><Icon icon={Trash2} /></button>
    {/if}
  </div>
{/if}

<style>
  :global(html),
  :global(body) {
    background: var(--bg-elevated);
    overflow: hidden;
  }
  .panel {
    width: calc(420px * var(--ui-scale));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-sizing: border-box;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 10px 6px 18px;
  }
  h1 {
    flex: 1;
    margin: 0;
    font-size: calc(15px * var(--ui-scale));
    font-weight: 600;
  }
  .close,
  button,
  select,
  .where {
    --wails-draggable: no-drag;
  }
  .rdot {
    width: calc(10px * var(--ui-scale));
    height: calc(10px * var(--ui-scale));
    border-radius: 50%;
    background: #e5484d;
    flex: none;
  }
  .rdot.white {
    background: #fff;
    width: calc(8px * var(--ui-scale));
    height: calc(8px * var(--ui-scale));
  }
  .opts {
    display: flex;
    flex-direction: column;
    padding: 6px 10px 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    min-height: calc(40px * var(--ui-scale));
  }
  .opt + .opt,
  .sub + .opt {
    border-top: 1px solid var(--border-soft);
  }
  .ico {
    color: var(--text-muted);
    display: inline-flex;
    flex: none;
  }
  .txt {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 500;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--fs-small);
    line-height: 1.35;
  }
  .sub {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 8px 12px calc(8px + 12px + 16px * var(--ui-scale));
  }
  .sub select {
    width: 100%;
  }
  .meter {
    height: 4px;
    border-radius: 2px;
    background: var(--bg-active);
    overflow: hidden;
  }
  .meter .fill {
    height: 100%;
    background: var(--success);
    transform-origin: left;
    transition: transform 60ms linear;
  }
  .err {
    margin: 0;
    color: var(--warning);
    font-size: var(--fs-small);
    line-height: 1.4;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    margin-left: 6px;
    color: var(--accent-text);
    cursor: pointer;
    font-size: inherit;
  }
  .link:hover {
    text-decoration: underline;
  }
  .switch {
    position: relative;
    width: calc(34px * var(--ui-scale));
    height: calc(20px * var(--ui-scale));
    flex: none;
    border: none;
    border-radius: 999px;
    background: var(--bg-active);
    cursor: pointer;
    padding: 0;
    transition: background var(--dur-1) var(--ease);
  }
  .switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(14px * var(--ui-scale));
    height: calc(14px * var(--ui-scale));
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform var(--dur-2) var(--ease-out), background var(--dur-1) var(--ease);
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
  }
  .switch[aria-checked='true'] span {
    background: #fff;
    transform: translateX(calc(14px * var(--ui-scale)));
  }
  .seg {
    display: inline-flex;
    flex: none;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--bg-input);
    border: 1px solid var(--border);
  }
  .seg button {
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  .seg button.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .notice,
  .error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 4px 18px 6px;
    padding: 8px 10px;
    border-radius: var(--radius);
    font-size: var(--fs-small);
    line-height: 1.4;
  }
  .notice {
    color: var(--text-muted);
    background: var(--bg-hover);
    margin: 10px 18px;
  }
  .error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 14px 12px;
    border-top: 1px solid var(--border-soft);
    margin-top: 4px;
  }
  .spacer {
    flex: 1;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: calc(100% - 28px);
    margin: 2px 0 0 14px;
    align-self: flex-start;
    border: none;
    background: none;
    padding: 4px 6px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .where span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .go {
    gap: 8px;
  }

  /* While recording: a small bar. */
  .bar {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: calc(48px * var(--ui-scale));
    padding: 0 8px 0 6px;
    box-sizing: border-box;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .grip {
    display: inline-flex;
    color: var(--text-faint);
    cursor: grab;
    padding: 0 2px;
  }
  .rdot.live {
    animation: pulse 1.6s ease-in-out infinite;
  }
  .rdot.paused {
    animation: none;
    background: var(--text-faint);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .time {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    min-width: calc(44px * var(--ui-scale));
    padding-left: 2px;
  }
  .time.paused {
    color: var(--text-muted);
    animation: blink 1.2s steps(2, jump-none) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .sep {
    width: 1px;
    height: calc(20px * var(--ui-scale));
    background: var(--border);
    margin: 0 2px;
  }
  .icon-btn.off {
    color: var(--danger);
  }
  .stop {
    gap: 8px;
    background: #e5484d;
    color: #fff;
    font-weight: 500;
  }
  .stop:hover {
    background: #d93d42;
  }
  .stop .sq {
    width: calc(9px * var(--ui-scale));
    height: calc(9px * var(--ui-scale));
    border-radius: 2px;
    background: #fff;
  }
  .discard {
    background: var(--danger);
    color: #fff;
  }
  .count {
    font-size: calc(22px * var(--ui-scale));
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: calc(28px * var(--ui-scale));
    text-align: center;
    color: #e5484d;
  }
  .label {
    padding: 0 6px;
  }
  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rdot.live,
    .time.paused,
    :global(.spin) {
      animation: none;
    }
  }
</style>
