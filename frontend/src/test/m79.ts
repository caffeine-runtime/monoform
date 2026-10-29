// M79: a narrow sidebar keeps to itself. At its narrowest (180 px) with a
// folder open, at 100 % and 200 % interface size, nothing in its header or
// folder row reaches past its right edge (they once spilled over the tab bar),
// and the header shows only the logo mark; wide again, the name is back. The
// header's Collapse sidebar button makes it the icon strip, Ctrl+B hides it
// and the tab bar's Show sidebar button brings it back; dragging its edge to
// the window's edge hides it too.
import { commands } from '../core/commands';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const side = () => document.querySelector<HTMLElement>('.sidebar');

function inside(scale: number) {
  const right = side()!.getBoundingClientRect().right;
  const parts = [...document.querySelectorAll<HTMLElement>('.sidebar .head .icon-btn, .sidebar .head .title, .sidebar .label-actions .icon-btn')];
  assert(parts.length >= 5, `header and folder row controls (${parts.length})`);
  for (const p of parts) {
    const r = p.getBoundingClientRect();
    assert(r.right <= right + 0.5, `${p.title || p.className} ends at ${Math.round(r.right)} past the sidebar's ${Math.round(right)} at ${scale * 100} %`);
  }
  const first = document.querySelector<HTMLElement>('.tabbar .tab')?.getBoundingClientRect();
  if (first) assert(first.left >= right - 0.5, `the first tab starts after the sidebar (${Math.round(first.left)} ≥ ${Math.round(right)})`);
}

export default async function m79(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  await workspace.openFolder(dir);
  await workspace.openPath(`${dir}/notes/index.md`);
  settings.update((s) => ((s.sidebarVisible = true), (s.uiScale = 1), (s.sidebarWidth = 180)));
  await sleep(200);
  for (const scale of [1, 2]) {
    settings.update((s) => (s.uiScale = scale));
    await sleep(450); // the width glides to the new scale
    inside(scale);
    assert(!document.querySelector('.sidebar .head .word'), `only the logo mark at 180 px, ${scale * 100} %`);
  }
  settings.update((s) => ((s.uiScale = 1), (s.sidebarWidth = 300)));
  await waitFor(() => document.querySelector('.sidebar .head .word'), 'the name back when wide');
  inside(1);

  // The header makes it the strip; Ctrl+B hides it, the tab bar shows it again (as it was).
  const collapse = [...document.querySelectorAll<HTMLButtonElement>('.sidebar .head .icon-btn')].find((b) => b.title.startsWith('Collapse sidebar'))!;
  assert(collapse, 'a Collapse sidebar button in the header');
  collapse.click();
  await waitFor(() => document.querySelector('.sidebar .rail'), 'the icon strip');
  commands.execute('view.toggleSidebar');
  await waitFor(() => (!side() ? true : null), 'sidebar hidden');
  const show = await waitFor(() => document.querySelector<HTMLButtonElement>('.tabbar .toggle'), 'Show sidebar in the tab bar');
  show.click();
  await waitFor(() => side()?.querySelector('.rail'), 'sidebar back as the strip');
  settings.update((s) => (s.sidebarCompact = false));
  await waitFor(() => side()?.querySelector('.head'), 'full again');

  // Dragging the edge to the window's edge hides it; the width it had stays for next time.
  const grip = side()!.querySelector<HTMLElement>('.resizer')!;
  const r = grip.getBoundingClientRect();
  const ev = (type: string, x: number) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: r.top + 40, pointerId: 7 }));
  ev('pointerdown', r.left + 3);
  ev('pointermove', 200);
  ev('pointermove', 60);
  ev('pointermove', 10);
  ev('pointerup', 10);
  await waitFor(() => (!settings.value.sidebarVisible ? true : null), 'dragged shut');
  assert(settings.value.sidebarWidth >= 180, `the width kept (${settings.value.sidebarWidth})`);
  commands.execute('view.toggleSidebar');
  await waitFor(() => side(), 'sidebar back');
  assertEq(settings.value.uiScale, 1, 'scale back to 100 %');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  log('narrow sidebar: inside its edge at 100 % and 200 %, compact header, hide and show, drag to hide');
}
