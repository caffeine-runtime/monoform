// Pending marks on PDF pages (signatures to stamp, areas to redact) and the
// geometry to apply them: page-relative rectangles → PDF user space, text
// matches → rectangles, signature images → trimmed transparent PNGs. Pure;
// unit-tested.

export interface Mark {
  id: number;
  kind: 'sign' | 'redact';
  page: number;
  /** Rectangle as fractions of the page as displayed (top-left origin, current rotation). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Signature image (PNG data URL). */
  src?: string;
}

/** The parts of a pdf.js PageViewport we use. */
export interface Viewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * The "cm" matrix that maps an image's unit square onto a mark, in PDF user
 * space; vp is the page's viewport at scale 1 with its own rotation.
 */
export function stampMatrix(m: Pick<Mark, 'x' | 'y' | 'w' | 'h'>, vp: Viewport): [number, number, number, number, number, number] {
  const x0 = m.x * vp.width;
  const x1 = (m.x + m.w) * vp.width;
  const y0 = m.y * vp.height;
  const y1 = (m.y + m.h) * vp.height;
  const [ax, ay] = vp.convertToPdfPoint(x0, y1); // image bottom-left
  const [bx, by] = vp.convertToPdfPoint(x1, y1); // bottom-right
  const [cx, cy] = vp.convertToPdfPoint(x0, y0); // top-left
  return [bx - ax, by - ay, cx - ax, cy - ay, ax, ay];
}

/** A mark's corners in another viewport (e.g. the unrotated one used to rasterise a page). */
export function markPolygon(m: Pick<Mark, 'x' | 'y' | 'w' | 'h'>, from: Viewport, to: Viewport): [number, number][] {
  const pts: [number, number][] = [
    [m.x, m.y],
    [m.x + m.w, m.y],
    [m.x + m.w, m.y + m.h],
    [m.x, m.y + m.h],
  ];
  return pts.map(([fx, fy]) => {
    const [ux, uy] = from.convertToPdfPoint(fx * from.width, fy * from.height);
    const [vx, vy] = to.convertToViewportPoint(ux, uy);
    return [vx, vy];
  });
}

/** A text run from pdf.js getTextContent(). */
export interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Rectangles (page fractions, like Mark) around every occurrence of query in
 * a page's text runs; generous so a redaction covers ascenders and descenders.
 */
export function matchRects(runs: TextRun[], query: string, caseSensitive: boolean, vp: Viewport): { x: number; y: number; w: number; h: number }[] {
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of runs) {
    if (!r.str) continue;
    const s = caseSensitive ? r.str : r.str.toLowerCase();
    const [a, b, c, d, e, f] = r.transform;
    const len = Math.hypot(a, b) || 1;
    const ux = a / len;
    const uy = b / len;
    const fontH = Math.hypot(c, d) || r.height || 10;
    const vx = -uy;
    const vy = ux;
    for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) {
      const t0 = (i / s.length) * r.width;
      const t1 = ((i + q.length) / s.length) * r.width;
      const below = -0.3 * fontH;
      const above = 1.0 * fontH;
      const pad = 0.08 * fontH;
      const corners = [
        [t0 - pad, below],
        [t1 + pad, below],
        [t1 + pad, above],
        [t0 - pad, above],
      ].map(([t, n]) => vp.convertToViewportPoint(e + ux * t + vx * n, f + uy * t + vy * n));
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(vp.width, Math.max(...xs));
      const y1 = Math.min(vp.height, Math.max(...ys));
      if (x1 > x0 && y1 > y0) out.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
    }
  }
  return out;
}

/** Bounding box of pixels with alpha above a threshold, or null when empty. */
export function inkBox(px: Uint8ClampedArray, w: number, h: number, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Turn a photo/scan of a signature into ink on transparency: light paper
 * becomes transparent, dark strokes keep their colour (in place).
 */
export function paperToAlpha(px: Uint8ClampedArray, paper = 200, ink = 90) {
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const a = l >= paper ? 0 : l <= ink ? 255 : Math.round((255 * (paper - l)) / (paper - ink));
    px[i + 3] = Math.min(px[i + 3], a);
  }
}
