// M31: screenshots and colours — a whole-screen screenshot (Xvfb) saved to
// the screenshots folder and opened for annotating; "pick a colour from the
// screen" opens a shot with the colour picker; the picker on a three-colour
// image (HEX shown, palette of its colours); recognised text pixelated with
// "Hide text" so it can no longer be read.
import { api, saveFile } from '../core/backend';
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';
import { LINES, textImage } from './m30';

const ih = (t: Tab) => (t as any).imageTest;
type Panel = { text: () => string; busy: () => boolean; error: () => string; rerun: () => Promise<void> };
const ocr = () => (globalThis as unknown as { __ocrPanel?: Panel }).__ocrPanel;
const colours = () => (globalThis as unknown as { __colours?: { palette: () => { rgb: number[]; share: number }[]; setCount: (n: number) => void } }).__colours;

async function closeAll() {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}

export default async function m31(dir: string) {
  await closeAll();
  // ---- a whole-screen screenshot ----
  const before = performance.now();
  assert(commands.execute('screenshot.screen'), 'screenshot command');
  const shot = await waitFor(() => workspace.tabs.find((t) => /Screenshot \d{4}-\d\d-\d\d at/.test(t.title)), 'screenshot opened', 20000);
  log(`screenshot: ${Math.round(performance.now() - before)} ms to an open tab (${shot.filePath})`);
  assertEq(shot.moduleId, 'image', 'opened in the image editor');
  const ed = await waitFor(() => (ih(shot)?.editor()?.width > 0 ? ih(shot).editor() : null), 'screenshot decoded');
  assert(ed.width >= 640 && ed.height >= 400, `screen-sized: ${ed.width}×${ed.height}`);
  assert(shot.filePath?.includes('hia-screenshots'), 'saved in the screenshots folder');
  assert(document.querySelector('.tabview.active button[aria-label="Arrow"]') && document.querySelector('.tabview.active button[aria-label="Blur region"]'), 'annotation tools at hand');
  await closeAll();

  // ---- pick a colour from the screen ----
  assert(commands.execute('tools.pickColour'), 'pick colour command');
  const pick = await waitFor(() => workspace.tabs.find((t) => /Screenshot/.test(t.title)), 'colour shot opened', 20000);
  await waitFor(() => (ih(pick)?.tool() === 'picker' && ih(pick)?.panel() === 'colours' ? true : null), 'picker and Colours ready');
  assert(!pick.filePath?.includes('hia-screenshots'), 'kept out of the screenshots folder');
  await closeAll();

  // ---- picker and palette on a known image ----
  const bands = document.createElement('canvas');
  bands.width = 300;
  bands.height = 100;
  const g = bands.getContext('2d')!;
  [['#e03131', 0, 150], ['#1971c2', 150, 90], ['#2f9e44', 240, 60]].forEach(([c, x, w]) => {
    g.fillStyle = c as string;
    g.fillRect(x as number, 0, w as number, 100);
  });
  const bandsPath = join(dir, 'colours.png');
  await saveFile(bandsPath, await new Promise<Blob>((r) => bands.toBlob((b) => r(b!), 'image/png')));
  const ct = (await workspace.openPath(bandsPath))!;
  await waitFor(() => (ih(ct)?.editor()?.width === 300 ? true : null), 'bands loaded');
  ih(ct).pickAt(200, 50);
  assertEq(ih(ct).picked()?.join(), '25,113,194', 'picked the blue band');
  await waitFor(() => (ih(ct).panel() === 'colours' ? true : null), 'Colours panel shown');
  await waitFor(() => [...document.querySelectorAll('.tabview.active .colours .fmt')].some((b) => b.textContent?.includes('#1971c2')), 'HEX shown');
  colours()!.setCount(5);
  const pal = await waitFor(() => (colours()!.palette().length === 3 ? colours()!.palette() : null), 'three palette colours');
  assertEq(pal.map((c) => c.rgb.join()).join(' '), '224,49,49 25,113,194 47,158,68', 'palette by share');
  await closeAll();

  // ---- hide recognised text ----
  const txt = join(dir, 'secret.png');
  await saveFile(txt, await textImage(LINES));
  const tt = (await workspace.openPath(txt))!;
  await waitFor(() => (ih(tt)?.editor()?.width === 1400 ? true : null), 'text image loaded');
  document.querySelector<HTMLButtonElement>('.tabview.active button[aria-label="Recognise text"]')!.click();
  await waitFor(() => (ocr() && !ocr()!.busy() && ocr()!.text() ? true : null), 'recognised', 60000);
  const hide = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.tabview.active .ocr button')].find((b) => b.textContent?.includes('Hide text')), 'Hide text button');
  hide.click();
  await waitFor(() => tt.dirty, 'image changed');
  await ocr()!.rerun();
  await waitFor(() => (!ocr()!.busy() ? true : null), 'read again', 60000);
  await sleep(20);
  const after = ocr()!.text().replace(/\s+/g, ' ');
  assert(!LINES.some((l) => after.includes(l.split(' ')[0] + ' ' + l.split(' ')[1])), `text no longer readable: “${after}”`);
  await closeAll();
}
