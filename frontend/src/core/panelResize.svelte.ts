// Editors' side panels (outline, parts, layers, properties…) are as wide as
// the user drags them, like the sidebar: a grip on the edge facing the
// content, an accent line on hover, arrow keys, double-click for the usual
// width. Each kind of panel remembers its width (settings.panelWidths, in
// pixels at interface scale 1, so it follows the scale). Dragged well past
// the narrowest width, the side panels hide (View › Side panels brings them
// back), as the sidebar does.
import { settings } from './settings.svelte';
import { t } from './i18n';

export const PANEL_MIN = 180;
export const PANEL_MAX = 640;
/** Room the content keeps beside a panel. */
const ROOM = 220;
/** How far past the narrowest width a drag hides the panels. */
const COLLAPSE = 70;

/** Where a drag to `px` (screen pixels) leaves a panel: its width at scale 1, or that it hides. */
export function panelDrag(px: number, scale: number, around: number): { width: number; collapse: boolean } {
  const w = px / scale;
  const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, around / scale - ROOM));
  return { width: Math.round(Math.min(max, Math.max(PANEL_MIN, w))), collapse: w < PANEL_MIN - COLLAPSE };
}

type Options = {
  /** Which panel this is ("markdown.notes"): its width is remembered under this name. */
  id: string;
  /** The side of the editor the panel is on; the grip is on the other edge. */
  side?: 'left' | 'right';
  /** Whether dragging it away hides the side panels (only panels View › Side panels hides). */
  collapse?: boolean;
};

export function resizablePanel(node: HTMLElement, opts: Options) {
  let o = opts;
  const grip = document.createElement('div');
  const label = () => {
    grip.className = `mf-panel-grip ${o.side ?? 'right'}`;
    grip.setAttribute('aria-label', t('Resize panel'));
    grip.title = t('Drag to resize · double-click: usual width');
  };
  label();
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.tabIndex = 0;
  node.append(grip);
  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';

  // The grip covers the panel's visible height, even where the panel scrolls.
  const place = () => {
    grip.style.top = `${node.scrollTop}px`;
    grip.style.height = `${node.clientHeight}px`;
  };
  place();
  node.addEventListener('scroll', place, { passive: true });
  const ro = new ResizeObserver(place);
  ro.observe(node);

  const scale = () => settings.value.uiScale || 1;
  const stored = () => settings.value.panelWidths?.[o.id];
  const stop = $effect.root(() => {
    $effect(() => {
      const w = stored();
      node.style.width = w ? `calc(${w}px * var(--ui-scale))` : '';
    });
  });
  function store(w: number | undefined) {
    const all = { ...(settings.value.panelWidths ?? {}) };
    if (w) all[o.id] = w;
    else delete all[o.id];
    settings.value.panelWidths = all;
  }
  /** Width changes the user didn't drag (reset, keys) glide. */
  function glide() {
    node.classList.add('mf-panel-glide');
    setTimeout(() => node.classList.remove('mf-panel-glide'), 320);
  }
  const towards = (dx: number) => ((o.side ?? 'right') === 'right' ? -dx : dx);

  let drag: { x: number; w: number; before: number | undefined; collapse: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, w: node.getBoundingClientRect().width, before: stored(), collapse: false };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event: the moves still arrive here */
    }
    node.classList.add('mf-panel-resizing');
    document.documentElement.classList.add('mf-col-resizing');
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const r = panelDrag(drag.w + towards(e.clientX - drag.x), scale(), node.parentElement?.clientWidth ?? 1e4);
    drag.collapse = r.collapse && o.collapse !== false;
    node.classList.toggle('mf-panel-collapsing', drag.collapse);
    store(r.width);
  }
  function up() {
    if (!drag) return;
    const d = drag;
    drag = null;
    node.classList.remove('mf-panel-resizing', 'mf-panel-collapsing');
    document.documentElement.classList.remove('mf-col-resizing');
    if (d.collapse) {
      store(d.before);
      settings.update((s) => (s.panelsHidden = true));
    } else settings.schedule();
  }
  function reset() {
    glide();
    store(undefined);
    settings.schedule();
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    const now = node.getBoundingClientRect().width;
    let to: number;
    if (e.key === 'ArrowLeft') to = now + towards(-step * scale());
    else if (e.key === 'ArrowRight') to = now + towards(step * scale());
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = 1e5;
    else return;
    e.preventDefault();
    glide();
    store(panelDrag(to, scale(), node.parentElement?.clientWidth ?? 1e4).width);
    settings.schedule();
  }
  grip.addEventListener('pointerdown', down);
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
  grip.addEventListener('dblclick', reset);
  grip.addEventListener('keydown', key);

  return {
    update(next: Options) {
      o = next;
      label();
    },
    destroy() {
      up();
      stop();
      ro.disconnect();
      node.removeEventListener('scroll', place);
      grip.remove();
    },
  };
}
