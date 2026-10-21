// Stages the first-run welcome for screenshots. Arg: the step (0–3).
import { ui } from '../core/ui.svelte';
import { sleep } from './harness';

export default async function welcomeshot(arg: string) {
  ui.firstRun = true;
  await sleep(300);
  for (let i = 0; i < Number(arg || 0); i++) {
    document.querySelector('.firstrun')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(80);
  }
  await sleep(6000);
}
