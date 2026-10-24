// Stages the image editor for README screenshots. Arg: "<fixtures dir>|layers|adjust|adjustlist|styles"
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import type { ImageEditor } from '../modules/image/editor';
import { sleep, waitFor } from './harness';

export default async function imgshot(arg: string) {
  const [dir, mode] = arg.split('|');
  const tab = (await workspace.openPath(join(dir, 'img', 'subject.png'))) as Tab;
  const ed: ImageEditor = await waitFor(() => (tab as unknown as { imageTest?: any }).imageTest?.editor(), 'editor');
  const h = (tab as unknown as { imageTest: any }).imageTest;
  ed.addLayer('Notes');
  ed.setOptions({ fontFamily: 'Source Serif 4 Variable', fontSize: 34, color: '#1a1a1a', shadow: false, bold: true });
  await ed.addText({ x: 120, y: 245 }, 'Red planet');
  ed.setOptions({ color: '#3e8ed0' });
  ed.addArrow(330, 60, 265, 110);
  ed.setActive(ed.state().layers[0].id);
  await h.wandAt(200, 150, 'replace');
  if (mode === 'adjust' || mode === 'adjustlist') {
    h.setPanel('adjust');
    const a = await waitFor(() => h.adjust(), 'adjust');
    a.test.set('temperature', 0.6);
    a.test.set('saturation', 0.4);
    if (mode === 'adjust') a.test.open('colour');
  } else h.setPanel('layers');
  if (mode === 'styles') {
    const notes = ed.state().layers[1].id;
    ed.setActive(notes);
    ed.setLayerStyle(notes, { shadow: { color: '#000000', opacity: 0.55, angle: 120, distance: 6, size: 8 }, stroke: { color: '#ffffff', opacity: 1, size: 3 } });
    await sleep(300);
    (document.querySelector('.tabview.active .layers .actions button[aria-pressed]') as HTMLButtonElement | null)?.click();
  }
  ed.setTool('wand');
  await sleep(6000);
}
