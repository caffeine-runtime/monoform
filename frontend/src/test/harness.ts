// Helpers for in-webview self tests (MF_TEST). Not part of the normal UI:
// this chunk only loads when the env var is set.
import { api } from '../core/backend';

export class AssertionError extends Error {}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertionError(msg);
}

export function assertEq<T>(a: T, b: T, msg: string) {
  if (a !== b) throw new AssertionError(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | Promise<T>, what: string, timeout = 10000): Promise<NonNullable<T>> {
  const start = performance.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch {
      /* retry */
    }
    if (performance.now() - start > timeout) throw new AssertionError(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

export function log(msg: string) {
  void api.Log(`selftest: ${msg}`);
}

/** Dispatch a synthetic keydown (e.g. "Ctrl+K") to the focused element. */
export function press(combo: string, target: EventTarget = document.activeElement ?? window) {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const code = /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^\d$/.test(key) ? 'Digit' + key : key;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: key.length === 1 ? key.toLowerCase() : key,
      code,
      ctrlKey: mods.has('ctrl'),
      shiftKey: mods.has('shift'),
      altKey: mods.has('alt'),
      metaKey: mods.has('meta'),
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Measure main-thread responsiveness while fn runs: returns the longest gap
 * between animation frames (ms). A gap > 50 ms means a visible freeze.
 */
export async function measureJank<T>(fn: () => Promise<T>): Promise<{ result: T; maxGap: number; frames: number }> {
  let last = performance.now();
  let maxGap = 0;
  let frames = 0;
  let running = true;
  const tick = (t: number) => {
    maxGap = Math.max(maxGap, t - last);
    last = t;
    frames++;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(tick);
  });
  const result = await fn();
  running = false;
  await sleep(50);
  return { result, maxGap, frames };
}

export async function nextFrame() {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}
