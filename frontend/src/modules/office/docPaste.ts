// Pasting from web pages, Word, Google Docs or LibreOffice: the clipboard's
// HTML reduced to what a Word document can hold and the editor can save —
// paragraphs, headings, lists (as paragraphs marked data-list / data-level,
// numbered by the editor), tables, links, bold / italic / underline /
// strikethrough, super/subscript, colour, highlight and size. Scripts, styles,
// classes, images and everything else are dropped.

const HEADING = /^H[1-6]$/;
const BLOCKS = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|ADDRESS|DT|DD|FIGCAPTION|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV)$/;
const DROP = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED|SVG|MATH|CANVAS|VIDEO|AUDIO|IMG|PICTURE|BUTTON|INPUT|SELECT|TEXTAREA|META|LINK|TITLE|HEAD)$/;

interface Style {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sup?: boolean;
  sub?: boolean;
  color?: string;
  bg?: string;
  size?: string;
  href?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only what a run can carry, from tags and inline styles. */
function styleOf(e: HTMLElement, inherited: Style): Style {
  const s = { ...inherited };
  const t = e.tagName;
  if (t === 'B' || t === 'STRONG') s.b = true;
  if (t === 'I' || t === 'EM' || t === 'CITE') s.i = true;
  if (t === 'U' || t === 'INS') s.u = true;
  if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.s = true;
  if (t === 'SUP') s.sup = true;
  if (t === 'SUB') s.sub = true;
  if (t === 'A') {
    const href = e.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) s.href = href;
  }
  if (t === 'FONT' && e.getAttribute('color')) s.color = e.getAttribute('color')!;
  const st = e.style;
  const fw = st.fontWeight;
  if (fw) s.b = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
  if (st.fontStyle) s.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
  const deco = st.textDecorationLine || st.textDecoration;
  if (deco) {
    if (deco.includes('underline')) s.u = true;
    if (deco.includes('line-through')) s.s = true;
    if (deco === 'none') s.u = s.s = false;
  }
  if (st.verticalAlign === 'super') s.sup = true;
  if (st.verticalAlign === 'sub') s.sub = true;
  if (st.color && !/^(inherit|initial|currentcolor|windowtext|black|#000000|#000|rgb\(0, 0, 0\))$/i.test(st.color)) s.color = st.color;
  const bg = st.backgroundColor;
  if (bg && !/^(transparent|inherit|initial|rgba\(0, 0, 0, 0\)|white|#fff|#ffffff|rgb\(255, 255, 255\))$/i.test(bg)) s.bg = bg;
  if (/^[\d.]+(pt|px)$/.test(st.fontSize)) s.size = st.fontSize;
  return s;
}

function wrap(text: string, s: Style): string {
  let h = esc(text);
  const css = [s.color && `color:${s.color}`, s.bg && `background-color:${s.bg}`, s.size && `font-size:${s.size}`].filter(Boolean).join(';');
  if (css) h = `<span style="${esc(css)}">${h}</span>`;
  if (s.sup) h = `<sup>${h}</sup>`;
  else if (s.sub) h = `<sub>${h}</sub>`;
  if (s.s) h = `<s>${h}</s>`;
  if (s.u) h = `<u>${h}</u>`;
  if (s.i) h = `<i>${h}</i>`;
  if (s.b) h = `<b>${h}</b>`;
  if (s.href) h = `<a data-new-href="${esc(s.href)}" title="${esc(s.href)}">${h}</a>`;
  return h;
}

/** Clean HTML for insertHTML; null when there is nothing worth keeping beyond plain text. */
export function cleanPaste(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  let line = '';
  let kind: { tag: string; list?: string; level?: number } = { tag: 'p' };
  let rich = false;
  const flush = () => {
    if (!line.trim()) {
      line = '';
      return;
    }
    const attrs = kind.list ? ` data-list="${kind.list}" data-level="${kind.level ?? 0}"` : '';
    out.push(`<${kind.tag}${attrs}>${line || '<br>'}</${kind.tag}>`);
    line = '';
  };
  const lists: string[] = [];
  const walk = (n: Node, s: Style) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (!text.trim() && !line) return;
      line += wrap(text, s);
      if (s.b || s.i || s.u || s.s || s.sup || s.sub || s.color || s.bg || s.size || s.href) rich = true;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    const t = e.tagName;
    if (DROP.test(t) || e.hidden || e.style.display === 'none') return;
    if (t === 'BR') {
      line += '<br>';
      return;
    }
    if (t === 'UL' || t === 'OL') {
      flush();
      lists.push(t === 'OL' ? 'number' : 'bullet');
      rich = true;
      for (const c of Array.from(e.childNodes)) walk(c, s);
      lists.pop();
      flush();
      return;
    }
    if (t === 'TABLE') {
      flush();
      rich = true;
      const rows = Array.from((e as HTMLTableElement).rows);
      const body = rows
        .map((r) => `<tr>${Array.from(r.cells).map((c) => `<td>${cleanPaste(c.innerHTML) ?? `<p>${esc(c.textContent?.trim() ?? '') || '<br>'}</p>`}</td>`).join('')}</tr>`)
        .join('');
      if (body) out.push(`<table>${body}</table>`);
      return;
    }
    const block = BLOCKS.test(t) || HEADING.test(t);
    if (block) {
      flush();
      kind = HEADING.test(t) ? { tag: t.toLowerCase() } : t === 'LI' && lists.length ? { tag: 'p', list: lists[lists.length - 1], level: lists.length - 1 } : { tag: 'p' };
      if (HEADING.test(t)) rich = true;
    }
    const st = styleOf(e, s);
    for (const c of Array.from(e.childNodes)) walk(c, st);
    if (block) {
      flush();
      kind = { tag: 'p' };
    }
  };
  // Google Docs wraps everything in <b style="font-weight:normal">.
  for (const c of Array.from(doc.body.childNodes)) walk(c, {});
  flush();
  return rich && out.length ? out.join('') : null;
}
