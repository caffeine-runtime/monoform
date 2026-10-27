// M87: the sidebar header keeps the name. At any width and interface size the
// name is never cut off: Open folder, then Find in folder move into the menu
// first (listed at its top), and only a sidebar near its narrowest shows just
// the logo mark.
import { settings } from '../core/settings.svelte';
import { menu } from '../core/ui.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

type Head = { word: boolean; find: boolean; open: boolean };

async function header(width: number, scale: number): Promise<Head> {
  settings.value.sidebarWidth = width;
  settings.value.uiScale = scale;
  await sleep(80);
  const title = document.querySelector<HTMLElement>('.sidebar .head .title')!;
  assert(title.scrollWidth <= title.clientWidth, `${width} px at ${scale}×: the name isn't cut off (${title.scrollWidth} > ${title.clientWidth})`);
  const titles = [...document.querySelectorAll<HTMLElement>('.sidebar .head .actions button')].map((b) => b.title);
  return { word: !!title.querySelector('.word'), find: titles.some((x) => x.startsWith('Find in folder')), open: titles.some((x) => x.startsWith('Open folder')) };
}

export default async function m87() {
  await waitFor(() => document.querySelector('.sidebar .head .title'), 'sidebar');
  const before = { width: settings.value.sidebarWidth, scale: settings.value.uiScale };
  try {
    // The default width shows the name, at the normal and a larger size.
    for (const scale of [1, 1.25]) {
      const h = await header(260, scale);
      log(`260 px at ${scale}×: name ${h.word}, find ${h.find}, open folder ${h.open}`);
      assert(h.word, `the name at the default width (${scale}×)`);
    }
    // Every width: never cut off; buttons go before the name, Open folder first.
    for (const scale of [1, 1.25, 1.5]) {
      let sawFold = false;
      for (let w = 400; w >= 180; w -= 10) {
        const h = await header(w, scale);
        if (!h.word) assert(!h.find && !h.open, `${w} px at ${scale}×: buttons fold before the name`);
        if (!h.open) sawFold = true;
        if (h.open) assert(h.find, `${w} px at ${scale}×: Open folder goes before Find in folder`);
      }
      assert(sawFold, `${scale}×: narrow widths fold the buttons`);
    }
    assert((await header(400, 1)).open, 'a wide sidebar has every button');
    // Folded buttons lead the menu.
    const h = await header(200, 1);
    assert(!h.open, 'Open folder folded at 200 px');
    document.querySelector<HTMLButtonElement>('.sidebar .head .actions button[title="Menu"]')!.click();
    const items = await waitFor(() => menu.open?.items, 'menu');
    const lead = items.slice(0, h.find ? 1 : 2).map((i) => i.label).join(' | ');
    assertEq(lead, h.find ? 'Open folder…' : 'Find in folder… | Open folder…', 'the folded buttons first in the menu');
    menu.close();
  } finally {
    settings.value.sidebarWidth = before.width;
    settings.value.uiScale = before.scale;
  }
}
