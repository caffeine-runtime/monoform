// In-webview self tests, run when HIA_TEST is set (see scripts/selftest.sh
// and docs/TESTING.md). Each scenario lives in its own file and chunk.
import { api } from '../core/backend';
import { settings } from '../core/settings.svelte';
import { log } from './harness';

const scenarios: Record<string, () => Promise<{ default: (arg: string) => Promise<void> }>> = {
  'm0-setup': () => import('./m0').then((m) => ({ default: m.setup })),
  'm0-restore': () => import('./m0').then((m) => ({ default: m.restore })),
};

export function registerScenario(name: string, load: () => Promise<{ default: (arg: string) => Promise<void> }>) {
  scenarios[name] = load;
}

export async function runSelfTest(name: string) {
  const info = await api.Boot();
  const arg = info.testArg ?? '';
  const load = scenarios[name];
  if (!load) {
    log(`FAIL unknown scenario ${name}`);
    await api.Quit(2);
    return;
  }
  try {
    const t0 = performance.now();
    await (await load()).default(arg);
    log(`PASS ${name} (${Math.round(performance.now() - t0)} ms)`);
    await settings.flush();
    await api.Quit(0);
  } catch (e) {
    log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    await settings.flush();
    await api.Quit(1);
  }
}
