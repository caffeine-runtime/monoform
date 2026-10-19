// Pure helpers for thumbnail selection and drag-reordering (unit-tested).

/** New page order after moving the `moving` pages (1-based) before index `to` (0-based slot in the old order, 0..n). */
export function moveOrder(n: number, moving: number[], to: number): number[] {
  const set = new Set(moving);
  const order = Array.from({ length: n }, (_, i) => i + 1);
  const kept = order.filter((p) => !set.has(p));
  // Slot index in the kept list: count kept pages before the drop slot.
  const before = order.slice(0, to).filter((p) => !set.has(p)).length;
  const moved = order.filter((p) => set.has(p));
  return [...kept.slice(0, before), ...moved, ...kept.slice(before)];
}

export function isIdentity(order: number[]): boolean {
  return order.every((p, i) => p === i + 1);
}

/** Selection update for click / Ctrl-click / Shift-click on page `p`. */
export function clickSelect(sel: number[], anchor: number, p: number, mods: { toggle: boolean; range: boolean }): { sel: number[]; anchor: number } {
  if (mods.range && anchor) {
    const [a, b] = anchor < p ? [anchor, p] : [p, anchor];
    const range = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    return { sel: mods.toggle ? [...new Set([...sel, ...range])].sort((x, y) => x - y) : range, anchor };
  }
  if (mods.toggle) {
    const s = sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p].sort((x, y) => x - y);
    return { sel: s, anchor: p };
  }
  return { sel: [p], anchor: p };
}

/** Parse "1-3, 5, 8-" style page ranges (1-based, clamped to n). */
export function parseRanges(s: string, n: number): number[] | null {
  const out = new Set<number>();
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? Number(m[1]) : 1;
      const b = m[2] ? Number(m[2]) : n;
      if (a < 1 || b > n || a > b) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      const v = Number(part);
      if (v < 1 || v > n) return null;
      out.add(v);
    } else return null;
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}
