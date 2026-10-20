// M28: Graphviz and Mermaid — a .dot file drawn with clusters, records and
// labels (clicking a node selects its line; an error keeps the last drawing
// and points at its line; PNG export); a Mermaid flowchart (first load
// timed); Mermaid and DOT blocks inside Markdown, a broken one reported.
import { readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, waitFor } from './harness';

const dh = (t: Tab) => (t as unknown as { diagramTest?: Record<string, any> }).diagramTest;

function clickAt(el: Element, target: Element) {
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 }));
}

export default async function m28(dir: string) {
  // ---- Graphviz ----
  const dotTab = (await workspace.openPath(join(dir, 'diagrams', 'build.dot')))!;
  assertEq(dotTab.moduleId, 'diagram', '.dot opens in the diagram view');
  const h = await waitFor(() => (dh(dotTab)?.svg() ? dh(dotTab) : null), 'drawn');
  const stage: HTMLElement = h.stage();
  assertEq(stage.querySelectorAll('g.node').length, 5, 'nodes');
  assertEq(stage.querySelectorAll('g.edge').length, 5, 'edges');
  assert(stage.querySelector('g.cluster text')?.textContent === 'Sources', 'cluster label');
  assertEq(dotTab.status?.info, '5 nodes · 5 edges', 'status');
  const parser = [...stage.querySelectorAll('g.node')].find((g) => g.textContent?.includes('Parser'))!;
  assert(parser.textContent === 'Parser(LL)', 'two-line label');
  clickAt(stage, parser);
  await waitFor(() => (h.cursorLine() === 7 ? true : null), 'click selects the node’s line');

  // An error keeps the drawing and names the line.
  const good = h.svg();
  h.setText('digraph {\n  a -> b\n  b -- c\n}');
  await waitFor(() => (h.error().line === 3 ? true : null), 'error on line 3');
  assertEq(h.svg(), good, 'last drawing kept');
  assert(document.querySelector('.tabview.active .err')?.textContent?.includes('Line 3'), 'error shown');
  h.setText('digraph { a -> b; b -> c; a -> c [label="skip"] }');
  await waitFor(() => (!h.error().error && h.svg() !== good ? true : null), 'redrawn');
  assertEq(stage.querySelectorAll('g.node').length, 3, 'new graph');
  const z = h.zoom();
  h.zoomBy(2);
  assert(h.zoom() > z, 'zoom in');
  h.fit();
  const png = join(dir, 'diagrams', 'out.png');
  assert(await h.pngTo(png, 1), 'PNG exported');
  const head = new Uint8Array(await readFile(png)).slice(0, 4);
  assertEq([...head].join(','), '137,80,78,71', 'PNG file');
  await workspace.close(dotTab, { force: true });

  // ---- Mermaid ----
  const { result: mmTab, maxGap } = await measureJank(async () => {
    const t = (await workspace.openPath(join(dir, 'diagrams', 'flow.mmd')))!;
    await waitFor(() => dh(t)?.svg(), 'mermaid drawn', 20000);
    return t;
  });
  log(`mermaid first render: longest frame ${Math.round(maxGap)} ms`);
  const mh = dh(mmTab)!;
  assert(mh.svg().includes('flowchart'), 'flowchart SVG');
  assert(mh.stage().textContent.includes('Known type?'), 'labels');
  const again = await measureJank(async () => {
    const before = mh.svg();
    mh.setText('flowchart LR\n  X[Second] --> Y[Render] --> Z[Here]');
    await waitFor(() => (mh.svg() !== before ? true : null), 'second mermaid render');
  });
  log(`mermaid later render: longest frame ${Math.round(again.maxGap)} ms`);
  mh.setText('flowchart TD\n  A --> ');
  await waitFor(() => (mh.error().error ? true : null), 'mermaid error reported');
  await workspace.close(mmTab, { force: true });

  // ---- inside Markdown ----
  const md = (await workspace.openPath(join(dir, 'diagrams', 'notes.md')))!;
  await waitFor(() => (document.querySelectorAll('.tabview.active .preview .diagram svg').length === 2 ? true : null), 'two diagrams drawn in the preview', 20000);
  const blocks = [...document.querySelectorAll<HTMLElement>('.tabview.active .preview .diagram')];
  assertEq(blocks.map((b) => b.dataset.kind).join(','), 'mermaid,dot,mermaid', 'kinds');
  await waitFor(() => (blocks[2].classList.contains('error') ? true : null), 'broken block reported');
  assert(blocks[2].querySelector('.diagram-src')?.textContent?.includes('A -->'), 'its source shown');
  assert(blocks[0].textContent?.includes('Alice'), 'sequence diagram');
  await workspace.close(md, { force: true });
}
