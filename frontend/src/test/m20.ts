// M20: DXF viewer and light CAD editor — opens R2000 (cp1252, CRLF) and R12
// drawings, draws blocks/hatches/splines/texts, picks and window-selects with
// the pointer, draws with typed coordinates, snaps, measures, moves, rotates,
// edits properties, undoes, saves by patching (untouched bytes stay the
// same) and stays responsive on a 52,000-object drawing.
import { readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, press, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const hooks = (t: Tab) => (t as unknown as { cadTest?: Hooks }).cadTest;

async function open(path: string): Promise<{ tab: Tab; h: Hooks; ms: number; jank: number }> {
  const t0 = performance.now();
  let tab!: Tab;
  const j = await measureJank(async () => {
    tab = (await workspace.openPath(path))!;
    await waitFor(() => (hooks(tab)?.info() && hooks(tab)?.scene() ? true : null), `${path} opened`, 20000);
  });
  return { tab, h: hooks(tab)!, ms: Math.round(performance.now() - t0), jank: Math.round(j.maxGap) };
}

const area = () => document.querySelector<HTMLElement>('.tabview.active [aria-label="Drawing"]')!;

function fire(type: string, x: number, y: number, extra: PointerEventInit = {}) {
  const r = area().getBoundingClientRect();
  area().dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, bubbles: true, ...extra }));
}

const decode1252 = (b: ArrayBuffer) => new TextDecoder('windows-1252').decode(b);

export default async function m20(dir: string) {
  const path = join(dir, 'cad', 'plan.dxf');
  const original = decode1252(await readFile(path));
  const { tab, h, ms, jank } = await open(path);
  log(`plan.dxf opened in ${ms} ms, longest UI frame ${jank} ms`);
  assertEq(tab.moduleId, 'cad', 'DXF opens in the CAD module');
  const info = h.info();
  assertEq(info.entities, 16, 'objects');
  assertEq(info.version, 'AC1015', 'version');
  assertEq(info.encoding, 'windows-1252', 'code page from $DWGCODEPAGE');
  assertEq(info.units, 4, 'millimetres');
  assertEq(info.layers.map((l: any) => l.name).join(','), '0,Walls,Furniture,Notes,Hidden', 'layers');
  let s = h.scene();
  assert(s.texts.some((t: any) => t.text === 'Living room – 60 m²'), 'cp1252 text decoded');
  assert(s.texts.some((t: any) => t.text === 'Kitchen\nnorth side'), 'MTEXT paragraphs');
  assert(Number.isNaN(s.boxes[15 * 4]), 'the line on the off layer is not drawn');
  assert(s.entPoly[11] - s.entPoly[7] >= 8, 'four chair blocks expanded');
  assert(Math.abs(s.bounds[2] - s.bounds[0] - 10000) < 1, 'extents');
  await waitFor(() => (h.frameReady() || !h.longest().worker ? true : null), 'first frame drawn');
  await sleep(50);
  // Something is painted.
  const c = h.canvas() as HTMLCanvasElement;
  const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 3; i < px.length; i += 4 * 7) if (px[i] > 0) ink++;
  assert(ink > 200, `canvas has drawing (${ink} samples)`);

  // ---- pick and window select with the pointer ----
  const [lx, ly] = h.toScreen(5000, 3);
  fire('pointerdown', lx, ly);
  fire('pointerup', lx, ly);
  assertEq(h.sel().join(','), '0', 'clicking the outer wall selects it');
  await waitFor(() => (h.props()?.type === 'LWPOLYLINE' ? true : null), 'properties of the wall');
  assertEq(h.props().area, 60e6, 'wall area');
  const [ax, ay] = h.toScreen(6800, 4200);
  const [bx, by] = h.toScreen(9200, 1800);
  fire('pointerdown', ax, ay);
  fire('pointermove', (ax + bx) / 2, (ay + by) / 2);
  fire('pointermove', bx, by);
  fire('pointerup', bx, by);
  assertEq(h.sel().join(','), '3,7,8,9,10', 'window selects the table and the chairs');
  // Crossing (right to left) also takes what it touches: the inner wall, the table edge, a chair.
  const [cx0, cy0] = h.toScreen(8200, 3000);
  const [cx1, cy1] = h.toScreen(5800, 2500);
  fire('pointerdown', cx0, cy0);
  fire('pointermove', cx1, cy1);
  fire('pointerup', cx1, cy1);
  assertEq(h.sel().join(','), '1,3,10', 'crossing selects touched objects');
  h.op('escape');

  // ---- draw with typed coordinates ----
  h.setLayer('Notes');
  h.setTool('line');
  await h.clickWorld(0, 7000);
  await h.typeCmd('@1000,0');
  assertEq(h.info().entities, 17, 'line added');
  s = h.scene();
  const line = s.entPoly[16];
  assertEq(s.coords[s.polys[line * 5 + 2] * 2 + 2] + s.origin[0], 1000, 'typed relative end point');
  assertEq(s.layers[s.entLayer[16]], 'Notes', 'on the current layer');
  h.op('escape');
  h.setTool('rect');
  await h.clickWorld(2000, 7000);
  await h.typeCmd('@500,300');
  h.setTool('circle');
  await h.clickWorld(3000, 7000);
  await h.typeCmd('250');
  h.setTool('arc');
  await h.clickWorld(4000, 7000);
  await h.clickWorld(4500, 7500);
  await h.clickWorld(5000, 7000);
  assertEq(h.info().entities, 20, 'rectangle, circle and arc added');
  assertEq(h.info().counts.ARC, 2, 'arc');
  h.setSel([18]);
  await waitFor(() => (h.props()?.type === 'CIRCLE' ? true : null), 'circle selected');
  assertEq(h.props().props.find((p: any) => p.label === 'Radius').value, '250.0', 'typed radius');
  h.setSel([17]);
  await waitFor(() => (h.props()?.type === 'LWPOLYLINE' ? true : null), 'rectangle selected');
  assertEq(h.props().area, 150000, 'rectangle area');

  // ---- snap: the cursor near the wall corner lands exactly on it ----
  h.setTool('line');
  const [qx, qy] = h.toScreen(10000, 6000);
  fire('pointermove', qx + 4, qy - 3);
  fire('pointerdown', qx + 4, qy - 3);
  fire('pointerup', qx + 4, qy - 3);
  await sleep(30);
  assertEq(h.pts().map((p: number[]) => p.join(',')).join(';'), '10000,6000', 'snapped to the end point');
  h.op('escape');

  // ---- measure ----
  h.setTool('measure');
  await h.clickWorld(0, 0);
  await h.clickWorld(3000, 4000);
  assert(h.measureText().startsWith('Distance 5000.00 mm'), `measure: ${h.measureText()}`);
  h.op('escape');

  // ---- move, rotate, properties ----
  h.setSel([18]);
  h.setTool('move');
  await h.clickWorld(3000, 7000);
  await h.typeCmd('@100,0');
  await waitFor(() => (h.props()?.props.find((p: any) => p.label === 'Centre X')?.value === '3100.0' ? true : null), 'moved by typed offset');
  h.setSel([11]);
  h.setTool('rotate');
  await h.clickWorld(500, 5500);
  await h.typeCmd('90');
  await waitFor(() => (h.props()?.props.find((p: any) => p.label === 'Rotation')?.value === '90.0' ? true : null), 'text rotated (group added)');
  h.setSel([3]);
  await waitFor(() => (h.props()?.type === 'CIRCLE' ? true : null), 'table selected');
  await h.setProp(40, 0, '700');
  await waitFor(() => (h.props()?.props.find((p: any) => p.label === 'Radius').value === '700.0' ? true : null), 'radius edited');
  // Moving a block reference moves its drawing.
  h.setSel([7]);
  h.setTool('move');
  await h.clickWorld(8000, 2100);
  await h.clickWorld(8000, 1600);
  s = h.scene();
  assert(Math.abs(s.boxes[7 * 4 + 1] + s.origin[1] - 1400) < 1, `chair moved (${s.boxes[7 * 4 + 1] + s.origin[1]})`);

  // ---- undo / redo ----
  h.op('undo');
  await waitFor(() => (Math.abs(h.scene().boxes[7 * 4 + 1] + h.scene().origin[1] - 1900) < 1 ? true : null), 'undo');
  h.op('redo');
  await waitFor(() => (Math.abs(h.scene().boxes[7 * 4 + 1] + h.scene().origin[1] - 1400) < 1 ? true : null), 'redo');

  // ---- delete via keyboard ----
  h.setSel([16]);
  area().focus();
  press('Delete', area());
  await waitFor(() => (h.info().entities === 19 ? true : null), 'Delete removes the selected line');
  assert(tab.dirty, 'dirty');

  // ---- save: patches only ----
  assert(await h.save(), 'saved');
  assert(!tab.dirty, 'clean after save');
  const saved = decode1252(await readFile(path));
  assert(saved.includes('Living room – 60 m²'), 'cp1252 text written back');
  assert(!/[^\r]\n/.test(saved), 'CRLF kept');
  const tail = (t: string) => t.slice(t.indexOf('OBJECTS'));
  assertEq(tail(saved), tail(original), 'OBJECTS section byte-identical');
  const head = (t: string) => t.slice(0, t.indexOf('$HANDSEED'));
  assertEq(head(saved), head(original), 'header before $HANDSEED byte-identical');
  assert(/\$HANDSEED\r\n\s*5\r\n200[4-9A-F]\r\n/.test(saved), 'handle seed advanced');
  assert(saved.includes('\r\n100\r\nAcDbCircle\r\n10\r\n3100.0\r\n'), 'moved circle written');
  const before = original.split('\r\n');
  const after = saved.split('\r\n');
  log(`saved: ${before.length} → ${after.length} lines`);
  assert(h.svg().includes('<path'), 'SVG export');
  await workspace.close(tab, { force: true });

  // ---- R12: padded codes, POLYLINE output ----
  const r12path = join(dir, 'cad', 'r12.dxf');
  const r12 = await open(r12path);
  assertEq(r12.h.info().entities, 2, 'R12 objects');
  r12.h.setTool('polyline');
  for (const [x, y] of [
    [0, 100],
    [50, 150],
    [100, 100],
  ])
    await r12.h.clickWorld(x, y);
  r12.h.op('enter');
  await waitFor(() => (r12.h.info().entities === 3 ? true : null), 'polyline added');
  assert(await r12.h.save(), 'R12 saved');
  const r12text = new TextDecoder().decode(await readFile(r12path));
  assert(r12text.includes('  0\nPOLYLINE\n  5\n') === false && r12text.includes('  0\nVERTEX\n  8\n0\n 10\n50.0\n 20\n150.0'), 'R12 polyline written as VERTEX records with padded codes');
  assert(r12text.endsWith('  0\nSEQEND\n  8\n0\n  0\nENDSEC\n  0\nEOF\n'), 'SEQEND then ENDSEC');
  await workspace.close(r12.tab, { force: true });

  // ---- a big drawing stays responsive ----
  const big = await open(join(dir, 'cad', 'big.dxf'));
  log(`big.dxf (52,000 objects) opened in ${big.ms} ms, longest UI frame ${big.jank} ms`);
  assertEq(big.h.info().entities, 52000, 'big drawing objects');
  const zj = await measureJank(async () => {
    const r = area().getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      area().dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: i < 4 ? -120 : 120, bubbles: true, cancelable: true }));
      await sleep(60);
    }
  });
  const sj = await measureJank(async () => {
    big.h.setSel(Array.from({ length: 2000 }, (_, i) => i));
    await sleep(100);
  });
  const mj = await measureJank(async () => {
    big.h.setTool('move');
    await big.h.clickWorld(0, 0);
    await big.h.typeCmd('@10,10');
    await sleep(100);
  });
  const L = big.h.longest();
  log(`big.dxf longest UI frame: zoom ${Math.round(zj.maxGap)} ms, select 2000 ${Math.round(sj.maxGap)} ms, move them ${Math.round(mj.maxGap)} ms; page redraw ${Math.round(L.base)} ms, ${L.worker ? `worker render ${Math.round(L.render)} ms` : `scene upload ${Math.round(L.painter)} ms (drawn on the page)`}`);
  assertEq(big.h.info().entities, 52000, 'still 52,000 objects');
  await workspace.close(big.tab, { force: true });
}
