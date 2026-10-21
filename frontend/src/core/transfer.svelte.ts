// Moving things between editors: an image, some text or files, copied with
// Ctrl+C / pasted with Ctrl+V or dragged from one view onto another. A tab
// says what it can take (handlers.accept) and what it would give
// (handlers.give); the app clipboard and the drag below connect the two.
import type { Tab } from './tabs.svelte';
import { workspace } from './tabs.svelte';
import { ui } from './ui.svelte';

export type Transfer =
  | { kind: 'image'; image: HTMLCanvasElement; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'files'; paths: string[] };

export type TransferKind = Transfer['kind'];

export interface Accepts {
  kinds: TransferKind[];
  /** Take it (at a window point when dropped); false if it couldn't. */
  take: (t: Transfer, at?: { x: number; y: number }) => boolean | Promise<boolean>;
}

export const describe = (t: Transfer) => (t.kind === 'image' ? t.name || 'image' : t.kind === 'text' ? 'text' : t.paths.length === 1 ? t.paths[0].split(/[\\/]/).pop()! : `${t.paths.length} files`);

// ---- app clipboard ----

let last: { t: Transfer; at: number } | null = null;

async function pngOf(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/** Copy to the system clipboard (PNG or text) and remember it here, with what the system can't hold (names, paths). */
export async function copyTransfer(t: Transfer): Promise<void> {
  last = { t, at: Date.now() };
  try {
    if (t.kind === 'image') await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(t.image) })]);
    else await navigator.clipboard.writeText(t.kind === 'text' ? t.text : t.paths.join('\n'));
  } catch {
    /* the app's own copy still works */
  }
}

async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/** What Ctrl+V would paste: the system clipboard (newest, from any app), else our own copy. */
export async function readTransfer(): Promise<Transfer | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((x) => x.startsWith('image/'));
      if (!type) continue;
      const image = await decode(await it.getType(type));
      // Our own copy of the same picture keeps its name.
      if (last?.t.kind === 'image' && last.t.image.width === image.width && last.t.image.height === image.height) return { ...last.t, image };
      return { kind: 'image', image, name: 'Pasted image' };
    }
    for (const it of items) {
      if (!it.types.includes('text/plain')) continue;
      const text = await (await it.getType('text/plain')).text();
      if (last?.t.kind === 'files' && text === last.t.paths.join('\n')) return last.t;
      if (text) return { kind: 'text', text };
    }
  } catch {
    /* no access to the system clipboard here */
  }
  return last?.t ?? null;
}

/** Paste into a tab (the active one by default). */
export async function pasteInto(tab: Tab | null = workspace.active): Promise<boolean> {
  const acc = tab?.handlers.accept;
  if (!tab || !acc) return false;
  const t = await readTransfer();
  if (!t) {
    ui.toast('The clipboard is empty.', 'info');
    return false;
  }
  return give(tab, t);
}

/** Hand t to a tab, saying so when it can't take that kind of thing. */
export async function give(tab: Tab, t: Transfer, at?: { x: number; y: number }): Promise<boolean> {
  const acc = tab.handlers.accept;
  if (!acc || !acc.kinds.includes(t.kind)) {
    ui.toast(`${tab.title} can’t take ${t.kind === 'image' ? 'an image' : t.kind === 'text' ? 'text' : 'files'}.`, 'info');
    return false;
  }
  return Promise.resolve(acc.take(t, at)).catch((e) => {
    ui.toast(String(e?.message ?? e), 'error');
    return false;
  });
}

// ---- dragging between views ----

/** The tab whose view is under a window point. */
export function tabAt(x: number, y: number): Tab | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tabview[data-tab-id]');
  const id = el?.dataset.tabId;
  return id ? workspace.tabs.find((t) => t.id === id) : undefined;
}

class TransferDrag {
  /** What is being dragged (with the source tab), or null. */
  item = $state<{ t: Transfer; from: string } | null>(null);
  x = $state(0);
  y = $state(0);
  /** The tab under the pointer and whether it takes this. */
  over = $state<{ id: string; ok: boolean } | null>(null);

  /** Start dragging t from a pointerdown (on a grip, a frame…); it follows the pointer until release. */
  start(e: PointerEvent, from: Tab, get: () => Transfer | null | Promise<Transfer | null>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as Element;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    const move = async (m: PointerEvent) => {
      if (!started) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
        started = true;
        try {
          el.setPointerCapture(m.pointerId);
        } catch {
          /* synthetic events */
        }
        const t = await get();
        if (!t) return stop();
        this.item = { t, from: from.id };
      }
      this.x = m.clientX;
      this.y = m.clientY;
      const tab = tabAt(m.clientX, m.clientY);
      this.over = tab && tab.id !== from.id ? { id: tab.id, ok: !!tab.handlers.accept?.kinds.includes(this.item?.t.kind ?? 'text') } : null;
    };
    const up = (u: PointerEvent) => {
      const item = this.item;
      stop();
      if (!item) return;
      const tab = tabAt(u.clientX, u.clientY);
      if (tab && tab.id !== item.from) void give(tab, item.t, { x: u.clientX, y: u.clientY }).then((ok) => ok && workspace.activate(tab));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      this.item = null;
      this.over = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  }
}

export const transferDrag = new TransferDrag();
