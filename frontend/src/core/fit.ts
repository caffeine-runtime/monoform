// Keeps a toolbar usable at any width: when its buttons don't fit, buttons
// that have an icon drop their text (the name moves to the hover tooltip);
// if even that doesn't fit, the bar wraps onto more rows instead of hiding
// buttons past the edge. Use as <div class="toolbar" use:fitBar>.
//
// Measuring is one forced layout of a small bar, coalesced to one per frame.

const TITLED = 'data-fit-title'; // holds the button's own title
const LABELLED = 'data-fit-label';

function overflows(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

/** Hover names for buttons whose text is hidden (kept with any description
 *  the button had); put back as they were when the text shows again. */
function titles(el: HTMLElement, on: boolean) {
  for (const b of el.querySelectorAll<HTMLElement>('button, .btn')) {
    if (on) {
      if (!b.querySelector('svg')) continue;
      const name = b.textContent?.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const own = b.getAttribute('title') ?? '';
      b.setAttribute(TITLED, own);
      b.title = !own ? name : own.toLowerCase().includes(name.toLowerCase()) ? own : `${name} — ${own}`;
      if (!b.hasAttribute('aria-label')) {
        b.setAttribute('aria-label', name);
        b.setAttribute(LABELLED, '');
      }
    } else if (b.hasAttribute(TITLED)) {
      const own = b.getAttribute(TITLED);
      if (own) b.title = own;
      else b.removeAttribute('title');
      b.removeAttribute(TITLED);
      if (b.hasAttribute(LABELLED)) b.removeAttribute('aria-label');
      b.removeAttribute(LABELLED);
    }
  }
}

/** Decide the bar's layout now: full, compact (icons only) or wrapped. */
export function layoutBar(el: HTMLElement) {
  el.classList.remove('compact', 'wrapped');
  titles(el, false);
  if (!overflows(el)) return;
  el.classList.add('compact');
  titles(el, true);
  if (overflows(el)) el.classList.add('wrapped');
}

export function fitBar(el: HTMLElement) {
  el.classList.add('fit');
  let frame = 0;
  let width = -1;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const run = () => {
    frame = 0;
    width = el.clientWidth;
    layoutBar(el);
  };
  // Only width changes matter: wrapping changes the height, which mustn't re-trigger.
  const ro = new ResizeObserver(() => {
    if (el.clientWidth !== width) schedule();
  });
  // Buttons that come and go (selection tools, status) change what fits; text
  // that ticks (a playing time) is checked at most a few times a second.
  let timer = 0;
  const mo = new MutationObserver(() => {
    if (!timer) timer = window.setTimeout(() => ((timer = 0), schedule()), 200);
  });
  ro.observe(el);
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  schedule();
  return {
    destroy() {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    },
  };
}

/** Below this width (px) a pane floats its side panels over the content. */
export const NARROW_PANE = 600;

export function isNarrow(width: number): boolean {
  return width > 0 && width < NARROW_PANE;
}
