// A tab being dragged from the tab bar (pointer events, not HTML drag and
// drop, so the drag keeps going outside the window and works the same in
// every webview). The tab bar drives it; the split view's drop zones read it.

export type TabDropZone = 'strip' | 'views' | 'outside';

class TabDrag {
  /** The tab being dragged, or null. */
  id = $state<string | null>(null);
  x = $state(0);
  y = $state(0);
  zone = $state<TabDropZone>('strip');
  /** Set by the split overlay: drop the tab on the view under (x, y); false if there is none. */
  dropOnViews: ((id: string, x: number, y: number) => boolean) | null = null;
}

export const tabDrag = new TabDrag();

/** Where a point is: over the tab bar (with some slack), over the views, or outside the window. */
export function zoneOf(x: number, y: number, bar: DOMRect, w: number, h: number): TabDropZone {
  if (x < 0 || y < 0 || x > w || y > h) return 'outside';
  return y <= bar.bottom + 16 ? 'strip' : 'views';
}

/** Where the dragged tab (at `from`) goes: after every other tab whose middle is left of the pointer. */
export function insertionIndex(x: number, boxes: { left: number; width: number }[], from: number): number {
  let k = 0;
  boxes.forEach((b, i) => {
    if (i !== from && x > b.left + b.width / 2) k++;
  });
  return k;
}
