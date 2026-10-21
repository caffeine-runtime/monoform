// M37: the first-run welcome — four steps (Next, →, ← and the dots), the
// last one picks a theme; "Get started" closes it and remembers that it was
// seen; Help › Welcome shows it again and Esc closes it. Keys pressed while it
// shows don't reach the app's shortcuts.
import { commands } from '../core/commands';
import { settings } from '../core/settings.svelte';
import { ui } from '../core/ui.svelte';
import { api } from '../core/backend';
import { assert, assertEq, sleep, waitFor } from './harness';

const card = () => document.querySelector<HTMLElement>('.firstrun');
const title = () => card()?.querySelector('h1')?.textContent ?? '';
const btn = (label: string) => [...card()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
function key(k: string) {
  card()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

export default async function m37() {
  assert(!card(), 'not shown during self-tests');
  ui.firstRun = true;
  await waitFor(() => card(), 'welcome shown');
  await waitFor(() => (title() === 'Open almost anything' ? true : null), 'first step');
  assertEq(card()!.querySelectorAll('.dot').length, 4, 'four steps');
  btn('Next')!.click();
  await waitFor(() => (title() === 'Edit it right here' ? true : null), 'second step');
  key('ArrowRight');
  await waitFor(() => (title() === 'Yours, and offline' ? true : null), '→ next step');
  key('ArrowLeft');
  await waitFor(() => (title() === 'Edit it right here' ? true : null), '← back');
  key('ArrowRight');
  key('ArrowRight');
  await waitFor(() => (title() === 'Make it yours' ? true : null), 'last step');
  // A key here must not reach the app's shortcuts (Mod+K would open the palette).
  card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  await sleep(50);
  assert(!ui.paletteOpen, 'shortcuts stay quiet behind the welcome');
  const dark = [...card()!.querySelectorAll<HTMLButtonElement>('.theme')].find((b) => b.textContent?.includes('Dark'))!;
  dark.click();
  await waitFor(() => (settings.value.theme === 'dark' && document.documentElement.dataset.theme === 'dark' ? true : null), 'dark theme picked');
  btn('Get started')!.click();
  await waitFor(() => (!card() ? true : null), 'closed');
  await waitFor(async () => ((await api.Boot()).settings.welcomeDone ? true : null), 'remembered as seen');
  // Again from the Help menu; Esc closes it.
  assert(commands.execute('help.welcome'), 'Help › Welcome');
  await waitFor(() => card(), 'shown again');
  key('Escape');
  await waitFor(() => (!card() ? true : null), 'Esc closes');
  settings.update((s) => (s.theme = 'system'));
}
