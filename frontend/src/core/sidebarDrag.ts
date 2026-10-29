// Dragging the sidebar's edge: wide → narrower → a strip of icons → hidden,
// and back out again. Thresholds are in pixels at interface scale 1; going
// from the strip back to full width takes a little further than the other
// way, so the edge doesn't flicker between the two.
export type SidebarMode = 'full' | 'compact' | 'hidden';

/** The icon strip's width. */
export const RAIL = 52;
export const FULL_MIN = 180;
export const FULL_MAX = 560;
const TO_COMPACT = 120;
const TO_FULL = 150;
const TO_HIDDEN = 24;

/** Where a drag of the edge to `x` leaves a sidebar that is `now` in `now` mode, and its full width. */
export function sidebarDrag(x: number, scale: number, now: SidebarMode): { mode: SidebarMode; width: number } {
  let mode: SidebarMode;
  if (x < TO_HIDDEN * scale) mode = 'hidden';
  else if (now === 'full') mode = x < TO_COMPACT * scale ? 'compact' : 'full';
  else mode = x >= TO_FULL * scale ? 'full' : 'compact';
  const min = FULL_MIN * scale;
  return { mode, width: Math.round(Math.min(Math.max(FULL_MAX, min), Math.max(min, x))) };
}
