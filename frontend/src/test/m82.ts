// M82: Convert with Monoform — the app started with --convert FILE… (a file
// manager's right-click menu). Only the format dialog fills the window, for
// photo.png and sales.csv: picture formats (not PNG: the only picture is
// one), sales.csv left out. A file from a later launch (the rest of the
// selection) joins: img/anim.gif adds PNG to the list. WebP converts both
// pictures next to their originals, each row ticked; the window stays open
// in a self-test (it closes itself otherwise).
import { api } from '../core/backend';
import { convertWindow } from '../core/convert.svelte';
import { assert, assertEq, log, press, sleep, waitFor } from './harness';

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Convert"]');
const formats = (d: HTMLElement) => [...d.querySelectorAll('.fmt .name')].map((e) => e.textContent?.trim());
const exists = async (p: string) => (await api.Exists([p]))[0];

export default async function m82(dir: string) {
  const c = `${dir}/convert`;
  assert(convertWindow.on, 'convert mode');
  assertEq(convertWindow.files.join('|'), `${c}/photo.png|${c}/sales.csv`, 'the files from the command line');
  assert(!document.querySelector('.sidebar') && !document.querySelector('.tabbar'), 'no sidebar or tab bar');
  const d = await waitFor(dialog, 'the format dialog');
  assert(d.closest('.standalone'), 'the dialog fills the window');
  assert(window.innerWidth <= 600, `a small window (${window.innerWidth})`);
  assert(d.querySelector('.src')!.textContent!.includes('2 files: photo.png, sales.csv'), 'names the files');
  assert(formats(d)[0] === 'JPEG' && !formats(d).includes('PNG'), `picture formats: ${formats(d)}`);
  assert(d.querySelector('.note')!.textContent!.includes('Left out: 1 file'), 'sales.csv is left out');
  assert(!d.querySelector('.always'), 'no "every time I save" for files that aren’t open');
  log('a small window with just the format dialog; the CSV is left out');

  // The rest of a selection arrives from another launch.
  convertWindow.add([`${dir}/img/anim.gif`]);
  await waitFor(() => (formats(d).includes('PNG') ? true : null), 'PNG offered for the GIF');
  assert(d.querySelector('.src')!.textContent!.includes('3 files'), 'three files now');
  log('a later launch adds its file');

  const webp = [...d.querySelectorAll<HTMLElement>('.fmt')].findIndex((e) => e.querySelector('.name')?.textContent === 'WebP');
  press(String(webp + 1), d);
  await sleep(50);
  assert(d.querySelector('.to')!.textContent!.includes('Saves 2 files, each next to its original'), 'two copies');
  d.querySelector<HTMLButtonElement>('button.primary')!.click();
  await waitFor(() => (document.querySelector('.win h2')?.textContent === 'Converted' ? true : null), 'converted', 30000);
  assertEq(document.querySelectorAll('.win li.done').length, 2, 'both rows ticked');
  assert((await exists(`${c}/photo.webp`)) && (await exists(`${dir}/img/anim.webp`)), 'each next to its original');
  assert(!(await exists(`${c}/sales.webp`)), 'nothing for the CSV');
  assert(document.querySelector('.win')!.textContent!.includes('Show in folder'), 'Show in folder');
  log('WebP for both pictures, next to each');
}
