// M84: quitting with unsaved work. Two edited files and a new document:
// closing the window asks once and names them (their folder; "Not saved yet"
// for the new one). Save all and quit is the main button and has the focus;
// Quit without saving sits apart on the left. Clicking a name goes to that
// tab without quitting; Esc doesn't quit either. Save all and quit saves the
// files, then asks where to put the new document: cancelling that keeps
// Monoform open on it. With one unsaved document the question names it and
// Save and quit puts it where chosen, then quits. Quit without saving quits
// with nothing written. (The native save dialog and ConfirmQuit, which closes
// the window for good, are stubbed.)
import { readFile, saveFile } from '../core/backend';
import { basename, join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { controllers } from '../modules/text/controllers';
import { EventsEmit } from '../wailsjs/runtime/runtime';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';

type Go = { SaveFileDialog: (title: string, def: string, filters: unknown) => Promise<string>; ConfirmQuit: () => Promise<void> };
const go = () => (window as unknown as { go: { app: { App: Go } } }).go.app.App;
const text = async (p: string) => new TextDecoder().decode(await readFile(p));
const dialogEl = () => document.querySelector<HTMLElement>('.overlay .dialog');

async function edited(tab: Tab, insert: string): Promise<Tab> {
  const ctl = await waitFor(() => {
    const c = controllers.get(tab.id);
    return c && !c.loading ? c : null;
  }, `editor for ${tab.title}`, 20000);
  ctl.view.dispatch({ changes: { from: 0, insert } });
  await waitFor(() => (tab.dirty ? true : null), `${tab.title} has changes`);
  return tab;
}

/** Close the window the way Go asks (app:confirm-quit) and wait for the question. */
async function closeWindow() {
  EventsEmit('app:confirm-quit', workspace.dirtyCount);
  return waitFor(() => (ui.dialog && dialogEl() ? ui.dialog : null), 'the question before quitting');
}

const button = (sel: string) => waitFor(() => dialogEl()?.querySelector<HTMLButtonElement>(sel) ?? null, sel);

export default async function m84(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const fa = join(dir, 'quit-a.txt');
  const fb = join(dir, 'quit-b.txt');
  const fnew = join(dir, 'quit-new.txt');
  await saveFile(fa, 'first file\n');
  await saveFile(fb, 'second file\n');
  const real = { save: go().SaveFileDialog, quit: go().ConfirmQuit };
  let quits = 0;
  let where = '';
  go().ConfirmQuit = async () => void quits++;
  go().SaveFileDialog = async () => where;
  try {
    const a = await edited((await workspace.openPath(fa))!, 'edited ');
    const b = await edited((await workspace.openPath(fb))!, 'edited ');
    const fresh = await edited(workspace.newUntitled(), 'a new document\n');

    // One question naming the three.
    let d = await closeWindow();
    assertEq(d.title, 'Save changes before quitting?', 'asks to save, not to lose');
    assertEq(d.message, '3 files have changes that aren’t saved:', d.message ?? '');
    assertEq(d.items?.map((i) => `${i.label} · ${i.detail}`).join(' | '), `quit-a.txt · ${basename(dir)} | quit-b.txt · ${basename(dir)} | ${fresh.title} · Not saved yet`, 'names each file and where it is');
    assertEq(d.buttons.map((x) => x.id).join(','), 'discard,cancel,save', 'buttons');
    const main = await button('.buttons .main button.primary');
    assertEq(main.textContent, 'Save all and quit', 'saving is the main button');
    await waitFor(() => (document.activeElement === main ? true : null), 'the main button focused (Enter saves)');
    assertEq((await button('.buttons .aside button')).textContent, 'Quit without saving', 'losing the changes is set apart');
    assertEq(dialogEl()!.querySelectorAll('.buttons .main button').length, 2, 'Cancel next to the main button');
    log('asks once, names the files, saving is the default');

    // A name goes to its tab and doesn't quit.
    dialogEl()!.querySelectorAll<HTMLButtonElement>('.items button')[1].click();
    await sleep(50);
    assert(!ui.dialog && quits === 0, 'not quitting');
    assertEq(workspace.active, b, 'went to the tab clicked');
    // Esc: nothing happens.
    await closeWindow();
    press('Escape');
    await sleep(50);
    assert(!ui.dialog && quits === 0 && a.dirty && b.dirty && fresh.dirty, 'Esc: nothing saved, not quitting');
    log('a name goes to its tab; Esc stays');

    // Save all and quit: the files are saved; the new document's place isn't chosen, so Monoform stays.
    d = await closeWindow();
    where = '';
    (await button('.buttons .main button.primary')).click();
    await waitFor(() => (ui.toasts.some((x) => x.message === `Monoform stays open: ${fresh.title} isn’t saved.`) ? true : null), 'told why it stays open');
    assert(!a.dirty && !b.dirty, 'the files are saved');
    assertEq(await text(fa), 'edited first file\n', 'first file written');
    assertEq(await text(fb), 'edited second file\n', 'second file written');
    assert(fresh.dirty && workspace.active === fresh, 'open on the document that isn’t saved');
    assertEq(quits, 0, 'not quitting');
    log('Save all and quit saves the files; a cancelled Save as keeps it open');

    // One left: named in the question; Save and quit puts it where chosen, then quits.
    d = await closeWindow();
    assertEq(d.title, 'Save changes before quitting?', d.title);
    assert(!d.items?.length, 'no list for one file');
    const card = await waitFor(() => document.querySelector('.dialog .file'), 'the file on a card');
    assertEq(card.querySelector('.fname')?.textContent, fresh.title, 'named on its card');
    assertEq(card.querySelector('.fwhere')?.textContent, 'Not saved yet', 'a new document says so');
    const one = await button('.buttons .main button.primary');
    assertEq(one.textContent, 'Save and quit', 'Save and quit');
    where = fnew;
    one.click();
    await waitFor(() => (quits === 1 ? true : null), 'quits once saved');
    assertEq(await text(fnew), 'a new document\n', 'the new document saved where chosen');
    log('one file: named, saved where chosen, quits');

    // Quit without saving: quits, writes nothing.
    await edited(a, 'more ');
    await closeWindow();
    (await button('.buttons .aside button')).click();
    await waitFor(() => (quits === 2 ? true : null), 'quits without saving');
    assertEq(await text(fa), 'edited first file\n', 'nothing written');
    log('Quit without saving quits and writes nothing');
  } finally {
    go().SaveFileDialog = real.save;
    go().ConfirmQuit = real.quit;
    if (ui.dialog) ui.dialog.resolve({ button: 'cancel' });
    for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  }
}
