import { describe, expect, it } from "vitest";
import {
  apply,
  cropSize,
  dragCorner,
  dragEdge,
  homography,
  innerRect,
  invert,
  quadOk,
  rectQuad,
  straightenAngle,
  warpPixels,
  type Quad,
} from "./warp";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("homography", () => {
  const from = rectQuad(0, 0, 100, 50);
  const to: Quad = [
    { x: 10, y: 5 },
    { x: 120, y: -10 },
    { x: 90, y: 70 },
    { x: 0, y: 60 },
  ];
  it("takes the four corners where they go, and back", () => {
    const h = homography(from, to);
    for (let i = 0; i < 4; i++) close(apply(h, from[i]), to[i]);
    const back = invert(h);
    for (let i = 0; i < 4; i++) close(apply(back, to[i]), from[i]);
  });
  it("is a plain move for a moved rectangle", () => {
    const h = homography(from, rectQuad(7, 3, 100, 50));
    close(apply(h, { x: 50, y: 25 }), { x: 57, y: 28 });
  });
});

describe("dragging corners and edges", () => {
  const q = rectQuad(0, 0, 100, 100);
  it("distort moves one corner", () => {
    const r = dragCorner(q, 1, { x: 130, y: -20 }, "distort");
    expect(r[1]).toEqual({ x: 130, y: -20 });
    expect(r[0]).toEqual(q[0]);
  });
  it("perspective mirrors the neighbour along the edge dragged along", () => {
    const r = dragCorner(q, 0, { x: 20, y: 3 }, "perspective");
    expect(r[0]).toEqual({ x: 20, y: 0 });
    expect(r[1]).toEqual({ x: 80, y: 0 });
    const v = dragCorner(q, 2, { x: 101, y: 130 }, "perspective");
    expect(v[2]).toEqual({ x: 100, y: 130 });
    expect(v[1]).toEqual({ x: 100, y: -30 });
  });
  it("skew slides an edge along itself; distort moves it any way", () => {
    const s = dragEdge(q, 0, { x: 30, y: 10 }, "skew");
    expect(s[0]).toEqual({ x: 30, y: 0 });
    expect(s[1]).toEqual({ x: 130, y: 0 });
    expect(s[2]).toEqual(q[2]);
    const d = dragEdge(q, 1, { x: 30, y: 10 }, "distort");
    expect(d[1]).toEqual({ x: 130, y: 10 });
    expect(d[2]).toEqual({ x: 130, y: 110 });
  });
  it("a folded quadrilateral is not allowed", () => {
    expect(quadOk(q)).toBe(true);
    expect(quadOk([q[0], q[2], q[1], q[3]])).toBe(false);
  });
});

describe("crops", () => {
  it("a perspective crop is the average width and height", () => {
    expect(
      cropSize([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 120, y: 80 },
        { x: -20, y: 80 },
      ]),
    ).toEqual({ w: 120, h: 82 });
  });
  it("straighten levels a line, or stands it upright", () => {
    expect(straightenAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(
      -5.71,
      2,
    );
    expect(straightenAngle({ x: 0, y: 0 }, { x: -100, y: 10 })).toBeCloseTo(
      5.71,
      2,
    );
    expect(straightenAngle({ x: 0, y: 0 }, { x: 5, y: 100 })).toBeCloseTo(
      2.86,
      2,
    );
  });
  it("the inner rectangle of a turned picture", () => {
    expect(innerRect(200, 100, 0)).toEqual({ w: 200, h: 100 });
    const r = innerRect(200, 100, 10);
    expect(r.w).toBeLessThan(200);
    expect(r.h).toBeLessThan(100);
    // Its corners, turned back, are inside the picture.
    const a = (10 * Math.PI) / 180;
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const x = (sx * r.w) / 2;
      const y = (sy * r.h) / 2;
      expect(Math.abs(x * Math.cos(a) + y * Math.sin(a))).toBeLessThanOrEqual(
        100.01,
      );
      expect(Math.abs(-x * Math.sin(a) + y * Math.cos(a))).toBeLessThanOrEqual(
        50.01,
      );
    }
  });
});

describe("warpPixels", () => {
  it("moves a picture by a whole pixel exactly, transparent outside", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    src.set([255, 0, 0, 255], (1 * 4 + 2) * 4); // a red pixel at (2, 1)
    const h = homography(rectQuad(0, 0, 4, 4), rectQuad(1, 1, 4, 4));
    const out = warpPixels(src, 4, 4, invert(h), {
      x: 0,
      y: 0,
      width: 6,
      height: 6,
    });
    const at = (x: number, y: number) =>
      Array.from(out.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 4));
    expect(at(3, 2)).toEqual([255, 0, 0, 255]);
    expect(at(0, 0)[3]).toBe(0);
    expect(at(5, 5)[3]).toBe(0);
  });
});
