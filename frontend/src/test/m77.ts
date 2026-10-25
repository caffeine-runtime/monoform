// M77: the Microsoft Store build (run with MF_STORE_FAKE=1, as if packaged):
// the Store updates it, so Go reports install "store" without asking GitHub,
// Help › Check for updates isn't offered (the command doesn't run), and
// Settings › About says the Store keeps it up to date instead of showing the
// startup-check switch and Check now.
import { api } from '../core/backend';
import { boot } from '../core/boot';
import { commands } from '../core/commands';
import { ui } from '../core/ui.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

export default async function m77() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  assert(boot.store, 'boot says this is the Store build');

  const info = await api.UpdateCheck();
  assertEq(info.install, 'store', 'Go: the Store updates this copy');
  assert(!info.available, 'and offers nothing');

  assert(!commands.available().some((c) => c.id === 'help.updates'), 'no Check for updates in the palette');
  assert(!commands.execute('help.updates'), 'the command does not run');
  await sleep(100);
  assert(!ui.dialog, 'no update popup');

  commands.execute('app.settings');
  await waitFor(() => [...document.querySelectorAll('.row .lbl')].find((e) => e.textContent?.includes('The Microsoft Store keeps Monoform up to date.')) ?? null, 'the Store line in Settings › About');
  assert(![...document.querySelectorAll('label.row.check')].some((l) => l.textContent?.includes('Look for a new version')), 'no startup-check switch');
  assert(![...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Check now'), 'no Check now');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  log('Store build: no update check, Settings says the Store updates it');
}
