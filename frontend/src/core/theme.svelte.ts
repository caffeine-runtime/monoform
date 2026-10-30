// Theme: follows the OS by default; the user can force dark or light.
import { settings } from './settings.svelte';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

class ThemeState {
  systemLight = $state(media?.matches ?? false);
  resolved = $derived<'dark' | 'light'>(
    settings.value.theme === 'system' ? (this.systemLight ? 'light' : 'dark') : (settings.value.theme as 'dark' | 'light'),
  );

  /** Drawings and diagrams are darkened in the dark theme unless the user keeps them light. */
  darkCanvas = $derived(this.resolved === 'dark' && !settings.value.lightCanvases);

  constructor() {
    media?.addEventListener('change', (e) => (this.systemLight = e.matches));
  }

  apply() {
    document.documentElement.dataset.theme = this.resolved;
    document.documentElement.dataset.canvas = this.darkCanvas ? 'dark' : 'light';
    // Animations off (base.css): asked for here, or by the system
    // (prefers-reduced-motion) unless they're asked to stay on here.
    document.documentElement.dataset.motion = settings.value.reduceMotion ? 'reduce' : settings.value.forceMotion ? 'full' : 'auto';
  }

  set(mode: 'system' | 'dark' | 'light') {
    settings.update((s) => (s.theme = mode));
  }

  /** Darken drawings and diagrams in the dark theme, or keep them light. */
  setDarkCanvas(on: boolean) {
    settings.update((s) => (s.lightCanvases = !on));
  }

  /** Flip between dark and light (leaving "follow system"). */
  toggle() {
    this.set(this.resolved === 'dark' ? 'light' : 'dark');
  }
}

export const theme = new ThemeState();
