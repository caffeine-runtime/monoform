// M33: layouts that fit — four files in a 2×2 split of a small window. Every
// toolbar fits its pane: no control past the edge, no button text on two
// lines; buttons that dropped their text to an icon are named on hover; side
// panels (image, PDF thumbnails, database tables) float instead of squeezing
// the content and open from the toolbar; with room again the labels return.
// A PDF at "Fit width" refits when the window or its pane changes size.
import { commands } from '../core/commands';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { WindowGetSize, WindowSetSize } from '../wailsjs/runtime/runtime';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const pane = (t: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${t.id}"]`) ?? null;

function lines(el: Element): number {
  const r = document.createRange();
  r.selectNodeContents(el);
  return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top / 4))).size;
}

/** Problems with the toolbars inside root. */
function barProblems(root: Element): string[] {
  const out: string[] = [];
  for (const bar of root.querySelectorAll<HTMLElement>('.fit')) {
    if (!bar.getClientRects().length) continue;
    const r = bar.getBoundingClientRect();
    if (getComputedStyle(bar).overflowX !== 'visible' && bar.scrollWidth > bar.clientWidth + 1) out.push(`bar overflows ${bar.scrollWidth}>${bar.clientWidth}`);
    for (const c of bar.querySelectorAll<HTMLElement>('button, input, select')) {
      const cr = c.getBoundingClientRect();
      if (!cr.width) continue;
      const name = c.textContent?.trim() || c.title || c.tagName;
      if (cr.right > r.right + 1 || cr.left < r.left - 1) out.push(`"${name}" outside its bar`);
      if (c.tagName === 'BUTTON' && c.textContent?.trim() && getComputedStyle(c).fontSize !== '0px' && lines(c) > 1) out.push(`"${name}" wraps`);
    }
  }
  return out;
}

/** Resize the window until ok() (a window manager under load can drop a request). */
async function sizeTo<T>(w: number, h: number, ok: () => T | null, what: string): Promise<NonNullable<T>> {
  WindowSetSize(w, h);
  let asked = performance.now();
  return waitFor(() => {
    const v = ok();
    if (v === null && performance.now() - asked > 1000) {
      WindowSetSize(w, h);
      asked = performance.now();
    }
    return v;
  }, what, 10000);
}

export default async function m33(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const before = await WindowGetSize();
  const pdf = (await workspace.openPath(join(dir, 'pdf', 'three.pdf')))!;
  const json = (await workspace.openPath(join(dir, 'data', 'people.json')))!;
  const img = (await workspace.openPath(join(dir, 'img', 'photo.png')))!;
  const db = (await workspace.openPath(join(dir, 'db', 'shop.db')))!;
  await waitFor(() => pane(json)?.querySelector('.fit'), 'json toolbar');

  // A PDF at "Fit width" refits when its view changes size.
  const fitInfo = () => {
    const c = pane(pdf)!.querySelector<HTMLElement>('.container');
    return `${c?.querySelector('.pdfViewer .page')?.getBoundingClientRect().width} px page, ${c?.clientWidth} px view`;
  };
  const fits = () => {
    const c = pane(pdf)?.querySelector<HTMLElement>('.container');
    const pg = c?.querySelector<HTMLElement>('.pdfViewer .page');
    if (!c?.clientWidth || !pg) return null;
    const w = pg.getBoundingClientRect().width;
    return w <= c.clientWidth + 2 && w >= c.clientWidth * 0.8 ? w : null;
  };
  workspace.activate(pdf);
  const wide = await waitFor(fits, 'PDF fits the window');
  const narrowW = await sizeTo(900, 640, () => (window.innerWidth < 1000 ? fits() : null), 'PDF refits a smaller window').catch(() => {
    throw new Error(`PDF after the window shrank: ${fitInfo()}`);
  });
  assert(narrowW < wide, `page narrower (${wide} → ${narrowW})`);

  // ---- wide: one tab, labels shown ----
  await sizeTo(before.w, before.h, () => (window.innerWidth >= before.w - 40 ? true : null), 'window back to size');
  workspace.activate(json);
  await sleep(300);
  const jbar = pane(json)!.querySelector<HTMLElement>('.fit')!;
  const expand = await waitFor(() => [...jbar.querySelectorAll('button')].find((b) => b.textContent?.includes('Expand all')), 'Expand all button');
  await waitFor(() => (!jbar.classList.contains('compact') ? true : null), 'a wide pane shows button labels');
  assert(!expand.title, 'no tooltip needed while the label shows');

  // ---- narrow: 2×2 split of a small window ----
  WindowSetSize(900, 640);
  commands.execute('view.splitGrid');
  await waitFor(() => (workspace.split?.panes.length === 4 ? true : null), 'four panes');
  await sleep(600);
  const widths = [json, img, db, pdf].map((t) => Math.round(pane(t)!.getBoundingClientRect().width));
  log(`window ${window.innerWidth}×${window.innerHeight}, pane widths ${widths.join(', ')}`);
  assert(widths.every((w) => w < 520), `panes are narrow (${widths})`);
  for (const t of [json, img, db, pdf]) {
    await waitFor(() => (barProblems(pane(t)!).length === 0 ? true : null), `${t.title}: toolbars fit`, 3000).catch(() => {
      throw new Error(`${t.title}: ${barProblems(pane(t)!).join('; ')}`);
    });
  }

  await waitFor(fits, 'PDF page fits the pane width', 5000).catch(() => {
    throw new Error(`PDF page doesn't fit its pane: ${fitInfo()}`);
  });

  // Icons only, named on hover.
  await waitFor(() => (jbar.classList.contains('compact') ? true : null), 'json toolbar shows icons only');
  assertEq(expand.title, 'Expand all', 'name on hover');
  assertEq(getComputedStyle(expand).fontSize, '0px', 'label hidden');
  assert(expand.getBoundingClientRect().width < 40, `icon-sized button (${expand.getBoundingClientRect().width})`);

  // Side panels don't squeeze the content.
  const imgPanel = pane(img)!.querySelector('aside.panel');
  assert(!imgPanel || imgPanel.classList.contains('floating'), 'image panel closed or floating');
  assert(!pane(pdf)!.querySelector('.thumbs'), 'PDF thumbnails closed in a narrow pane');
  await waitFor(() => (pane(db)!.querySelector('.grid, table, [role=grid]') ? true : null), 'db grid');
  assert(!pane(db)!.querySelector('aside.schema'), 'table list closed in a narrow pane');
  const toggle = await waitFor(() => pane(db)!.querySelector<HTMLButtonElement>('button[title="Tables and views"]'), 'tables button');
  toggle.click();
  const schema = await waitFor(() => pane(db)!.querySelector<HTMLElement>('aside.schema.floating'), 'table list floats');
  assert(schema.getBoundingClientRect().width < pane(db)!.getBoundingClientRect().width, 'over part of the pane');
  [...schema.querySelectorAll<HTMLButtonElement>('button.obj')].find((b) => b.textContent?.includes('orders'))!.click();
  await waitFor(() => (!pane(db)!.querySelector('aside.schema') ? true : null), 'picking a table closes the list');

  // ---- room again ----
  workspace.setSplit(null);
  WindowSetSize(before.w, before.h);
  workspace.activate(json);
  // A window manager under load can drop a resize request: ask again each second.
  let asked = performance.now();
  await waitFor(() => {
    if (!jbar.classList.contains('compact')) return true;
    if (performance.now() - asked > 1000) {
      WindowSetSize(before.w, before.h);
      asked = performance.now();
    }
    return null;
  }, 'labels return', 10000);
  assert(!expand.title, 'tooltip removed with the label back');
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
