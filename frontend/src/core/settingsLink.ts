// Open Settings at a section or row (e.g. an AI model's download from a
// greyed-out tool that needs it): scrolled into view and briefly highlighted.
import { workspace } from './tabs.svelte';

export async function openSettingsAt(selector: string): Promise<void> {
  workspace.openTool('settings');
  for (let i = 0; i < 60; i++) {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.offsetParent);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash-target');
      void el.offsetWidth; // restart the animation
      el.classList.add('flash-target');
      setTimeout(() => el.classList.remove('flash-target'), 2400);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
