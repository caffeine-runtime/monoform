// M50: the text and interface size sliders. Changing them while a file is
// open resizes everything at once: the code editor re-measures (its lines,
// cursor and gutter line up with the new font size), and the interface
// tokens follow. Before the fix the editor kept its old line heights until
// the app was restarted (overlapping or gapped lines, clicks landing on the
// wrong line).
import { controllers } from '../modules/text/controllers';
import { join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { assert, log, sleep, waitFor } from './harness';

const frames = (n = 2) => new Promise<void>((r) => { const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); });

export default async function m50(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const before = { font: settings.value.fontSize, scale: settings.value.uiScale };
  const tab = (await workspace.openPath(join(dir, 'code', 'sample.ts')))!;
  const view = await waitFor(() => controllers.get(tab.id)?.view ?? null, 'editor');
  await sleep(300);

  /** Does the editor's idea of line 12 match where the DOM draws it? */
  function check(what: string) {
    const line = view.state.doc.line(Math.min(12, view.state.doc.lines));
    const at = view.coordsAtPos(line.from);
    const el = view.domAtPos(line.from).node;
    const lineEl = (el.nodeType === 1 ? (el as Element) : el.parentElement)!.closest('.cm-line')!;
    const r = lineEl.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(lineEl).fontSize);
    log(`${what}: font ${fs}px, line height ${view.defaultLineHeight.toFixed(1)} vs drawn ${r.height.toFixed(1)}, line 12 at ${at?.top.toFixed(1)} vs ${r.top.toFixed(1)}`);
    assert(at && at.top >= r.top - 1 && at.bottom <= r.bottom + 1, `${what}: the editor knows where line 12 is`);
    assert(Math.abs(view.defaultLineHeight - r.height) < 2, `${what}: line height re-measured`);
    return fs;
  }
  const f0 = check('start');
  try {
    for (const size of [20, 26, 11]) {
      settings.update((s) => (s.fontSize = size));
      await frames(3);
      const f = check(`text size ${size}`);
      assert(Math.abs(f - size * (settings.value.uiScale || 1)) < 0.6, `text size ${size} applied (${f}px)`);
    }
    for (const scale of [1.5, 0.9]) {
      settings.update((s) => (s.uiScale = scale));
      await frames(3);
      check(`interface ${scale * 100}%`);
      const ui = parseFloat(getComputedStyle(document.querySelector('.status')!).fontSize);
      assert(ui > 0, `interface text ${ui}px`);
    }
    log(`text sizes and interface scale apply at once (started at ${f0}px)`);
    // The interface slider shows the value while dragged and applies it on release
    // (rescaling the page under the pointer made it jump).
    settings.update((s) => (s.uiScale = 1));
    const { commands } = await import('../core/commands');
    commands.execute('app.settings');
    const slider = await waitFor(() => document.querySelector<HTMLInputElement>('#uis'), 'interface slider in Settings');
    const pct = () => slider.parentElement!.querySelector('.pct')!.textContent;
    const big = String(Number(slider.max));
    slider.value = big;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frames(2);
    assert(settings.value.uiScale === 1, 'not applied while dragging');
    assert(pct() !== '100%', `but the value shows (${pct()})`);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await frames(2);
    assert(settings.value.uiScale > 1, `applied on release (${settings.value.uiScale})`);
    assert(pct() === `${Math.round(settings.value.uiScale * 100)}%`, 'and shown');
  } finally {
    settings.update((s) => {
      s.fontSize = before.font;
      s.uiScale = before.scale;
    });
    await workspace.close(tab, { force: true });
  }
}
