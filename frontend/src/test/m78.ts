// M78: interface motion. With three files open, each popup enters with its
// animation (palette drops in, a menu unfolds, a dialog rises, a toast slides
// in), a shown tab fades in, a new tab grows into the strip and closing one
// slides its neighbours along (FLIP) — each with the longest UI frame logged.
// Settings › Appearance › Animations: Off turns it off (data-motion="reduce", CSS
// animations down to 1 ms and script-driven ones to 0); On keeps it on when the
// system asks for less motion (data-motion="full"); System is the default.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { ms } from '../core/motion';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { menu, ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const anim = (sel: string) => {
  const el = document.querySelector(sel);
  return el ? getComputedStyle(el).animationName : '(none)';
};

export default async function m78(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  // Settings › Appearance › Animations: System by default (as the system
  // asks), Off, and On whatever the system asks (data-motion="full"). The rest
  // runs with On, so it holds where the system asks for less motion too.
  commands.execute('app.settings');
  const group = await waitFor(() => document.querySelector<HTMLElement>('[role=radiogroup][aria-label="Animations"]'), 'the Animations choice');
  const choice = (label: string) => [...group.querySelectorAll<HTMLButtonElement>('[role=radio]')].find((b) => b.textContent === label)!;
  assertEq(group.querySelector('[aria-checked=true]')?.textContent, 'System', 'as the system asks by default');
  assertEq(document.documentElement.dataset.motion, 'auto', 'System: data-motion="auto"');
  choice('Off').click();
  await waitFor(() => (document.documentElement.dataset.motion === 'reduce' ? true : null), 'Off: data-motion="reduce"');
  assert(settings.value.reduceMotion && !settings.value.forceMotion, 'Off');
  choice('On').click();
  await waitFor(() => (document.documentElement.dataset.motion === 'full' ? true : null), 'On: data-motion="full"');
  assert(settings.value.forceMotion && !settings.value.reduceMotion && ms(170) === 170, 'animations on whatever the system asks');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  for (const f of ['code/sample.ts', 'data/grid.csv', 'img/photo.png']) await workspace.openPath(join(dir, f));
  await sleep(600);
  const frames: string[] = [];
  const measure = async (what: string, fn: () => Promise<void>) => {
    const j = await measureJank(fn);
    frames.push(`${what} ${Math.round(j.maxGap)} ms`);
    assert(j.maxGap < 250, `${what}: longest frame ${Math.round(j.maxGap)} ms`);
  };

  // Popups (the palette opened once first: its code loads on first use).
  ui.openPalette('');
  await waitFor(() => document.querySelector('.palette'), 'palette (warm-up)');
  await sleep(200);
  ui.paletteOpen = false;
  await sleep(100);
  await measure('palette', async () => {
    ui.openPalette('');
    await waitFor(() => document.querySelector('.palette'), 'palette');
    await sleep(250);
  });
  assertEq(anim('.palette'), 'mf-pop', 'the palette drops in');
  ui.paletteOpen = false;
  await sleep(50);

  await measure('menu', async () => {
    menu.show({ clientX: 300, clientY: 200 }, [{ label: 'One', run: () => {} }, { label: 'Two', run: () => {} }]);
    await waitFor(() => document.querySelector('.menu'), 'menu');
    await sleep(200);
  });
  assertEq(anim('.menu'), 'mf-menu', 'a menu unfolds');
  menu.close();
  await sleep(50);

  let asked: Promise<unknown> = Promise.resolve();
  await measure('dialog', async () => {
    asked = ui.ask({ title: 'Motion', message: 'A dialog', buttons: [{ id: 'ok', label: 'OK', primary: true }] });
    await waitFor(() => document.querySelector('.dialog'), 'dialog');
    await sleep(250);
  });
  assertEq(anim('.dialog'), 'mf-rise', 'a dialog rises');
  ui.dialog!.resolve({ button: 'ok' });
  await asked;

  ui.toast('Motion', 'info');
  await waitFor(() => document.querySelector('.toast'), 'toast');
  assertEq(anim('.toast'), 'mf-toast', 'a toast slides in');

  // Tabs: a shown tab fades in, a new tab grows in, closing one slides the rest.
  const [code, csv] = workspace.tabs;
  await measure('tab switch', async () => {
    workspace.activate(code);
    await sleep(250);
  });
  assertEq(anim(`.tabview[data-tab-id="${code.id}"]`), 'mf-fade', 'the shown tab fades in');

  let grew = false;
  await measure('new tab', async () => {
    workspace.openTool('start');
    await sleep(16);
    const el = document.querySelector<HTMLElement>(`.tab[data-tab="${workspace.activeId}"]`);
    grew = !!el && el.getAnimations().length > 0;
    await sleep(300);
  });
  assert(grew, 'a new tab grows into the strip');

  const next = workspace.tabs[workspace.tabs.indexOf(csv) + 1];
  assert(next, `a tab after the one to close (${workspace.tabs.map((t) => t.title)})`);
  const after = document.querySelector<HTMLElement>(`.tab[data-tab="${next.id}"]`)!;
  let slid = false;
  await measure('close tab', async () => {
    void workspace.close(csv, { force: true });
    await sleep(30);
    slid = after.getAnimations().length > 0;
    await sleep(300);
  });
  assert(slid, 'the tabs after a closed one slide along');

  // Reduce motion.
  settings.update((s) => (s.reduceMotion = true));
  await waitFor(() => (document.documentElement.dataset.motion === 'reduce' ? true : null), 'data-motion="reduce"');
  ui.openPalette('');
  const p = await waitFor(() => document.querySelector('.palette'), 'palette (reduced)');
  assertEq(getComputedStyle(p).animationDuration, '0.001s', 'CSS animations down to 1 ms');
  assertEq(ms(170), 0, 'script-driven animations take no time');
  ui.paletteOpen = false;
  settings.update((s) => ((s.reduceMotion = false), (s.forceMotion = false)));
  await waitFor(() => (document.documentElement.dataset.motion === 'auto' ? true : null), 'back to System');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  log(`motion: ${frames.join(', ')}`);
}
