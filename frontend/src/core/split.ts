// Split view: up to four tabs side by side. Pure layout rules (unit-tested);
// the workspace holds the state and the tab views position themselves with
// paneRect().

export type SplitLayout = 'columns' | 'rows' | 'grid';

export interface Split {
  layout: SplitLayout;
  panes: string[]; // tab ids, 2..4
  x: number; // vertical divider position (0..1)
  y: number; // horizontal divider position
}

export interface Rect {
  left: number; // fractions of the view area
  top: number;
  width: number;
  height: number;
}

export const MAX_PANES = 4;

/** Where pane i goes. Columns/rows share space evenly beyond two panes; grid uses both dividers. */
export function paneRect(s: Split, i: number): Rect {
  const n = s.panes.length;
  const { x, y } = s;
  if (s.layout === 'columns') {
    if (n === 2) return i === 0 ? { left: 0, top: 0, width: x, height: 1 } : { left: x, top: 0, width: 1 - x, height: 1 };
    return { left: i / n, top: 0, width: 1 / n, height: 1 };
  }
  if (s.layout === 'rows') {
    if (n === 2) return i === 0 ? { left: 0, top: 0, width: 1, height: y } : { left: 0, top: y, width: 1, height: 1 - y };
    return { left: 0, top: i / n, width: 1, height: 1 / n };
  }
  // grid: 2 → columns, 3 → left full height + right stacked, 4 → quadrants
  if (n === 2) return paneRect({ ...s, layout: 'columns' }, i);
  if (n === 3) {
    if (i === 0) return { left: 0, top: 0, width: x, height: 1 };
    return { left: x, top: i === 1 ? 0 : y, width: 1 - x, height: i === 1 ? y : 1 - y };
  }
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { left: col ? x : 0, top: row ? y : 0, width: col ? 1 - x : x, height: row ? 1 - y : y };
}

/** Which dividers can be dragged in this layout. */
export function dividers(s: Split): { x: boolean; y: boolean } {
  const n = s.panes.length;
  if (s.layout === 'columns') return { x: n === 2, y: false };
  if (s.layout === 'rows') return { x: false, y: n === 2 };
  return { x: true, y: n >= 3 };
}

export type Edge = 'left' | 'right' | 'top' | 'bottom' | 'center';

/**
 * Drop tab `id` on an edge of pane `target` (or of the whole view when not
 * split, target = the shown tab). Returns the new split, or null for "no split".
 */
export function dropInto(s: Split | null, id: string, target: string, edge: Edge): Split | null {
  if (!s) {
    if (edge === 'center' || id === target) return null;
    const layout: SplitLayout = edge === 'left' || edge === 'right' ? 'columns' : 'rows';
    const panes = edge === 'left' || edge === 'top' ? [id, target] : [target, id];
    return { layout, panes, x: 0.5, y: 0.5 };
  }
  const panes = s.panes.filter((p) => p !== id);
  const at = Math.max(0, panes.indexOf(target));
  if (edge === 'center') {
    // Replace the target pane's tab.
    if (!panes.includes(target)) return s;
    panes[at] = id;
    return { ...s, panes };
  }
  if (panes.length >= MAX_PANES) {
    panes[at] = id;
    return { ...s, panes };
  }
  const after = edge === 'right' || edge === 'bottom';
  panes.splice(after ? at + 1 : at, 0, id);
  const layout: SplitLayout = panes.length > 2 ? 'grid' : edge === 'left' || edge === 'right' ? 'columns' : 'rows';
  return { ...s, layout, panes };
}

/** Remove a tab from the split; fewer than two panes means no split. */
export function without(s: Split | null, id: string): Split | null {
  if (!s || !s.panes.includes(id)) return s;
  const panes = s.panes.filter((p) => p !== id);
  return panes.length >= 2 ? { ...s, panes, layout: panes.length === 2 && s.layout === 'grid' ? 'columns' : s.layout } : null;
}

/** Start or change a split from the focused tab, taking further tabs from `others` in order. */
export function makeSplit(layout: SplitLayout, count: number, focused: string, current: Split | null, others: string[]): Split | null {
  const panes = current ? [...current.panes] : [focused];
  for (const id of others) {
    if (panes.length >= count) break;
    if (!panes.includes(id)) panes.push(id);
  }
  panes.length = Math.min(panes.length, count);
  if (panes.length < 2) return null;
  return { layout, panes, x: current?.x ?? 0.5, y: current?.y ?? 0.5 };
}
