<script lang="ts">
  // The first-run welcome: a few calm steps over the app, then the start
  // page. Shown once (settings.welcomeDone); Help › Welcome shows it again.
  // Loaded only when shown.
  import type { Component } from 'svelte';
  import Icon from './Icon.svelte';
  import FileText from '@lucide/svelte/icons/file-text';
  import ImageIcon from '@lucide/svelte/icons/image';
  import Film from '@lucide/svelte/icons/film';
  import Table from '@lucide/svelte/icons/table';
  import FileArchive from '@lucide/svelte/icons/file-archive';
  import Box from '@lucide/svelte/icons/box';
  import Pencil from '@lucide/svelte/icons/pencil';
  import History from '@lucide/svelte/icons/history';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Languages from '@lucide/svelte/icons/languages';
  import { LANGUAGES, t, type Lang } from '../core/i18n';
  import { chooseLanguage, systemLanguage } from '../core/language';
  import { formatShortcut } from '../core/keys';
  import { settings } from '../core/settings.svelte';
  import { theme } from '../core/theme.svelte';
  import { ui } from '../core/ui.svelte';

  type Step = { title: string; text: string; icons: Component<any>[] };
  const steps: Step[] = [
    {
      title: t('Open almost anything'),
      text: t('Documents, spreadsheets, PDFs, images, video, audio, 3D models, data and archives — each in a view made for it, all in one window.'),
      icons: [FileText, ImageIcon, Film, Table, Box, FileArchive],
    },
    {
      title: t('Edit it right here'),
      text: t('Fix a typo, crop a photo, sign a PDF, trim a clip — then save. Every save keeps the version before it, so nothing is ever lost.'),
      icons: [Pencil, History, Undo2],
    },
    {
      title: t('Free, open and offline'),
      text: t('Open source and free, built with AI. No account, no cloud, no tracking: your files stay on this computer, and the app works without the internet.'),
      icons: [ShieldCheck, WifiOff, HardDrive],
    },
  ];
  const last = steps.length; // the "make it yours" step
  let step = $state(0);
  let el = $state<HTMLDivElement>();

  $effect(() => {
    el?.focus();
  });

  function done() {
    settings.update((s) => (s.welcomeDone = true));
    void settings.flush();
    ui.firstRun = false;
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') done();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') step < last ? step++ : done();
    else if (e.key === 'ArrowLeft') step = Math.max(0, step - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const themes = [
    { id: 'system', label: t('Like my computer'), icon: Monitor },
    { id: 'light', label: t('Light', {}, 'theme'), icon: Sun },
    { id: 'dark', label: t('Dark', {}, 'theme'), icon: Moon },
  ] as const;
  const nameOf = (l: Lang) => LANGUAGES.find((x) => x.id === l)!.name;
</script>

<div class="firstrun" role="dialog" aria-modal="true" aria-label={t('Welcome')} tabindex="-1" bind:this={el} onkeydown={key}>
  <div class="card">
    {#key step}
      <div class="body">
        {#if step < last}
          {@const s = steps[step]}
          <div class="art" aria-hidden="true">
            {#each s.icons as ic, i (i)}
              <span class="ic" style:--i={i}><Icon icon={ic} size={20} /></span>
            {/each}
          </div>
          {#if step === 0}
            <label class="lang" title={t('Language of the app — you can change it later in Settings')}>
              <Icon icon={Languages} size={14} />
              <select value={settings.value.language ?? ''} aria-label={t('Language')} onchange={(e) => void chooseLanguage((e.currentTarget as HTMLSelectElement).value as Lang | '')}>
                <option value="">{t('Like my computer ({language})', { language: nameOf(systemLanguage()) })}</option>
                {#each LANGUAGES as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
              </select>
            </label>
            <p class="hello">{t('Welcome to Monoform')}</p>
          {/if}
          <h1>{s.title}</h1>
          <p class="text">{s.text}</p>
        {:else}
          <p class="hello">{t('One last thing')}</p>
          <h1>{t('Make it yours')}</h1>
          <p class="text">{t('Pick a look — you can change it any time in Settings.')}</p>
          <div class="themes" role="radiogroup" aria-label={t('Theme')}>
            {#each themes as t (t.id)}
              <button class="theme" class:on={settings.value.theme === t.id} role="radio" aria-checked={settings.value.theme === t.id} onclick={() => theme.set(t.id)}>
                <Icon icon={t.icon} size={18} />
                <span>{t.label}</span>
              </button>
            {/each}
          </div>
          <p class="tip">{t('Tip:')} <span class="kbd">{formatShortcut('Mod+K')}</span> {t('finds any file, text or command.')}</p>
        {/if}
      </div>
    {/key}
    <div class="foot">
      <div class="dots" aria-hidden="true">
        {#each { length: last + 1 } as _, i (i)}<span class="dot" class:on={i === step}></span>{/each}
      </div>
      <span class="spacer"></span>
      {#if step < last}
        <button class="btn ghost" onclick={done}>{t('Skip')}</button>
      {:else}
        <button class="btn ghost" onclick={() => step--}>{t('Back')}</button>
      {/if}
      <button class="btn primary go" onclick={() => (step < last ? step++ : done())}>{step < last ? t('Next') : t('Get started')}</button>
    </div>
  </div>
</div>

<style>
  .firstrun {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(6px);
    outline: none;
    animation: fade 0.2s var(--ease);
  }
  .lang {
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 6px;
    margin: 0 auto 14px;
    padding: 2px 4px 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-soft);
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .lang select {
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    padding: 4px 2px;
    cursor: pointer;
    outline: none;
  }
  .card {
    width: min(460px, 100%);
    border-radius: 20px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }
  .body {
    padding: 34px 32px 8px;
    min-height: 268px;
    animation: rise 0.22s var(--ease);
  }
  .art {
    display: flex;
    gap: 8px;
    margin-bottom: 26px;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--bg-hover);
    color: var(--text-muted);
    animation: rise 0.3s var(--ease) both;
    animation-delay: calc(var(--i) * 40ms);
  }
  .hello {
    margin: 0 0 4px;
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0 0 10px;
    font-size: calc(24px * var(--ui-scale));
  }
  .text {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.55;
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 20px 0 16px;
  }
  .theme {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 6px;
    border: 1px solid var(--border-soft);
    border-radius: 12px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-small);
    text-align: center;
  }
  .theme:hover {
    background: var(--bg-hover);
  }
  .theme.on {
    border-color: var(--accent);
    color: var(--text);
    background: var(--accent-soft);
  }
  .tip {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 18px 32px;
  }
  .spacer {
    flex: 1;
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    transition: width 0.2s var(--ease);
  }
  .dot.on {
    width: 18px;
    background: var(--accent);
  }
  .go {
    min-width: 96px;
    justify-content: center;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
