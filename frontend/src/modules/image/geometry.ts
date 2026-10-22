// Pure geometry for the image viewer (unit-tested).

export interface View {
  zoom: number;
  x: number; // screen offset of image origin
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zoom that fits the image in the viewport (never upscales unless allowUp). */
export function fitZoom(iw: number, ih: number, cw: number, ch: number, pad = 24, allowUp = false): number {
  if (!iw || !ih || !cw || !ch) return 1;
  const z = Math.min((cw - pad * 2) / iw, (ch - pad * 2) / ih);
  return allowUp ? z : Math.min(1, z);
}

/** View centred in the viewport at the given zoom. */
export function centered(iw: number, ih: number, cw: number, ch: number, zoom: number): View {
  return { zoom, x: Math.round((cw - iw * zoom) / 2), y: Math.round((ch - ih * zoom) / 2) };
}

/** Zoom around a screen point so that point stays fixed. */
export function zoomAt(v: View, px: number, py: number, newZoom: number): View {
  const z = clampZoom(newZoom);
  const k = z / v.zoom;
  return { zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** The view at zoom z, turned deg, with document point p at screen point at. */
export function viewWith(z: number, deg: number, p: { x: number; y: number }, at: { x: number; y: number }): View {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { x: at.x - z * (p.x * c - p.y * s), y: at.y - z * (p.x * s + p.y * c), zoom: z };
}

/**
 * What a wheel event means. A mouse wheel (whole notches: wheelDelta in
 * multiples of 120, or lines) zooms; a touchpad's two-finger scroll pans,
 * and its pinch (sent with Ctrl) zooms. `panning`: the gesture already
 * panned (a fast scroll can look like a notch now and then).
 */
export function wheelIntent(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; wheelDeltaY?: number }, panning = false): 'zoom' | 'pan' {
  if (e.ctrlKey) return 'zoom';
  if (panning) return 'pan';
  if (e.deltaMode !== 0) return 'zoom';
  if (e.deltaX === 0 && e.wheelDeltaY && e.wheelDeltaY % 120 === 0) return 'zoom';
  return 'pan';
}

export function clampZoom(z: number): number {
  return Math.min(64, Math.max(0.02, z));
}

/** Next zoom step for +/- buttons (nice values). */
const STEPS = [0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > z + 1e-6) ?? 64;
  return [...STEPS].reverse().find((s) => s < z - 1e-6) ?? 0.05;
}

/** Normalise a rect dragged in any direction and clamp it to the image. */
export function normRect(r: Rect, iw: number, ih: number): Rect {
  let { x, y, width, height } = r;
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  const x0 = Math.max(0, Math.min(iw, Math.round(x)));
  const y0 = Math.max(0, Math.min(ih, Math.round(y)));
  const x1 = Math.max(0, Math.min(iw, Math.round(x + width)));
  const y1 = Math.max(0, Math.min(ih, Math.round(y + height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Keep aspect ratio when one side of a resize changes. */
export function keepAspect(w: number, h: number, changed: 'w' | 'h', value: number): { w: number; h: number } {
  if (changed === 'w') return { w: value, h: Math.max(1, Math.round((value * h) / w)) };
  return { w: Math.max(1, Math.round((value * w) / h)), h: value };
}
