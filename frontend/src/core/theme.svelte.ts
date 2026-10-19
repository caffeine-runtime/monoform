// Theme: follows the OS by default; the user can force dark or light.
import { settings } from './settings.svelte';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

class ThemeState {
  systemLight = $state(media?.matches ?? false);
  resolved = $derived<'dark' | 'light'>(
    settings.value.theme === 'system' ? (this.systemLight ? 'light' : 'dark') : (settings.value.theme as 'dark' | 'light'),
  );

  constructor() {
    media?.addEventListener('change', (e) => (this.systemLight = e.matches));
  }

  apply() {
    document.documentElement.dataset.theme = this.resolved;
  }

  set(mode: 'system' | 'dark' | 'light') {
    settings.update((s) => (s.theme = mode));
  }

  /** Flip between dark and light (leaving "follow system"). */
  toggle() {
    this.set(this.resolved === 'dark' ? 'light' : 'dark');
  }
}

export const theme = new ThemeState();
