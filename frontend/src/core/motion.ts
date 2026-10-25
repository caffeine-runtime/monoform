// Durations for animations driven from script (Svelte transitions, FLIP):
// 0 when motion is reduced — Settings › Reduce motion (data-motion="reduce",
// set by theme.apply) or the system's setting — as base.css does for CSS.
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function reducedMotion(root: { dataset: DOMStringMap } | undefined = globalThis.document?.documentElement, systemReduce = !!media?.matches): boolean {
  const m = root?.dataset.motion;
  return m === 'reduce' || (m !== 'full' && systemReduce);
}

/** n milliseconds, or 0 when motion is reduced. */
export function ms(n: number): number {
  return reducedMotion() ? 0 : n;
}
