// In-webview self tests, run when MF_TEST is set (see scripts/selftest.sh
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
  m11: () => import('./m11'),
  m12: () => import('./m12'),
  m13: () => import('./m13'),
  m14: () => import('./m14'),
  m15: () => import('./m15'),
  m16: () => import('./m16'),
  m18: () => import('./m18'),
  m19: () => import('./m19'),
  m20: () => import('./m20'),
  m21: () => import('./m21'),
  m22: () => import('./m22'),
  m23: () => import('./m23'),
  m24: () => import('./m24'),
  m25: () => import('./m25'),
  m26: () => import('./m26'),
  m27: () => import('./m27'),
  m28: () => import('./m28'),
  m29: () => import('./m29'),
  m30: () => import('./m30'),
  m31: () => import('./m31'),
  m32: () => import('./m32'),
  m32peek: () => import('./m32peek'),
  m33: () => import('./m33'),
  m34: () => import('./m34'),
  m35: () => import('./m35'),
  m36: () => import('./m36'),
  m37: () => import('./m37'),
  m38: () => import('./m38'),
  m39: () => import('./m39'),
  m40: () => import('./m40'),
  m42: () => import('./m42'),
  m44: () => import('./m44'),
  m45: () => import('./m45'),
  m46: () => import('./m46'),
  m47: () => import('./m47'),
  m48: () => import('./m48'),
  m49: () => import('./m49'),
  m50: () => import('./m50'),
  m51: () => import('./m51'),
  m52: () => import('./m52'),
  m53: () => import('./m53'),
  m54: () => import('./m54'),
  m55: () => import('./m55'),
  m56: () => import('./m56'),
  m57: () => import('./m57'),
  m58: () => import('./m58'),
  m59: () => import('./m59'),
  m60: () => import('./m60'),
  m61: () => import('./m61'),
  m62: () => import('./m62'),
  m63: () => import('./m63'),
  m64: () => import('./m64'),
  m65: () => import('./m65'),
  m66: () => import('./m66'),
  m67: () => import('./m67'),
  m68: () => import('./m68'),
  m69: () => import('./m69'),
  m70: () => import('./m70'),
  m71: () => import('./m71'),
  m49real: () => import('./m49').then((m) => ({ default: m.m49real })),
  m43: () => import('./m43'),
  m43real: () => import('./m43real'),
  windowchild: () => import('./m39').then((m) => ({ default: m.windowChild })),
  uiaudit: () => import('./uiaudit'),
  menushot: () => import('./menushot'),
  welcomeshot: () => import('./welcomeshot'),
  imgshot: () => import('./imgshot'),
  bakeenv: () => import('./bakeenv'),
  probe: () => import('./probe'),
  coi: () => import('./coi'),
  caps: () => import('./caps'),
  show: () => import('./show'),
  demo: () => import('./demo'),
  prof: () => import('./prof'),
  'm1-roundtrip': () => import('./m1').then((m) => ({ default: m.roundtrip })),
  'm1-baseline': () => import('./m1').then((m) => ({ default: m.baseline })),
  // "seq" runs several m1 steps: MF_TEST_ARG="<dir>|step1,step2"
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
