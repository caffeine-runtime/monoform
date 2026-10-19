// In-webview self tests, run when HIA_TEST is set (see scripts/selftest.sh
// and docs/TESTING.md). Each scenario lives in its own file and chunk.
import { api } from '../core/backend';
import { settings } from '../core/settings.svelte';
import { log } from './harness';

const scenarios: Record<string, () => Promise<{ default: (arg: string) => Promise<void> }>> = {
  'm0-setup': () => import('./m0').then((m) => ({ default: m.setup })),
  'm0-restore': () => import('./m0').then((m) => ({ default: m.restore })),
  m1: () => import('./m1'),
  m2: () => import('./m2'),
  m3: () => import('./m3'),
  m4: () => import('./m4'),
  m4b: () => import('./m4b'),
  m5: () => import('./m5'),
  m6: () => import('./m6'),
  m6b: () => import('./m6b'),
  m8: () => import('./m8'),
  m9: () => import('./m9'),
  m10: () => import('./m10'),
  imgshot: () => import('./imgshot'),
  probe: () => import('./probe'),
  coi: () => import('./coi'),
  caps: () => import('./caps'),
  show: () => import('./show'),
  prof: () => import('./prof'),
  'm1-roundtrip': () => import('./m1').then((m) => ({ default: m.roundtrip })),
  'm1-baseline': () => import('./m1').then((m) => ({ default: m.baseline })),
  // "seq" runs several m1 steps: HIA_TEST_ARG="<dir>|step1,step2"
  seq: () =>
    import('./m1').then((m) => ({
      default: async (arg: string) => {
        const [dir, steps] = arg.split('|');
        for (const st of steps.split(',')) await (m as any)[st](dir);
      },
    })),
  'm1-large': () => import('./m1').then((m) => ({ default: m.large })),
  'm1-search': () => import('./m1').then((m) => ({ default: m.search })),
  'm1-markdown': () => import('./m1').then((m) => ({ default: m.markdown })),
  'm1-external': () => import('./m1').then((m) => ({ default: m.external })),
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
