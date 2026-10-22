// M62: the image editor's effects. Each of the eighteen runs on the GPU (the
// shader compiles in the webview) and does what it says on a test picture
// (a grey ramp with a red, a green and a blue square): every one changes it,
// Threshold leaves only black and white, Black & white, Noir and Pencil
// sketch only greys, Invert turns black white, Posterize at most four levels
// per channel, Thermal is colourful where the picture was grey; half the
// strength lands between the picture and the full effect, and two effects
// combine (Invert then Black & white: grey). In the Adjust panel the effects
// are chips: one clicked previews and gets its own strength slider below all
// the chips, a second gets another, a slider changes its strength, and
// clicking a chip again turns it off (and its slider goes).
import { join } from '../core/paths';
import { workspace } from '../core/tabs.svelte';
import { Adjuster, EFFECTS, NEUTRAL } from '../modules/image/adjust';
import { assert, assertEq, log, sleep, waitFor } from './harness';

function testPicture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 96; x++) {
    const v = Math.round((x / 95) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 64);
  }
  [['#e03131', 8], ['#2f9e44', 40], ['#1971c2', 72]].forEach(([col, x]) => {
    g.fillStyle = col as string;
    g.fillRect(x as number, 20, 16, 16);
  });
  return c;
}

const px = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
const meanDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (a.length / 4) / 3;
};

export default async function m62(dir: string) {
  const src = testPicture();
  const orig = px(src);
  const adj = new Adjuster(src);
  const results: string[] = [];
  try {
    for (const l of EFFECTS) {
      adj.render({ ...NEUTRAL, effects: { [l.id]: 1 } });
      const out = px(adj.snapshot());
      const d = meanDiff(orig, out);
      assert(d > 3, `${l.id} changes the picture (mean difference ${d.toFixed(1)})`);
      const greys = () => {
        for (let i = 0; i < out.length; i += 4) if (Math.abs(out[i] - out[i + 1]) > 3 || Math.abs(out[i + 1] - out[i + 2]) > 3) return false;
        return true;
      };
      if (l.id === 'threshold') {
        for (let i = 0; i < out.length; i += 4) assert(out[i] < 3 || out[i] > 252, 'threshold: only black and white');
      }
      if (l.id === 'noir' || l.id === 'sketch' || l.id === 'emboss' || l.id === 'bw') assert(greys(), `${l.id}: only greys`);
      if (l.id === 'invert') assert(out[0] > 250 && out[(96 - 1) * 4] < 5, 'invert: black turns white and white black');
      if (l.id === 'posterize') {
        const levels = new Set<number>();
        for (let i = 0; i < out.length; i += 4) levels.add(out[i]);
        assert(levels.size <= 5, `posterize: few levels (${levels.size})`);
      }
      if (l.id === 'thermal') {
        // The grey ramp's middle (x = 48, y = 5) comes out coloured.
        const i = (5 * 96 + 48) * 4;
        assert(Math.max(out[i], out[i + 1], out[i + 2]) - Math.min(out[i], out[i + 1], out[i + 2]) > 60, 'thermal: grey turns colourful');
      }
      results.push(`${l.id} ${d.toFixed(0)}`);
    }
    // Half the strength: in between.
    adj.render({ ...NEUTRAL, effects: { solarize: 1 } });
    const full = meanDiff(orig, px(adj.snapshot()));
    adj.render({ ...NEUTRAL, effects: { solarize: 0.5 } });
    const half = meanDiff(orig, px(adj.snapshot()));
    assert(half > full * 0.3 && half < full * 0.7, `half the strength is in between (${half.toFixed(1)} of ${full.toFixed(1)})`);
    // Two at once: inverted, then grey.
    adj.render({ ...NEUTRAL, effects: { invert: 1, bw: 1 } });
    const both = px(adj.snapshot());
    const red = (28 * 96 + 16) * 4;
    assert(Math.abs(both[red] - both[red + 1]) < 4 && Math.abs(both[red + 1] - both[red + 2]) < 4, 'two effects combine (grey)');
    assert(both[0] > 250, 'inverted first (black is white)');
  } finally {
    adj.destroy();
  }
  log(`effects on the GPU: ${results.join(', ')}`);

  // ---- the panel ----
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(() => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null), 'the image editor', 10000);
  h.setPanel('adjust');
  const chips = await waitFor(() => {
    const l = document.querySelectorAll<HTMLButtonElement>('.tabview.active .adjust .looks .chip');
    return l.length ? l : null;
  }, 'the effects in the Adjust panel');
  assertEq(chips.length, EFFECTS.length, 'every effect is offered');
  const chip = (name: string) => Array.from(chips).find((b) => b.textContent === name)!;
  const sliders = () => Array.from(document.querySelectorAll<HTMLElement>('.tabview.active .adjust .row.effect'));
  chip('Vintage').click();
  await waitFor(() => (h.editor().state().adjusting ? true : null), 'an effect previews');
  assert(chip('Vintage').classList.contains('on'), 'shown as chosen');
  await sleep(30);
  assertEq(sliders().map((r) => r.querySelector('.lbl')!.textContent).join(','), 'Vintage', 'with its own strength slider');
  const last = chips[chips.length - 1];
  assert(!!(last.compareDocumentPosition(sliders()[0]) & Node.DOCUMENT_POSITION_FOLLOWING), 'below all the chips');
  chip('Sepia').click();
  await sleep(30);
  assertEq(sliders().map((r) => r.querySelector('.lbl')!.textContent).join(','), 'Sepia,Vintage', 'a second effect gets its own slider');
  const range = sliders()[1].querySelector<HTMLInputElement>('input[type=range]')!;
  range.value = '0.4';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(30);
  assertEq(sliders()[1].querySelector('.num')!.textContent, '40%', 'its slider sets its strength');
  chip('Vintage').click();
  await sleep(30);
  assert(!chip('Vintage').classList.contains('on'), 'clicking it again turns it off');
  assertEq(sliders().map((r) => r.querySelector('.lbl')!.textContent).join(','), 'Sepia', 'and its slider goes');
  log('Adjust panel: effects as chips, a strength slider each below them');
  await workspace.close(tab, { force: true });
}
