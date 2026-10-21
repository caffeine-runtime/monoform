// M10/M10b: SVG editing with live preview and PNG export; HTML pages in a
// sandboxed preview with relative resources, scripts off by default and
// remote content blocked.
import { api, fileUrl } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { tick } from 'svelte';
import { commands } from '../core/commands';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const svgHooks = (t: Tab) => (t as unknown as { svgTest?: any }).svgTest;
const htmlHooks = (t: Tab) => (t as unknown as { htmlTest?: any }).htmlTest;

async function decode(p: string): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(await (await fetch(fileUrl(p))).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c;
}
const px = (c: HTMLCanvasElement, x: number, y: number) => [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];

export default async function m10(dir: string) {
  // ---- SVG ----
  const svg = (await workspace.openPath(join(dir, 'img', 'vector.svg')))!;
  assertEq(svg.moduleId, 'svg', 'SVG opens in the SVG module');
  const sh = await waitFor(() => (svgHooks(svg)?.src() ? svgHooks(svg) : null), 'svg preview');
  assertEq(`${sh.natural().w}x${sh.natural().h}`, '120x80', 'svg size');
  await waitFor(() => (document.querySelector('.tabview.active .design svg.art') ? true : null), 'opens in Design view');
  sh.setView('split');
  await tick();
  assert(document.querySelector('.preview img'), 'preview image shown');
  sh.setText('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#d97757"/><circle cx="60" cy="40" r="22" fill="#fff"/');
  await waitFor(() => (sh.error() ? true : null), 'xml error reported');
  log(`svg error: ${sh.error().slice(0, 80)}`);
  const before = sh.src();
  sh.setText('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 120 80"><rect width="120" height="80" fill="#d97757"/><circle cx="60" cy="40" r="22" fill="#fff"/></svg>');
  await waitFor(() => (!sh.error() && sh.src() !== before ? true : null), 'fixed and re-rendered');
  assertEq(`${sh.natural().w}x${sh.natural().h}`, '200x100', 'size follows the edit');
  const out = join(dir, 'img', 'out', 'vector@2x.png');
  await api.CreateFolder(join(dir, 'img', 'out')).catch(() => {});
  assert(await sh.exportTo(out, 400, 200), 'exported');
  const png = await decode(out);
  assertEq(`${png.width}x${png.height}`, '400x200', 'export size');
  const centre = px(png, 200, 100);
  // viewBox 120×80 in a 200×100 frame is letterboxed (preserveAspectRatio meet).
  const inside = px(png, 60, 10);
  const margin = px(png, 4, 4);
  assert(centre[0] > 240 && centre[1] > 240, `circle white (${centre})`);
  assert(inside[0] > 200 && inside[1] < 150, `background orange (${inside})`);
  assertEq(margin[3], 0, 'letterbox margin transparent');
  assert(svg.dirty, 'edits mark the tab dirty');

  // ---- Design: visual editing writes minimal source changes ----
  const SRC = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
  <!-- keep me -->
  <rect id="bg" width="120" height="80" fill="#d97757"/>
  <circle cx="60" cy="40" r="22" fill="#fff" onclick="alert(1)"/>
  <script>window.pwned = 1</script>
  <image href="https://example.com/x.png" width="10" height="10"/>
</svg>`;
  sh.setText(SRC);
  sh.setView('design');
  const art = await waitFor(() => document.querySelector<SVGSVGElement>('.tabview.active .design svg.art'), 'design canvas');
  await waitFor(() => (art.querySelector('[data-mf-i="2"]') ? true : null), 'inline copy');
  // Sanitized: no handlers, script emptied, no outside references.
  assert(!art.querySelector('[onclick]') && !art.querySelector('script')?.textContent && !art.querySelector('image')?.getAttribute('href'), 'inline copy is sanitized');
  assert(!(window as unknown as { pwned?: number }).pwned, 'no script ran');
  const host = document.querySelector<HTMLElement>('.tabview.active .design .canvas')!;
  const fire = (type: string, target: Element, x: number, y: number, extra: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, bubbles: true, ...extra }));
  // Click the circle and drag it 30 px right.
  const circle = art.querySelector('[data-mf-i="2"]')!;
  const cr = circle.getBoundingClientRect();
  const zoom = cr.width / 44;
  fire('pointerdown', circle, cr.left + cr.width / 2, cr.top + cr.height / 2);
  fire('pointermove', host, cr.left + cr.width / 2 + 30, cr.top + cr.height / 2);
  fire('pointerup', host, cr.left + cr.width / 2 + 30, cr.top + cr.height / 2);
  await tick();
  assertEq(sh.selected(), 2, 'circle selected');
  const moved = sh.text();
  const dx = Math.round((30 / zoom) * 1000) / 1000;
  assert(moved.includes(`<circle cx="60" cy="40" r="22" fill="#fff" onclick="alert(1)" transform="translate(${dx} 0)"/>`), `move written as a transform (${moved.split('\n')[3]})`);
  assert(moved.includes('<!-- keep me -->') && moved.includes('  <rect id="bg"'), 'formatting and comments kept');
  // Inspector: change the fill.
  const fill = document.querySelector<HTMLInputElement>('.tabview.active .inspector input[type=color]')!;
  fill.value = '#00ff00';
  fill.dispatchEvent(new Event('change', { bubbles: true }));
  assert(sh.text().includes('fill="#00ff00"'), 'fill changed from the inspector');
  // Draw an ellipse with the tool.
  sh.designOp('tool:ellipse');
  await tick();
  // Every edit rebuilds the inline copy: measure the current one.
  const ar = document.querySelector<SVGSVGElement>('.tabview.active .design svg.art')!.getBoundingClientRect();
  fire('pointerdown', host, ar.left + 5 * zoom, ar.top + 5 * zoom);
  fire('pointermove', host, ar.left + 25 * zoom, ar.top + 15 * zoom);
  fire('pointerup', host, ar.left + 25 * zoom, ar.top + 15 * zoom);
  await tick();
  const drawn = sh.text();
  assert(/<ellipse cx="15" cy="10" rx="10" ry="5" fill="#4a90d9"/.test(drawn), `ellipse drawn into the source (${drawn.split('\n').find((l: string) => l.includes('ellipse'))})`);
  const n = sh.els().length;
  assertEq(sh.selected(), n - 1, 'new shape selected');
  // Delete it with the keyboard command, then undo.
  commands.execute('svg.delete');
  await sleep(20);
  assertEq(sh.els().length, n - 1, 'deleted');
  commands.execute('svg.undo');
  await sleep(20);
  assertEq(sh.els().length, n, 'undo brings it back');
  // Nudge with arrows; duplicate keeps ids unique.
  sh.select(1);
  commands.execute('svg.nudge10.ArrowDown');
  await sleep(20);
  assert(sh.text().includes('<rect id="bg" width="120" height="80" fill="#d97757" transform="translate(0 10)"/>'), 'Shift+arrow nudges by 10');
  commands.execute('svg.duplicate');
  await sleep(20);
  assert(sh.text().includes('id="bg-2"'), 'duplicate gets a unique id');
  await workspace.close(svg, { force: true });

  // ---- HTML ----
  await api.TestServedPages();
  const page = (await workspace.openPath(join(dir, 'web', 'index.html')))!;
  assertEq(page.moduleId, 'html', 'HTML opens in the page module');
  const hh = await waitFor(() => (htmlHooks(page)?.srcdoc() ? htmlHooks(page) : null), 'page built');
  const doc: string = hh.srcdoc();
  assert(doc.includes('Content-Security-Policy') && doc.includes("script-src 'none'"), 'CSP injected, scripts off');
  assert(doc.includes(`<base href="${hh.base()}">`) && hh.base().includes('/__mf/page/'), 'base points at the folder route');
  const info = hh.info();
  assertEq(info.title, 'Fixture page', 'title');
  assertEq(info.remoteRefs, 1, 'one remote reference detected');
  assertEq(info.externalLinks, 1, 'one external link disabled');
  assert(!/\shref="https:\/\/example\.com\/"/.test(doc) && doc.includes('data-mf-href="https://example.com/"'), 'external link neutralised');
  assert(document.querySelector('.banner')?.textContent?.includes('internet'), 'remote-content banner');
  const iframe = await waitFor(() => document.querySelector<HTMLIFrameElement>('.page iframe'), 'iframe');
  assertEq(iframe.getAttribute('sandbox'), '', 'fully sandboxed');
  await sleep(1500);
  const served: string[] = await api.TestServedPages();
  log(`served with scripts off: ${served.join(', ')}`);
  assert(served.includes('style.css') && served.includes('img/pic.png'), 'relative stylesheet and image loaded');
  assert(!served.includes('script.js'), 'script not loaded while scripts are off');

  hh.toggle('scripts');
  await waitFor(() => (document.querySelector('.page iframe')?.getAttribute('sandbox') === 'allow-scripts' ? true : null), 'scripts allowed');
  assert(!hh.srcdoc().includes('allow-same-origin'), 'never same-origin');
  await sleep(1500);
  const served2: string[] = await api.TestServedPages();
  log(`served with scripts on: ${served2.join(', ')}`);
  assert(served2.includes('script.js'), 'script loaded when enabled');
  hh.toggle('scripts');
  await workspace.close(page, { force: true });
}
