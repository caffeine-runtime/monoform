// M59: the command palette opened with a long list (twenty recent files)
// keeps its search box whole — the list scrolls, the box doesn't shrink —
// and the start page offers opening and creating files, without a row of
// tool buttons (tools are in the ☰ menu and Ctrl+K). A long path in a
// settings tile wraps instead of running out of it, and in a short window
// every settings tile can be scrolled to (none spill off to the right).
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

  // Settings tiles: nothing runs out of them (a long path wraps).
  await workspace.openTool('settings');
  const cards = await waitFor(() => {
    const l = document.querySelectorAll<HTMLElement>('.tabview.active .tiles > .card');
    return l.length ? l : null;
  }, 'the settings tiles');
  const lbl = cards[0].querySelector<HTMLElement>('.row > .lbl')!;
  const was = lbl.textContent;
  lbl.textContent = `installed: C:\\Users\\Someone\\AppData\\Local\\Microsoft\\WindowsApps\\${'VeryLongFolderName'.repeat(6)}monoform.cmd`;
  await sleep(30);
  for (const c of cards) assert(c.scrollWidth <= c.clientWidth + 1, `a settings tile overflows (${c.querySelector('h3')?.textContent}: ${c.scrollWidth} > ${c.clientWidth})`);
  lbl.textContent = was;

  // In a short window every tile can still be scrolled to: the tiles grow
  // downwards (the page scrolls) instead of spilling into columns off the right.
  const wrap = cards[0].closest<HTMLElement>('.wrap')!;
  wrap.style.maxHeight = '360px';
  // WebView2 (Windows) lets the tiles shrink to the page's height; WebKit doesn't — allow it here too.
  const tilesEl = wrap.querySelector<HTMLElement>('.tiles')!;
  tilesEl.style.minHeight = '0';
  await sleep(50);
  try {
    const tiles = wrap.querySelector<HTMLElement>('.tiles')!.getBoundingClientRect();
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      assert(r.right <= tiles.right + 1 && r.left >= tiles.left - 1, `a settings tile is outside the page (${c.querySelector('h3')?.textContent}: ${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(tiles.left)}–${Math.round(tiles.right)})`);
    }
    assert(wrap.scrollHeight > wrap.clientHeight, 'the settings page scrolls');
    wrap.scrollTop = wrap.scrollHeight;
    await sleep(30);
    const last = Array.from(cards).reduce((a, c) => (c.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? c : a));
    const lb = last.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    assert(lb.bottom <= wb.bottom + 1 && lb.top >= wb.top - 1, `the last tile (${last.querySelector('h3')?.textContent}) can be scrolled into view`);
    log(`settings: ${cards.length} tiles reachable in a 360 px tall page`);
  } finally {
    wrap.style.maxHeight = '';
    tilesEl.style.minHeight = '';
    wrap.scrollTop = 0;
  }

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
