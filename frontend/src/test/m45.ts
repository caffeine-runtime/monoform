// M45: dark canvases. In the dark theme Excalidraw and draw.io drawings,
// Graphviz/Mermaid diagrams and Markdown diagram blocks are shown through
// Excalidraw's dark-mode filter: white paper turns near-black, the drawing
// stays editable (picking and handles work through the split overlay),
// photos are flipped back, a drawing already on a dark background is left
// alone, exports keep the file's colours, and the toolbar button / setting
// keeps them light. The light theme is untouched.
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { theme } from '../core/theme.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const bh = (t: Tab) => (t as unknown as { boardTest?: Record<string, any> }).boardTest;

function lum(css: string): number {
  const m = css.match(/[\d.]+/g)!.map(Number);
  return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
}

const filtered = (el: Element | null) => !!el && getComputedStyle(el).filter.includes('invert');

async function openBoard(dir: string, name: string) {
  const tab = (await workspace.openPath(join(dir, 'drawings', name)))!;
  const h = await waitFor(() => bh(tab), `${name} board`);
  await waitFor(() => (h.content()?.childElementCount ? true : null), `${name} drawn`);
  return { tab, h };
}

export default async function m45(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const was = settings.value.theme;
  const wasLight = settings.value.lightCanvases;
  try {
    theme.set('dark');
    theme.setDarkCanvas(true);
    await sleep(50);
    assertEq(document.documentElement.dataset.canvas, 'dark', 'dark theme: canvases are dark');

    // Excalidraw: dark paper, light ink, still editable.
    const { tab, h } = await openBoard(dir, 'sketch.excalidraw');
    assert(h.dark(), 'the drawing is darkened');
    const stage: HTMLElement = h.stage();
    const bg = getComputedStyle(stage).backgroundColor;
    assert(lum(bg) < 0.1, `paper is near-black (${bg})`);
    const canvas = h.content().ownerSVGElement as SVGSVGElement;
    assert(filtered(canvas), 'the drawing layer has the dark-mode filter');
    assert(!filtered(stage.querySelector('.overlay')), 'selection handles are not filtered');
    // Picking a shape goes through the overlay to the drawing.
    // Inside the box (an earlier test may have moved it), on its fill.
    const box = h.board().items().find((i: { id: string }) => i.id === 'box').box;
    const c = h.toScreen({ x: box.x + 30, y: box.y + 20 });
    const hit = document.elementFromPoint(c.x, c.y);
    assertEq(hit?.closest('[data-id]')?.getAttribute('data-id'), 'box', 'a click lands on the shape under the overlay');
    h.setSel(['box']);
    await sleep(50);
    const handle = stage.querySelector('.handle.se')!;
    const hr = handle.getBoundingClientRect();
    assert(document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2)?.classList.contains('handle'), 'resize handles are on top and take the pointer');
    // Exports keep the file's colours.
    const { svg } = await h.exportSvgText();
    assert(/fill="#ffffff"/i.test(svg), 'exported SVG keeps the white background');
    // The toolbar button keeps it light, everywhere.
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.toolbar .icon-btn')].find((b) => b.hasAttribute('aria-pressed'))!;
    assert(btn && btn.getAttribute('aria-pressed') === 'true', 'toolbar button shows the dark canvas is on');
    btn.click();
    await sleep(50);
    assert(!h.dark() && settings.value.lightCanvases, 'the button turns it off (and remembers)');
    assert(lum(getComputedStyle(stage).backgroundColor) > 0.9, 'paper is white again');
    assert(!filtered(canvas), 'no filter');
    btn.click();
    await sleep(50);
    assert(h.dark() && !settings.value.lightCanvases, 'and on again');
    await workspace.close(tab, { force: true });

    // Photos inside a drawing are flipped back.
    const p = await openBoard(dir, 'photo.excalidraw');
    const img = p.h.content().querySelector('image');
    assert(img && getComputedStyle(img).filter.includes('url('), 'the photo gets the un-flip filter');
    await workspace.close(p.tab, { force: true });

    // A draw.io file that is already dark is left alone.
    const n = await openBoard(dir, 'night.drawio');
    assert(!n.h.dark(), 'a dark drawing is not darkened again');
    assert(!filtered(n.h.content().ownerSVGElement), 'no filter on it');
    assert(!document.querySelector('.toolbar .icon-btn[aria-pressed]'), 'and no dark-canvas button for it');
    await workspace.close(n.tab, { force: true });

    // Graphviz diagram.
    const d = (await workspace.openPath(join(dir, 'diagrams', 'build.dot')))!;
    const paper = await waitFor(() => document.querySelector('.paper svg')?.parentElement ?? null, 'diagram drawn', 15000);
    assert(filtered(paper), 'the diagram paper is darkened');
    await workspace.close(d, { force: true });

    // Markdown diagram blocks.
    const m = (await workspace.openPath(join(dir, 'diagrams', 'notes.md')))!;
    const block = await waitFor(() => document.querySelector('.md .diagram svg')?.closest('.diagram') ?? null, 'markdown diagram drawn', 15000);
    assert(filtered(block), 'the Markdown diagram block is darkened');

    // The light theme draws them as they are.
    theme.set('light');
    await sleep(50);
    assertEq(document.documentElement.dataset.canvas, 'light', 'light theme: canvases are light');
    assert(!filtered(block), 'Markdown diagram on white');
    await workspace.close(m, { force: true });
    const l = await openBoard(dir, 'sketch.excalidraw');
    assert(!l.h.dark() && !filtered(l.h.content().ownerSVGElement), 'drawing as in the file');
    assert(!document.querySelector('.toolbar .icon-btn[aria-pressed]'), 'no dark-canvas button in the light theme');
    await workspace.close(l.tab, { force: true });
    log('dark canvases: Excalidraw, draw.io, Graphviz, Markdown diagrams; photos, dark files and exports kept');
  } finally {
    theme.set(was as 'system' | 'dark' | 'light');
    settings.update((s) => (s.lightCanvases = wasLight));
  }
}
