// Stages the app menu with a submenu open, for screenshots. Arg: fixtures dir.
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { sleep } from './harness';

export default async function menushot(dir: string) {
  await workspace.openPath(join(dir, 'img', 'photo.png'));
  await sleep(1200);
  document.querySelector<HTMLButtonElement>('.sidebar button[title="Menu"]')!.click();
  await sleep(200);
  const root = document.querySelector('.menu')!;
  const img = [...root.querySelectorAll<HTMLButtonElement>('.mi')].find((b) => b.textContent?.startsWith('Image'))!;
  img.click();
  await sleep(200);
  const sub = document.querySelectorAll('.menu')[1];
  [...sub.querySelectorAll<HTMLButtonElement>('.mi')].find((b) => b.textContent?.startsWith('Tools'))!.click();
  await sleep(6000);
}
