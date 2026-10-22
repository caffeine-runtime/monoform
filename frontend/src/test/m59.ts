// M59: the command palette opened with a long list (twenty recent files)
// keeps its search box whole — the list scrolls, the box doesn't shrink —
// and the start page offers opening and creating files, without a row of
// tool buttons (tools are in the ☰ menu and Ctrl+K).
import { settings } from '../core/settings.svelte';
import { ui } from '../core/ui.svelte';
import { workspace } from '../core/tabs.svelte';
import { join } from '../core/paths';
import { assert, log, sleep, waitFor } from './harness';

export default async function m59(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  await workspace.openTool('start');
  const start = await waitFor(() => document.querySelector('.tabview.active .welcome'), 'the start page');
  assert(start.querySelector('.kinds') && start.querySelector('.drop'), 'open and create are there');
  assert(!start.querySelector('.tools') && !Array.from(start.querySelectorAll('h3')).some((h) => h.textContent === 'Tools'), 'no tool buttons');

  const saved = settings.value.recents;
  settings.update((s) => (s.recents = Array.from({ length: 20 }, (_, i) => join(dir, 'notes', `recent-${i}.md`))));
  try {
    ui.openPalette();
    const q = await waitFor(() => document.querySelector<HTMLInputElement>('.palette .q'), 'the palette');
    await waitFor(() => (document.querySelectorAll('.palette .item').length >= 20 ? true : null), 'a long list');
    await sleep(50);
    const box = q.getBoundingClientRect();
    const pal = document.querySelector('.palette')!.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    assert(box.height >= 48 * scale - 1, `search box keeps its height (${box.height} px)`);
    assert(box.top >= pal.top - 0.5, 'and sits inside the palette');
    const list = document.querySelector<HTMLElement>('.palette .list')!;
    assert(list.scrollHeight > list.clientHeight, 'the list scrolls instead');
    log(`palette: box ${Math.round(box.height)} px with ${document.querySelectorAll('.palette .item').length} items`);
  } finally {
    ui.paletteOpen = false;
    settings.update((s) => (s.recents = saved));
  }
}
