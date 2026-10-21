// M43 (real models, local only — like m6b it needs the downloads): with the
// subject and eraser packs installed (MF_CACHE pointing at a cache that has
// them), Select subject on the astronaut photo covers her (not the flag or
// the backdrop), and Remove object on a lasso around the model shuttle fills
// it with backdrop. Timings are logged; the result is written to
// <fx>/img/out/ai-removed.png for a look.
import { api } from '../core/backend';
import { join } from '../core/paths';
import { aiModels } from '../core/aimodels.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import * as selection from '../modules/image/selection';
import type { ImageEditor } from '../modules/image/editor';
import { assert, log, waitFor } from './harness';

interface Hooks {
  editor: () => ImageEditor | null;
  selectSubject: () => Promise<void>;
  removeObject: () => Promise<void>;
  writeImage: (p: string) => Promise<boolean>;
}
const hooks = (t: Tab) => (t as unknown as { imageTest: Hooks }).imageTest;

function mean(ed: ImageEditor, x: number, y: number, w: number, h: number): number[] {
  const d = ed.composite().getContext('2d')!.getImageData(x, y, w, h).data;
  const s = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 4; c++) s[c] += d[i + c];
  return s.map((v) => Math.round(v / (d.length / 4)));
}

export default async function m43real(dir: string) {
  assert((await aiModels.installed('subject')) && (await aiModels.installed('eraser')), 'both packs installed (see docs/TESTING.md)');
  const t = (await workspace.openPath(join(dir, 'people', 'astronaut.jpg')))!;
  const h = await waitFor(() => (hooks(t)?.editor() ? hooks(t) : null), 'image editor');
  const ed = h.editor()!;
  let t0 = performance.now();
  await h.selectSubject();
  log(`select subject (BiRefNet): ${Math.round(performance.now() - t0)} ms`);
  const sel = ed.selection!;
  const a = (x: number, y: number) => sel.mask.getContext('2d')!.getImageData(x, y, 1, 1).data[3];
  log(`subject bounds ${JSON.stringify(sel.bounds)}; face ${a(220, 140)}, suit ${a(150, 400)}, flag ${a(30, 60)}, backdrop ${a(470, 40)}`);
  assert(a(220, 140) > 200 && a(150, 400) > 200, 'her face and suit are selected');
  assert(a(30, 60) < 30 && a(470, 40) < 30, 'the flag and the backdrop are not');
  ed.deselect();

  // A lasso around the shuttle model, then Remove object.
  const pts = [395, 0, 445, 0, 470, 170, 470, 290, 360, 290, 350, 240, 380, 160];
  ed.setPixelSelection(selection.fromPath(selection.polygonPath(pts), selection.polygonBounds(pts, ed.width, ed.height), ed.width, ed.height));
  const before = mean(ed, 395, 60, 50, 150);
  t0 = performance.now();
  await h.removeObject();
  log(`remove object (Moebius): ${Math.round(performance.now() - t0)} ms`);
  const after = mean(ed, 395, 60, 50, 150);
  const backdrop = mean(ed, 300, 40, 40, 200);
  log(`shuttle area before ${before}, after ${after}, backdrop ${backdrop}`);
  const diff = [0, 1, 2].reduce((s, c) => s + Math.abs(after[c] - backdrop[c]), 0) / 3;
  assert(diff < 30, `the gap looks like the backdrop (off by ${Math.round(diff)})`);
  await api.CreateFolder(join(dir, 'img', 'out')).catch(() => {});
  await h.writeImage(join(dir, 'img', 'out', 'ai-removed.png'));
  await workspace.close(t, { force: true });
}
