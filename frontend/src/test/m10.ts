// M10/M10b: SVG editing with live preview and PNG export; HTML pages in a
// sandboxed preview with relative resources, scripts off by default and
// remote content blocked.
import { api, fileUrl } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
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
  await workspace.close(svg, { force: true });

  // ---- HTML ----
  await api.TestServedPages();
  const page = (await workspace.openPath(join(dir, 'web', 'index.html')))!;
  assertEq(page.moduleId, 'html', 'HTML opens in the page module');
  const hh = await waitFor(() => (htmlHooks(page)?.srcdoc() ? htmlHooks(page) : null), 'page built');
  const doc: string = hh.srcdoc();
  assert(doc.includes('Content-Security-Policy') && doc.includes("script-src 'none'"), 'CSP injected, scripts off');
  assert(doc.includes(`<base href="${hh.base()}">`) && hh.base().includes('/__hia/page/'), 'base points at the folder route');
  const info = hh.info();
  assertEq(info.title, 'Fixture page', 'title');
  assertEq(info.remoteRefs, 1, 'one remote reference detected');
  assertEq(info.externalLinks, 1, 'one external link disabled');
  assert(!/\shref="https:\/\/example\.com\/"/.test(doc) && doc.includes('data-hia-href="https://example.com/"'), 'external link neutralised');
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
