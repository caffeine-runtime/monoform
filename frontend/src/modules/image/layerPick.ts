// Several layers selected in the Layers panel, as in the animation editor's
// frame strip: Shift+click takes every layer from the anchor (the last layer
// clicked without Shift) to the clicked one, Ctrl+click (⌘ on a Mac) adds
// the clicked layer or takes it off again. The clicked layer becomes the
// active one (the one painted on, whose opacity and blend are shown).

export interface LayerPick {
  /** The selected layers, bottom first. */
  ids: string[];
  active: string;
  anchor: string;
}

/**
 * The selection after a Shift+click ('range') or Ctrl+click ('toggle') on
 * `id`. `order` is the stack, bottom first; `now` what is selected. Null when
 * nothing changes (the last selected layer can't be taken off).
 */
export function pickLayers(order: string[], now: LayerPick, id: string, how: 'range' | 'toggle'): LayerPick | null {
  const at = order.indexOf(id);
  if (at < 0) return null;
  if (how === 'range') {
    const from = order.indexOf(now.anchor);
    const [a, b] = from < 0 ? [at, at] : [Math.min(from, at), Math.max(from, at)];
    return { ids: order.slice(a, b + 1), active: id, anchor: from < 0 ? id : now.anchor };
  }
  const on = now.ids.includes(id);
  if (on && now.ids.length < 2) return null;
  const ids = order.filter((x) => (x === id ? !on : now.ids.includes(x)));
  // Taking off the active layer: the top one of the rest takes its place.
  const active = !on ? id : now.active === id ? ids[ids.length - 1] : now.active;
  return { ids, active, anchor: id };
}
