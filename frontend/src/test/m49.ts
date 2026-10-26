// M49: updates (run with MF_UPDATE_FAKE=1: Go offers a made-up 99.0.0 and
// "installs" by logging — the real download, checksum and replacement are
// covered by Go tests in internal/update). Help › Check for updates finds it
// and shows the popup with the release notes; Skip this version keeps the
// startup check quiet about it; Download and install shows progress, asks to
// save unsaved work first, then installs; Settings › About has the switch.
import { api } from '../core/backend';
import { workspace } from '../core/tabs.svelte';
import { settings } from '../core/settings.svelte';
import { ui } from '../core/ui.svelte';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { assert, assertEq, log, sleep, waitFor } from './harness';

async function dialog(what: string) {
  return waitFor(() => ui.dialog, what);
}

export default async function m49(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  settings.update((s) => (s.updateSkip = ''));
  const { updates } = await import('../core/updates.svelte');

  // Help › Check for updates: the popup with what's new.
  commands.execute('help.updates');
  let d = await dialog('the update popup');
  assertEq(d.title, 'Monoform 99.0.0 is available', 'names the version');
  assert(d.message!.includes('You have') && d.message!.includes('restarts Monoform'), d.message!);
  assert(d.details?.some((l) => l.includes('Something new')), `release notes shown (${d.details})`);
  assertEq(d.buttons.map((b) => b.id).join(','), 'skip,later,go', 'Skip, Later, Download and install');
  assertEq(d.buttons.find((b) => b.primary)?.label, 'Download and install', 'install is the main button');

  // Skip this version: the startup check says nothing about it again.
  d.resolve({ button: 'skip' });
  await sleep(50);
  assertEq(settings.value.updateSkip, '99.0.0', 'skipped version remembered');
  await updates.check(true);
  await sleep(100);
  assert(!ui.dialog, 'a skipped version stays quiet at startup');
  // Asking by hand still offers it.
  void updates.check(false);
  d = await dialog('offered again when asked');

  // Download and install: with unsaved work it asks to save first.
  const tab = (await workspace.openPath(join(dir, 'notes', 'index.md')))!;
  await sleep(300);
  tab.dirty = true;
  d.resolve({ button: 'go' });
  await waitFor(() => (updates.downloaded ? true : null), 'downloaded', 10000);
  const save = await dialog('asked to save before restarting');
  assertEq(save.title, 'Save your changes before restarting?', save.title);
  assert(save.details?.includes('index.md'), `lists the unsaved tab (${save.details})`);
  save.resolve({ button: 'cancel' });
  await sleep(50);
  assert(tab.dirty, 'cancel: nothing saved, nothing installed');
  tab.dirty = false;
  // Again, without unsaved work: installs (the fake logs it) without questions.
  assert(await updates.install(updates.info!), 'installed');
  assert(!ui.dialog, 'no questions without unsaved work');
  log('update offered, skipped, downloaded and installed (fake)');

  // Settings › About: the switch and Check now.
  commands.execute('app.settings');
  const box = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('label.row.check')].find((l) => l.textContent?.includes('Look for a new version')) ?? null, 'the switch in Settings');
  const input = box.querySelector('input')!;
  assert(input.checked, 'on by default');
  input.click();
  await sleep(50);
  assert(settings.value.updateCheckOff, 'turns the startup check off');
  input.click();
  await sleep(50);
  assert(!settings.value.updateCheckOff, 'and on again');
  assert([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Update…')), 'Settings offers the found version');
  // Nightly builds: off unless chosen, and the choice reaches the settings file the check reads.
  const nightly = [...document.querySelectorAll<HTMLLabelElement>('label.row.check')].find((l) => l.textContent?.includes('Also offer nightly builds'))!.querySelector('input')!;
  assert(!nightly.checked && !settings.value.nightlyUpdates, 'nightly builds off by default');
  nightly.click();
  await waitFor(async () => ((await api.Boot()).settings.nightlyUpdates ? true : null), 'nightly builds chosen, saved at once');
  nightly.click();
  await waitFor(async () => (!(await api.Boot()).settings.nightlyUpdates ? true : null), 'and off again');
  log('Settings: the startup check and nightly builds switch');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  settings.update((s) => (s.updateSkip = ''));
}

/**
 * m49real: a real update end to end against a local stand-in for GitHub
 * (MF_UPDATE_API): the running copy downloads the newer package, replaces
 * itself and restarts as the new version (which logs and quits).
 */
export async function m49real() {
  const { boot } = await import('../core/boot');
  if (boot.version !== '1.0.0') {
    log(`running as ${boot.version} after the update`);
    const { api } = await import('../core/backend');
    void api.Quit(0);
    return;
  }
  const { updates } = await import('../core/updates.svelte');
  void updates.check(false);
  const d = await dialog('the update popup');
  log(`offered: ${d.title}`);
  d.resolve({ button: 'go' });
  await waitFor(() => (updates.downloaded ? true : null), 'downloaded', 20000);
  log(`downloaded ${updates.downloaded}; installing and restarting`);
  await new Promise(() => {}); // the app closes and restarts as the new version
}
