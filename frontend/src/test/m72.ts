// M72: corner-pin transforms, perspective crop and straighten. A red
// 100×60 block on a layer over white (200×150): the move tool's Distort
// button gives the layer's content four corner handles; dragging the top
// right one with the pointer pulls that corner out (previewed), Enter
// applies it as one undo step. Perspective moves the neighbouring corner the
// other way; Skew slides a side along itself; Esc puts the layer back.
// Perspective crop of a grey quadrilateral on white makes it a grey
// rectangle as wide and high as its sides on average. Straightening along a
// tilted line levels it and cuts off the empty corners; one undo each.
import { commands } from "../core/commands";
import { join } from "../core/paths";
import { workspace } from "../core/tabs.svelte";
import { assert, assertEq, log, sleep, waitFor } from "./harness";

function canvas(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  return c;
}

export default async function m72(dir: string) {
  for (const t of [...workspace.tabs])
    await workspace.close(t, { force: true });
  const tab = (await workspace.openPath(join(dir, "img", "photo.png")))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = await waitFor(
    () => ((tab as any).imageTest?.editor() ? (tab as any).imageTest : null),
    "the image editor",
    10000,
  );
  const ed = h.editor();
  const root = () =>
    document.querySelector(`.tabview[data-tab-id="${tab.id}"]`)!;
  const white = (w: number, hh: number) =>
    canvas(w, hh, (g) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, hh);
    });
  ed.load(white(200, 150));
  const id = ed.addLayer(
    "Block",
    canvas(200, 150, (g) => {
      g.fillStyle = "#f00";
      g.fillRect(50, 45, 100, 60);
    }),
  );
  await sleep(50);
  const px = (x: number, y: number) =>
    Array.from(
      ed.composite().getContext("2d")!.getImageData(x, y, 1, 1).data,
    ).join();
  const RED = "255,0,0,255";
  const WHITE = "255,255,255,255";

  // ---- distort with the pointer ----
  h.setTool("move");
  await sleep(30);
  const distort = Array.from(
    root().querySelectorAll<HTMLButtonElement>(".toolopts .btn, .btn"),
  ).find((b) => b.textContent?.trim() === "Distort")!;
  assert(distort, "the move tool offers Distort");
  distort.click();
  await waitFor(
    () => (ed.state().warping === "distort" ? true : null),
    "distorting",
  );
  assert(
    root().querySelector(".banner.transforming .chip.on")?.textContent ===
      "Distort",
    "the banner shows the mode",
  );
  assertEq(
    JSON.stringify(ed.warpQuad()),
    JSON.stringify([
      { x: 50, y: 45 },
      { x: 150, y: 45 },
      { x: 150, y: 105 },
      { x: 50, y: 105 },
    ]),
    "handles on the content’s corners",
  );
  const box = () => ed.stage.container().getBoundingClientRect();
  const screen = (x: number, y: number) => {
    const p = ed.docGroup.getAbsoluteTransform().point({ x, y });
    return { x: box().left + p.x, y: box().top + p.y };
  };
  const fire = (type: string, x: number, y: number, target?: Element) => {
    const el = target ?? document.elementFromPoint(x, y)!;
    const o = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "up" ? 0 : 1,
    };
    el.dispatchEvent(
      new PointerEvent(`pointer${type}`, {
        ...o,
        pointerId: 1,
        isPrimary: true,
        pointerType: "mouse",
      }),
    );
    el.dispatchEvent(new MouseEvent(`mouse${type}`, o));
  };
  const corner = ed.warpUi.findOne(".corner1");
  await waitFor(
    () =>
      ed.stage.getIntersection(
        ed.docGroup.getAbsoluteTransform().point({ x: 150, y: 45 }),
      ) === corner
        ? true
        : null,
    "the corner handle drawn",
  );
  const a = screen(150, 45);
  const b = screen(180, 20);
  const el = document.elementFromPoint(a.x, a.y)!;
  fire("down", a.x, a.y, el);
  for (let i = 1; i <= 6; i++)
    fire("move", a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6, el);
  await sleep(60);
  fire("up", b.x, b.y, el);
  await sleep(60);
  const q = ed.warpQuad();
  assert(
    Math.abs(q[1].x - 180) < 2 && Math.abs(q[1].y - 20) < 2 && q[0].x === 50,
    `the corner dragged (${JSON.stringify(q[1])})`,
  );
  assertEq(px(160, 30), RED, "previewed: red out at the new corner");
  const steps = ed.history.length;
  commands.execute("image.apply"); // Enter
  await sleep(30);
  assertEq(ed.state().warping, null, "applied");
  assertEq(ed.history.length, steps + 1, "one step");
  assertEq(px(160, 30), RED, "the corner is out there");
  assertEq(px(145, 100), RED, "the rest still red");
  assertEq(px(155, 100), WHITE, "the right side slants in");
  ed.undo();
  assertEq(px(160, 30), WHITE, "undone");
  log("distort: corner dragged with the pointer, previewed, applied, undone");

  // ---- perspective and skew; Esc ----
  ed.startWarp("perspective");
  ed.warpDrag(0, { x: 70, y: 46 });
  let qq = ed.warpQuad();
  assert(
    qq[0].x === 70 && qq[1].x === 130 && qq[0].y === 45,
    `perspective: the neighbour moves the other way (${JSON.stringify(qq)})`,
  );
  ed.startWarp("skew");
  assertEq(ed.state().warping, "skew", "switched to skew");
  ed.warpDrag(0, { x: 130, y: 55 }, true); // the top edge's middle, from (100, 45)
  qq = ed.warpQuad();
  assert(
    qq[0].x === 100 && qq[1].x === 160 && qq[0].y === 45 && qq[3].x === 50,
    `skew: the top slides along itself (${JSON.stringify(qq)})`,
  );
  ed.finishWarp(false);
  assertEq(px(52, 47), RED, "Esc: the layer as it was");
  assertEq(px(48, 47), WHITE, "exactly");
  assertEq(
    ed.state().layers.find((l: { id: string }) => l.id === id).name,
    "Block",
    "still the same layer",
  );
  log("perspective, skew, cancel");

  // ---- perspective crop ----
  ed.load(
    canvas(200, 150, (g) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 200, 150);
      g.fillStyle = "#808080";
      g.beginPath();
      g.moveTo(40, 30);
      g.lineTo(170, 20);
      g.lineTo(180, 130);
      g.lineTo(30, 120);
      g.closePath();
      g.fill();
    }),
  );
  h.setTool("crop");
  await sleep(30);
  const pc = Array.from(
    root().querySelectorAll<HTMLButtonElement>(".btn"),
  ).find((x) => x.textContent?.trim() === "Perspective crop…")!;
  pc.click();
  await waitFor(
    () => (ed.state().warping === "crop" ? true : null),
    "perspective crop",
  );
  assert(root().querySelector(".banner.warping"), "its banner");
  ed.warpDrag(0, { x: 42, y: 32 });
  ed.warpDrag(1, { x: 168, y: 22 });
  ed.warpDrag(2, { x: 178, y: 128 });
  ed.warpDrag(3, { x: 32, y: 118 });
  ed.finishWarp(true);
  await sleep(30);
  const W = ed.width;
  const H = ed.height;
  assert(
    Math.abs(W - 136) <= 2 && Math.abs(H - 96) <= 2,
    `a rectangle as big as the sides on average (${W} × ${H})`,
  );
  for (const [x, y] of [
    [2, 2],
    [W - 3, 2],
    [W - 3, H - 3],
    [2, H - 3],
    [W >> 1, H >> 1],
  ])
    assertEq(px(x, y), "128,128,128,255", `grey at ${x}, ${y}`);
  ed.undo();
  assertEq(`${ed.width}×${ed.height}`, "200×150", "one undo");
  log("perspective crop makes the quadrilateral a rectangle");

  // ---- straighten ----
  const tilt = (8 * Math.PI) / 180;
  ed.load(
    canvas(300, 200, (g) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 300, 200);
      g.strokeStyle = "#000";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(20, 100 - 130 * Math.tan(tilt));
      g.lineTo(280, 100 + 130 * Math.tan(tilt));
      g.stroke();
    }),
  );
  h.setTool("straighten");
  // The tool bar changes: wait for the view to settle before aiming at the picture.
  let last = "";
  await waitFor(async () => {
    await sleep(60);
    const v = JSON.stringify(ed.docGroup.getAbsoluteTransform().getMatrix());
    const same = v === last;
    last = v;
    return same ? true : null;
  }, "the view settled");
  const s0 = screen(40, 100 - 110 * Math.tan(tilt));
  const s1 = screen(260, 100 + 110 * Math.tan(tilt));
  const orig = ed.straighten.bind(ed);
  let turned = 0;
  ed.straighten = (d: number, c?: boolean) => {
    turned = d;
    return orig(d, c);
  };
  fire("down", s0.x, s0.y);
  for (let i = 1; i <= 6; i++)
    fire(
      "move",
      s0.x + ((s1.x - s0.x) * i) / 6,
      s0.y + ((s1.y - s0.y) * i) / 6,
    );
  await sleep(30);
  assertEq(ed.gradLine.points().length, 4, "the line shown while dragging");
  fire("up", s1.x, s1.y);
  await sleep(60);
  assert(
    ed.width < 300 && ed.height < 200,
    `the empty corners cut off (${ed.width} × ${ed.height})`,
  );
  // Where the line is now, a third and two thirds across.
  const rowOf = (x: number) => {
    const d = ed
      .composite()
      .getContext("2d")!
      .getImageData(x, 0, 1, ed.height).data;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < ed.height; y++)
      if (d[y * 4] < 100) {
        sum += y;
        n++;
      }
    return n ? sum / n : -1;
  };
  const y1 = rowOf(Math.round(ed.width / 3));
  const y2 = rowOf(Math.round((2 * ed.width) / 3));
  assert(
    y1 > 0 && Math.abs(y1 - y2) < 1.2,
    `level now (${y1.toFixed(1)} vs ${y2.toFixed(1)}, turned ${turned.toFixed(2)}°)`,
  );
  ed.undo();
  assertEq(`${ed.width}×${ed.height}`, "300×200", "one undo");
  ed.setOptions({ straightenCrop: false });
  ed.straighten(8);
  assert(
    ed.width > 300 && ed.height > 200,
    `without the crop the canvas grows (${ed.width} × ${ed.height})`,
  );
  ed.undo();
  ed.setOptions({ straightenCrop: true });
  log(
    "straighten along a tilted line: level, corners cut; or the canvas grows",
  );
  await workspace.close(tab, { force: true });
}
