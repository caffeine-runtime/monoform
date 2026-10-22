// Moving things between editors: an image, some text or files, copied with
// Ctrl+C / pasted with Ctrl+V or dragged from one view onto another. A tab
// says what it can take (handlers.accept) and what it would give
// (handlers.give); the app clipboard and the drag below connect the two.
import type { Tab } from './tabs.svelte';
import { workspace } from './tabs.svelte';
import { ui } from './ui.svelte';
import { dropHandlers } from './drop';
import { t, tn } from './i18n';

export type Transfer =
  | { kind: 'image'; image: HTMLCanvasElement; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'files'; paths: string[] };

export type TransferKind = Transfer['kind'];

export interface Accepts {
  kinds: TransferKind[];
  /** Take it (at a window point when dropped); false if it couldn't. */
  take: (t: Transfer, at?: { x: number; y: number }) => boolean | Promise<boolean>;
  /** Files dropped from the operating system go in here (true) instead of opening as tabs. */
  claimsDrop?: (paths: string[]) => boolean;
}

export const describe = (x: Transfer) => (x.kind === 'image' ? x.name || t('image') : x.kind === 'text' ? t('text') : x.paths.length === 1 ? x.paths[0].split(/[\\/]/).pop()! : tn('{n} file', '{n} files', x.paths.length));

// ---- app clipboard ----

let last: { t: Transfer; at: number } | null = null;

export async function pngOf(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(t('PNG encoding failed')))), 'image/png'));
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
      return { kind: 'image', image, name: t('Pasted image') };
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

/** An empty tab (the start page) or no tab at all: pasting there makes a new document (core/paste.ts). */
export const isEmptyTab = (tab: Tab | null | undefined) => !tab || (tab.source.kind === 'tool' && tab.source.tool === 'start');

/** Paste into a tab (the active one by default). */
export async function pasteInto(tab: Tab | null = workspace.active): Promise<boolean> {
  const acc = tab?.handlers.accept;
  if (!isEmptyTab(tab) && !acc) return false;
  const x = await readTransfer();
  if (!x) {
    ui.toast(t('The clipboard is empty.'), 'info');
    return false;
  }
  if (isEmptyTab(tab)) return (await import('./paste')).pasteAsNew(x);
  return give(tab!, x);
}

/** Hand t to a tab, saying so when it can't take that kind of thing. */
export async function give(tab: Tab, x: Transfer, at?: { x: number; y: number }): Promise<boolean> {
  if (isEmptyTab(tab)) return (await import('./paste')).pasteAsNew(x);
  const acc = tab.handlers.accept;
  if (!acc || !acc.kinds.includes(x.kind)) {
    const name = tab.title;
    const msg = x.kind === 'image' ? t('{name} can’t take an image.', { name }) : x.kind === 'text' ? t('{name} can’t take text.', { name }) : t('{name} can’t take files.', { name });
    ui.toast(msg, 'info'); // i18n-ignore: message translated above
    return false;
  }
  return Promise.resolve(acc.take(x, at)).catch((e) => {
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
  /** True right after a drag ended, so the click that follows isn't taken as one. */
  justDropped = false;

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
      this.over = tab && tab.id !== from.id ? { id: tab.id, ok: isEmptyTab(tab) || !!tab.handlers.accept?.kinds.includes(this.item?.t.kind ?? 'text') } : null;
    };
    const up = (u: PointerEvent) => {
      const item = this.item;
      stop();
      if (!started) return;
      this.justDropped = true;
      setTimeout(() => (this.justDropped = false));
      if (!item) return;
      const tab = tabAt(u.clientX, u.clientY);
      if (tab && tab.id !== item.from) void give(tab, item.t, { x: u.clientX, y: u.clientY }).then((ok) => ok && !isEmptyTab(tab) && workspace.activate(tab));
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

// Files dropped from the operating system onto a view that claims them (after
// the modules' own drop handlers; otherwise they are opened as tabs).
dropHandlers.push((x, y, paths) => {
  const tab = tabAt(x, y);
  if (!tab?.handlers.accept?.claimsDrop?.(paths)) return false;
  void give(tab, { kind: 'files', paths }, { x, y });
  return true;
});
