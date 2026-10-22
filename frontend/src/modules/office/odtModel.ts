// OpenDocument text (content.xml) <-> editable HTML, the counterpart of
// docxModel for .odt files.
//
// render(): builds HTML from office:text. Every block keeps a pointer to its
// original XML element (data-p / data-tbl / data-opaque, list paragraphs also
// data-lp: the path of text:list / text:list-item elements around them) and
// every text span a pointer to its text:span (data-r), so serialize() rebuilds
// content.xml reusing the original elements and styles. Fields, notes, frames,
// bookmarks and anything else the editor can't edit are inline atoms written
// back unchanged; sections, indexes and other unknown blocks are kept as
// read-only blocks. Changing bold/italic/underline/strike adds automatic text
// styles derived from the run's own.
import { collect, hasOwnText, sameFmt, type Fmt } from './docxModel';
import { t } from '../../core/i18n';

export const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
export const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const SVG = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface OdtContext {
  styles: Record<string, string>; // paragraph style name -> display name (lower-case)
  textStyles: Record<string, string>; // named text style -> "b i u s" flags
  /** URL for a package part (pictures). */
  partUrl: (entry: string) => string;
}

/** Body-level declarations: not shown, kept at the start. */
const PRELUDE = new Set(['sequence-decls', 'variable-decls', 'user-field-decls', 'dde-connection-decls', 'tracked-changes', 'forms', 'calculation-settings', 'alphabetical-index-auto-mark-file']);
/** Inline elements that are only markers (no visible content). */
const MARKERS = new Set(['bookmark', 'bookmark-start', 'bookmark-end', 'reference-mark', 'reference-mark-start', 'reference-mark-end', 'toc-mark', 'toc-mark-start', 'toc-mark-end', 'alphabetical-index-mark', 'alphabetical-index-mark-start', 'alphabetical-index-mark-end', 'user-index-mark', 'user-index-mark-start', 'user-index-mark-end', 'change', 'change-start', 'change-end', 'soft-page-break']);

const NO_FMT: Fmt = { b: false, i: false, u: false, s: false };

interface StyleInfo {
  el: Element;
  parent: string;
}

export class OdtModel {
  readonly xml: XMLDocument;
  readonly body: Element;
  private auto: Element;
  private nodes: Element[] = [];
  private atoms: Element[] = [];
  private runFmt = new Map<string, Fmt>(); // data-r -> the run's own formatting
  private autoStyles = new Map<string, StyleInfo>();
  private listStyles = new Map<string, Element>();
  private madeStyles = new Map<string, string>();
  private headingStyle = new Map<number, string>();
  private bodyStyle = 'Standard';

  constructor(
    contentXml: string,
    private ctx: OdtContext,
  ) {
    this.xml = new DOMParser().parseFromString(contentXml, 'application/xml');
    if (this.xml.getElementsByTagName('parsererror')[0]) throw new Error(t('{part} could not be parsed', { part: 'content.xml' }));
    const body = this.xml.getElementsByTagNameNS(OFFICE, 'text')[0];
    if (!body) throw new Error(t('This file has no text body.'));
    this.body = body;
    let auto = this.xml.getElementsByTagNameNS(OFFICE, 'automatic-styles')[0];
    if (!auto) {
      auto = this.xml.createElementNS(OFFICE, 'office:automatic-styles');
      const root = this.xml.documentElement;
      root.insertBefore(auto, this.xml.getElementsByTagNameNS(OFFICE, 'body')[0] ?? null);
    }
    this.auto = auto;
    for (const s of Array.from(auto.children)) {
      const name = s.getAttributeNS(STYLE, 'name');
      if (!name) continue;
      if (s.localName === 'style') this.autoStyles.set(name, { el: s, parent: s.getAttributeNS(STYLE, 'parent-style-name') ?? '' });
      else if (s.localName === 'list-style') this.listStyles.set(name, s);
    }
    for (const [name, display] of Object.entries(ctx.styles)) {
      const m = /^heading (\d)$/.exec(display);
      if (m && !this.headingStyle.has(Number(m[1]))) this.headingStyle.set(Number(m[1]), name);
      if (display === 'text body' || display === 'body text') this.bodyStyle = name;
    }
  }

  private ref(el: Element): string {
    this.nodes.push(el);
    return String(this.nodes.length - 1);
  }

  private node(id: string | undefined): Element | undefined {
    return id === undefined ? undefined : this.nodes[Number(id)];
  }

  /** Display name of a paragraph's style, following automatic styles to their parent. */
  paragraphStyle(p: Element): string {
    let name = p.getAttributeNS(TEXT, 'style-name') ?? '';
    for (let i = 0; i < 8 && this.autoStyles.has(name); i++) name = this.autoStyles.get(name)!.parent;
    return this.ctx.styles[name] ?? name.toLowerCase();
  }

  /** Formatting of a text style (automatic or named). */
  private styleFmt(name: string | null): Fmt {
    if (!name) return NO_FMT;
    const auto = this.autoStyles.get(name);
    if (!auto) {
      const f = this.ctx.textStyles[name] ?? '';
      return { b: /\bb\b/.test(f), i: /\bi\b/.test(f), u: /\bu\b/.test(f), s: /\bs\b/.test(f) };
    }
    const base = auto.parent ? this.styleFmt(auto.parent) : NO_FMT;
    const tp = childNS(auto.el, STYLE, 'text-properties');
    if (!tp) return base;
    const w = tp.getAttributeNS(FO, 'font-weight');
    const st = tp.getAttributeNS(FO, 'font-style');
    const u = tp.getAttributeNS(STYLE, 'text-underline-style');
    const s = tp.getAttributeNS(STYLE, 'text-line-through-style');
    return {
      b: w ? w === 'bold' || Number(w) >= 600 : base.b,
      i: st ? st === 'italic' || st === 'oblique' : base.i,
      u: u ? u !== 'none' : base.u,
      s: s ? s !== 'none' : base.s,
    };
  }

  private textProps(name: string | null): Element | null {
    const auto = name ? this.autoStyles.get(name) : undefined;
    return auto ? childNS(auto.el, STYLE, 'text-properties') : null;
  }

  // ---------- render ----------

  render(doc: Document): DocumentFragment {
    const frag = doc.createDocumentFragment();
    for (const child of Array.from(this.body.children)) {
      if (child.namespaceURI === TEXT && child.localName === 'list') this.renderList(doc, frag, child, [], 1, child.getAttributeNS(TEXT, 'style-name') ?? '');
      else {
        const el = this.renderBlock(doc, child);
        if (el) frag.append(el);
      }
    }
    if (!frag.childNodes.length) {
      const p = doc.createElement('p');
      p.append(doc.createElement('br'));
      frag.append(p);
    }
    return frag;
  }

  private isPrelude(el: Element) {
    return PRELUDE.has(el.localName) || (el.namespaceURI === TEXT && el.localName === 'soft-page-break');
  }

  private renderBlock(doc: Document, el: Element): HTMLElement | null {
    if (this.isPrelude(el)) return null;
    if (el.namespaceURI === TEXT && (el.localName === 'p' || el.localName === 'h')) return this.renderParagraph(doc, el);
    if (el.namespaceURI === TABLE && el.localName === 'table') return this.renderTable(doc, el);
    return this.opaque(doc, el);
  }

  private opaque(doc: Document, el: Element): HTMLElement {
    const d = doc.createElement('div');
    d.className = 'opaque';
    d.contentEditable = 'false';
    d.dataset.opaque = this.ref(el);
    d.textContent = el.textContent?.trim() || `[${el.localName}]`;
    d.title = t('This part is kept as it is');
    return d;
  }

  private renderList(doc: Document, out: DocumentFragment | HTMLElement, list: Element, path: string[], depth: number, styleName: string) {
    const style = list.getAttributeNS(TEXT, 'style-name') || styleName;
    const lp = [...path, this.ref(list)];
    const level = this.listStyles.get(style)?.children[Math.min(depth, 10) - 1];
    const numbered = level?.localName === 'list-level-style-number';
    let n = Number(list.getAttributeNS(TEXT, 'start-value') ?? '') || 1;
    for (const item of Array.from(list.children)) {
      if (item.namespaceURI !== TEXT || (item.localName !== 'list-item' && item.localName !== 'list-header')) continue;
      const ip = [...lp, this.ref(item)];
      const start = Number(item.getAttributeNS(TEXT, 'start-value') ?? '');
      if (start) n = start;
      let pi = 0;
      for (const c of Array.from(item.children)) {
        if (c.namespaceURI === TEXT && c.localName === 'list') {
          this.renderList(doc, out, c, ip, depth + 1, style);
          continue;
        }
        const el = this.renderBlock(doc, c);
        if (!el) continue;
        if (el.dataset.p !== undefined) {
          el.dataset.lp = ip.join(',');
          el.dataset.pi = String(pi);
          el.classList.add('li');
          if (item.localName === 'list-header' || pi > 0) el.classList.add('cont');
          else if (numbered) {
            el.classList.add('num');
            el.dataset.n = `${n}${level?.getAttributeNS(STYLE, 'num-suffix') ?? '.'}`;
          }
          el.style.marginLeft = `${(depth - 1) * 24}px`;
        }
        pi++;
        out.append(el);
      }
      if (item.localName === 'list-item') n++;
    }
  }

  private renderParagraph(doc: Document, p: Element): HTMLElement {
    const style = this.paragraphStyle(p);
    let level = 0;
    if (p.localName === 'h') level = Math.min(6, Math.max(1, Number(p.getAttributeNS(TEXT, 'outline-level')) || 1));
    else if (style === 'title') level = 1;
    const el = doc.createElement(level ? `h${level}` : 'p');
    el.dataset.p = this.ref(p);
    if (style === 'title') el.classList.add('title');
    const pp = childNS(this.autoStyles.get(p.getAttributeNS(TEXT, 'style-name') ?? '')?.el, STYLE, 'paragraph-properties');
    if (pp) applyParagraphProps(el, pp);
    const state = { space: true };
    this.renderInline(doc, el, p, undefined, NO_FMT, state);
    if (!el.textContent && !el.querySelector('img,.atom')) el.append(doc.createElement('br'));
    return el;
  }

  /** Render the children of a paragraph, span or link into parent. */
  private renderInline(doc: Document, parent: HTMLElement, xmlParent: Element, run: string | undefined, fmt: Fmt, state: { space: boolean }, wrapper?: Element) {
    for (const n of Array.from(xmlParent.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        let text = '';
        for (const ch of n.textContent ?? '') {
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            if (!state.space) text += ' ';
            state.space = true;
          } else {
            text += ch;
            state.space = false;
          }
        }
        if (text) parent.append(this.textSpan(doc, text, run, fmt));
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const c = n as Element;
      if (c.namespaceURI === TEXT) {
        switch (c.localName) {
          case 's': {
            const count = Math.min(1000, Number(c.getAttributeNS(TEXT, 'c')) || 1);
            parent.append(this.textSpan(doc, ' '.repeat(count), run, fmt));
            state.space = false;
            continue;
          }
          case 'span': {
            const r = this.ref(c);
            const f = this.styleFmt(c.getAttributeNS(TEXT, 'style-name'));
            const own = { b: f.b || fmt.b, i: f.i || fmt.i, u: f.u || fmt.u, s: f.s || fmt.s };
            this.runFmt.set(r, own);
            this.renderInline(doc, parent, c, r, own, state, c);
            continue;
          }
          case 'a': {
            const a = doc.createElement('a');
            a.dataset.hl = this.ref(c);
            const href = c.getAttributeNS(XLINK, 'href');
            if (href) a.title = href;
            this.renderInline(doc, a, c, run, fmt, state, wrapper);
            parent.append(a);
            continue;
          }
          case 'line-break': {
            const br = doc.createElement('br');
            br.dataset.r = run ?? 'p';
            parent.append(br);
            state.space = false;
            continue;
          }
          case 'tab': {
            const t = this.atom(doc, c, wrapper, '\t');
            t.classList.add('tab');
            parent.append(t);
            state.space = false;
            continue;
          }
        }
        if (MARKERS.has(c.localName)) {
          const m = this.atom(doc, c, null, '');
          m.classList.add('mark');
          parent.append(m);
          continue;
        }
      }
      parent.append(this.atom(doc, c, wrapper));
      state.space = false;
    }
  }

  private textSpan(doc: Document, text: string, run: string | undefined, fmt: Fmt): HTMLElement {
    const s = doc.createElement('span');
    if (run !== undefined) {
      s.dataset.r = run;
      const tp = this.textProps(this.node(run)?.getAttributeNS(TEXT, 'style-name') ?? null);
      if (tp) applyTextProps(s, tp);
    }
    s.textContent = text;
    let out: HTMLElement = s;
    const wrap = (tag: string) => {
      const w = doc.createElement(tag);
      w.append(out);
      out = w;
    };
    if (fmt.b) wrap('b');
    if (fmt.i) wrap('i');
    if (fmt.u) wrap('u');
    if (fmt.s) wrap('s');
    return out;
  }

  /** An uneditable inline element standing for one XML element (kept inside its span's style). */
  private atom(doc: Document, c: Element, wrapper: Element | null | undefined, label?: string): HTMLElement {
    let stored = c.cloneNode(true) as Element;
    if (wrapper) {
      const w = wrapper.cloneNode(false) as Element;
      w.removeAttributeNS(XML_NS, 'id');
      w.append(stored);
      stored = w;
    }
    this.atoms.push(stored);
    const s = doc.createElement('span');
    s.className = 'atom';
    s.contentEditable = 'false';
    s.dataset.atom = String(this.atoms.length - 1);
    if (label !== undefined) {
      s.textContent = label;
      return s;
    }
    if (c.namespaceURI === DRAW && c.localName === 'frame') {
      const img = Array.from(c.getElementsByTagNameNS(DRAW, 'image')).find((i) => i.getAttributeNS(XLINK, 'href'));
      const href = img?.getAttributeNS(XLINK, 'href') ?? '';
      if (href && !/^[a-z]+:/i.test(href)) {
        const im = doc.createElement('img');
        im.src = this.ctx.partUrl(href.replace(/^\.\//, ''));
        im.alt = '';
        const w = lengthPx(c.getAttributeNS(SVG, 'width'));
        if (w) {
          im.style.width = `${w}px`;
          im.style.maxWidth = '100%';
        }
        s.append(im);
        return s;
      }
    }
    s.classList.add('chip');
    if (c.namespaceURI === TEXT && c.localName === 'note') {
      s.textContent = childNS(c, TEXT, 'note-citation')?.textContent || '*';
      s.classList.add('note');
      s.title = childNS(c, TEXT, 'note-body')?.textContent?.trim() ?? '';
    } else if (c.namespaceURI === OFFICE && c.localName === 'annotation') {
      s.textContent = '💬';
      s.title = Array.from(c.getElementsByTagNameNS(TEXT, 'p'))
        .map((p) => p.textContent)
        .join('\n');
    } else {
      s.textContent = c.textContent?.trim() || `[${c.localName}]`;
      s.classList.add('field');
    }
    return s;
  }

  private renderTable(doc: Document, tbl: Element): HTMLElement {
    const t = doc.createElement('table');
    t.dataset.tbl = this.ref(tbl);
    for (const tr of tableRows(tbl)) {
      const row = doc.createElement('tr');
      for (const tc of rowCells(tr)) {
        const cell = doc.createElement('td');
        const span = Number(tc.getAttributeNS(TABLE, 'number-columns-spanned'));
        if (span > 1) cell.colSpan = span;
        for (const b of Array.from(tc.children)) {
          const e = this.renderBlock(doc, b);
          if (e) cell.append(e);
        }
        row.append(cell);
      }
      t.append(row);
    }
    return t;
  }

  // ---------- serialize ----------

  /** Rebuild content.xml from the edited HTML. */
  serialize(root: HTMLElement): string {
    const prelude = Array.from(this.body.children).filter((c) => this.isPrelude(c) && !(c.namespaceURI === TEXT && c.localName === 'soft-page-break'));
    const used = new Set<string>();
    const out: Element[] = [];
    const lists = new ListBuilder(this, out);
    const blocks = flatten(Array.from(root.children) as HTMLElement[]);
    for (const el of blocks) {
      if (el.dataset.lp && el.dataset.p !== undefined) {
        lists.add(el, this.serializeParagraph(el, used));
        continue;
      }
      lists.flush();
      out.push(...this.serializeBlock(el, used));
    }
    lists.flush();
    while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
    for (const n of [...prelude, ...out]) this.body.append(n);
    let s = new XMLSerializer().serializeToString(this.xml);
    if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
    return s;
  }

  /** @internal for ListBuilder */
  original(id: string) {
    return this.node(id);
  }

  private serializeBlock(el: HTMLElement, used: Set<string>): Element[] {
    if (el.dataset.opaque) {
      const orig = this.node(el.dataset.opaque);
      return orig ? [orig.cloneNode(true) as Element] : [];
    }
    if (el.tagName === 'TABLE') return [this.serializeTable(el as HTMLTableElement, used)];
    return [this.serializeParagraph(el, used)];
  }

  private serializeTable(t: HTMLTableElement, used: Set<string>): Element {
    const orig = this.node(t.dataset.tbl);
    const tbl = orig!.cloneNode(true) as Element;
    const xmlRows = tableRows(tbl);
    Array.from(t.rows).forEach((hr, ri) => {
      const xr = xmlRows[ri];
      if (!xr) return;
      const xmlCells = rowCells(xr);
      Array.from(hr.cells).forEach((hc, ci) => {
        const xc = xmlCells[ci];
        if (!xc) return;
        for (const n of Array.from(xc.children)) if (n.namespaceURI === TEXT && /^(p|h|list)$/.test(n.localName)) xc.removeChild(n);
        const blocks = flatten(Array.from(hc.children) as HTMLElement[]).flatMap((k) => (k.dataset.lp ? [this.serializeParagraph(k, used)] : this.serializeBlock(k, used)));
        if (!blocks.some((b) => b.namespaceURI === TEXT && (b.localName === 'p' || b.localName === 'h'))) blocks.push(this.xml.createElementNS(TEXT, 'text:p'));
        for (const b of blocks) xc.append(b);
      });
    });
    return tbl;
  }

  private serializeParagraph(el: HTMLElement, used: Set<string>): Element {
    const xml = this.xml;
    const orig = this.node(el.dataset.p);
    const wantLevel = Number(/^H([1-6])$/.exec(el.tagName)?.[1] ?? 0);
    const isTitle = orig ? this.paragraphStyle(orig) === 'title' : false;
    const origLevel = orig?.localName === 'h' ? Math.min(6, Math.max(1, Number(orig.getAttributeNS(TEXT, 'outline-level')) || 1)) : isTitle ? 1 : 0;
    let p: Element;
    if (orig && wantLevel === origLevel) {
      p = orig.cloneNode(false) as Element;
    } else if (wantLevel) {
      p = xml.createElementNS(TEXT, 'text:h');
      p.setAttributeNS(TEXT, 'text:style-name', this.headingStyle.get(wantLevel) ?? `Heading_20_${wantLevel}`);
      p.setAttributeNS(TEXT, 'text:outline-level', String(wantLevel));
    } else {
      p = xml.createElementNS(TEXT, 'text:p');
      const keep = orig?.localName === 'p' && !isTitle ? orig.getAttributeNS(TEXT, 'style-name') : null;
      p.setAttributeNS(TEXT, 'text:style-name', keep ?? this.bodyStyle);
    }
    // A paragraph split with Enter: only the first copy keeps the id.
    if (el.dataset.p !== undefined) {
      if (used.has(el.dataset.p)) p.removeAttributeNS(XML_NS, 'id');
      used.add(el.dataset.p);
    }

    const segments = collect(el);
    const prev = { ch: '' }; // last character written, '' at the start or after an element
    let currentLink: string | undefined;
    let linkEl: Element | null = null;
    const append = (n: Node, link: string | undefined) => {
      if (link !== currentLink) {
        currentLink = link;
        linkEl = null;
        if (link !== undefined) {
          const o = this.node(link);
          linkEl = o ? (o.cloneNode(false) as Element) : null;
          if (linkEl) p.append(linkEl);
        }
      }
      (linkEl ?? p).append(n);
    };
    let i = 0;
    while (i < segments.length) {
      const s = segments[i];
      if (s.kind === 'atom') {
        const a = this.atoms[Number(s.atom)];
        if (a) append(a.cloneNode(true), s.link);
        prev.ch = '';
        i++;
        continue;
      }
      if (s.kind === 'br') {
        append(xml.createElementNS(TEXT, 'text:line-break'), s.link);
        prev.ch = '';
        i++;
        continue;
      }
      let text = s.text;
      let j = i + 1;
      while (j < segments.length) {
        const n = segments[j];
        if (n.kind !== 'text' || n.run !== s.run || n.link !== s.link || !sameFmt(n.fmt, s.fmt)) break;
        text += n.text;
        j++;
      }
      if (text) {
        const nodes = this.encodeText(text, prev);
        const run = s.run !== undefined && s.run !== 'p' ? this.node(s.run) : undefined;
        const base = (s.run !== undefined && this.runFmt.get(s.run)) || NO_FMT;
        if (sameFmt(base, s.fmt)) {
          if (run) {
            const span = run.cloneNode(false) as Element;
            span.removeAttributeNS(XML_NS, 'id');
            span.append(...nodes);
            append(span, s.link);
          } else for (const n of nodes) append(n, s.link);
        } else {
          const span = xml.createElementNS(TEXT, 'text:span');
          span.setAttributeNS(TEXT, 'text:style-name', this.styleFor(run?.getAttributeNS(TEXT, 'style-name') ?? '', s.fmt));
          span.append(...nodes);
          append(span, s.link);
        }
      }
      i = j;
    }
    return p;
  }

  /** Text as nodes, with runs of spaces and tabs as text:s / text:tab. */
  private encodeText(text: string, prev: { ch: string }): Node[] {
    const xml = this.xml;
    const out: Node[] = [];
    let buf = '';
    let spaces = 0;
    const flushSpaces = () => {
      if (!spaces) return;
      if (prev.ch !== '' && prev.ch !== ' ') {
        buf += ' ';
        spaces--;
      }
      if (spaces) {
        if (buf) out.push(xml.createTextNode(buf));
        buf = '';
        const s = xml.createElementNS(TEXT, 'text:s');
        if (spaces > 1) s.setAttributeNS(TEXT, 'text:c', String(spaces));
        out.push(s);
      }
      spaces = 0;
      prev.ch = ' ';
    };
    for (const ch of text) {
      if (ch === ' ') {
        spaces++;
        continue;
      }
      flushSpaces();
      if (ch === '\t' || ch === '\n') {
        if (buf) out.push(xml.createTextNode(buf));
        buf = '';
        out.push(xml.createElementNS(TEXT, ch === '\t' ? 'text:tab' : 'text:line-break'));
        prev.ch = '';
        continue;
      }
      buf += ch;
      prev.ch = ch;
    }
    // Trailing spaces stay explicit (a lone one after text is fine as is).
    if (spaces) {
      if (prev.ch !== '' && prev.ch !== ' ' && spaces === 1) {
        buf += ' ';
        prev.ch = ' ';
        spaces = 0;
      } else flushSpaces();
    }
    if (buf) out.push(xml.createTextNode(buf));
    return out;
  }

  /** An automatic text style like base (a text style name or "") with the given formatting. */
  private styleFor(base: string, fmt: Fmt): string {
    const key = `${base}|${+fmt.b}${+fmt.i}${+fmt.u}${+fmt.s}`;
    const known = this.madeStyles.get(key);
    if (known) return known;
    const xml = this.xml;
    const auto = this.autoStyles.get(base);
    const st = auto ? (auto.el.cloneNode(true) as Element) : xml.createElementNS(STYLE, 'style:style');
    let n = 1;
    while (this.autoStyles.has(`T${n}`)) n++;
    const name = `T${n}`;
    st.setAttributeNS(STYLE, 'style:name', name);
    st.setAttributeNS(STYLE, 'style:family', 'text');
    if (!auto && base) st.setAttributeNS(STYLE, 'style:parent-style-name', base);
    let tp = childNS(st, STYLE, 'text-properties');
    if (!tp) {
      tp = xml.createElementNS(STYLE, 'style:text-properties');
      st.append(tp);
    }
    for (const k of ['font-weight', 'font-weight-asian', 'font-weight-complex']) {
      const ns = k === 'font-weight' ? FO : STYLE;
      tp.setAttributeNS(ns, `${ns === FO ? 'fo' : 'style'}:${k}`, fmt.b ? 'bold' : 'normal');
    }
    for (const k of ['font-style', 'font-style-asian', 'font-style-complex']) {
      const ns = k === 'font-style' ? FO : STYLE;
      tp.setAttributeNS(ns, `${ns === FO ? 'fo' : 'style'}:${k}`, fmt.i ? 'italic' : 'normal');
    }
    tp.setAttributeNS(STYLE, 'style:text-underline-style', fmt.u ? 'solid' : 'none');
    if (fmt.u) {
      tp.setAttributeNS(STYLE, 'style:text-underline-width', 'auto');
      tp.setAttributeNS(STYLE, 'style:text-underline-color', 'font-color');
    }
    tp.setAttributeNS(STYLE, 'style:text-line-through-style', fmt.s ? 'solid' : 'none');
    this.auto.append(st);
    this.autoStyles.set(name, { el: st, parent: st.getAttributeNS(STYLE, 'parent-style-name') ?? '' });
    this.madeStyles.set(key, name);
    return name;
  }
}

/** Groups list paragraphs back into text:list / text:list-item elements. */
class ListBuilder {
  private stack: { ref: string; el: Element }[] = [];
  private seenPi = new Map<string, Set<string>>();
  private cloned = new Set<string>();

  constructor(
    private model: OdtModel,
    private out: Element[],
  ) {}

  add(el: HTMLElement, p: Element) {
    const path = el.dataset.lp!.split(',');
    const item = path[path.length - 1];
    const pi = el.dataset.pi ?? '0';
    let seen = this.seenPi.get(item);
    if (!seen) this.seenPi.set(item, (seen = new Set()));
    // The same item and paragraph again: it was split with Enter, so it
    // becomes a new item of the same list.
    const fresh = seen.has(pi);
    seen.add(pi);
    let k = 0;
    while (k < this.stack.length && k < path.length && this.stack[k].ref === path[k] && !(fresh && k === path.length - 1)) k++;
    if (k === 0) this.flush();
    else this.stack.length = k;
    for (let j = k; j < path.length; j++) {
      const orig = this.model.original(path[j]);
      if (!orig) return;
      const c = orig.cloneNode(false) as Element;
      if (this.cloned.has(path[j])) {
        c.removeAttributeNS(XML_NS, 'id');
        c.removeAttributeNS(TEXT, 'start-value');
      }
      this.cloned.add(path[j]);
      if (j > 0) this.stack[j - 1].el.append(c);
      this.stack.push({ ref: path[j], el: c });
    }
    this.stack[this.stack.length - 1].el.append(p);
  }

  flush() {
    if (this.stack.length) this.out.push(this.stack[0].el);
    this.stack = [];
  }
}

/** Blocks in order, unwrapping containers the browser may have added around paragraphs. */
function flatten(els: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of els) {
    if (el.dataset.opaque || el.tagName === 'TABLE') {
      out.push(el);
      continue;
    }
    const blockKids = Array.from(el.children).filter((c) => /^(P|H[1-6]|DIV|TABLE|UL|OL|LI)$/.test(c.tagName)) as HTMLElement[];
    if ((el.tagName === 'UL' || el.tagName === 'OL') || (blockKids.length && blockKids.length === el.children.length && !hasOwnText(el))) out.push(...flatten(blockKids.length ? blockKids : (Array.from(el.children) as HTMLElement[])));
    else out.push(el);
  }
  return out;
}

function tableRows(tbl: Element): Element[] {
  const rows: Element[] = [];
  const walk = (e: Element) => {
    for (const c of Array.from(e.children)) {
      if (c.namespaceURI !== TABLE) continue;
      if (c.localName === 'table-row') rows.push(c);
      else if (/^table-(header-rows|rows|row-group)$/.test(c.localName)) walk(c);
    }
  };
  walk(tbl);
  return rows;
}

function rowCells(tr: Element): Element[] {
  return Array.from(tr.children).filter((c) => c.namespaceURI === TABLE && c.localName === 'table-cell');
}

function childNS(el: Element | null | undefined, ns: string, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name && c.namespaceURI === ns) return c;
  return null;
}

/** "0.5in", "1.2cm", "12pt" -> CSS pixels. */
export function lengthPx(v: string | null): number {
  const m = /^(-?[\d.]+)(in|cm|mm|pt|pc|px)?$/.exec(v ?? '');
  if (!m) return 0;
  const n = Number(m[1]);
  const per: Record<string, number> = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, px: 1 };
  return Math.round(n * (per[m[2] ?? 'px'] ?? 1));
}

function applyParagraphProps(el: HTMLElement, pp: Element) {
  const align = pp.getAttributeNS(FO, 'text-align');
  if (align) el.style.textAlign = align === 'start' ? 'left' : align === 'end' ? 'right' : align;
  const ml = lengthPx(pp.getAttributeNS(FO, 'margin-left'));
  if (ml) el.style.marginLeft = `${ml}px`;
  const mt = pp.getAttributeNS(FO, 'margin-top');
  const mb = pp.getAttributeNS(FO, 'margin-bottom');
  if (mt) el.style.marginTop = `${lengthPx(mt)}px`;
  if (mb) el.style.marginBottom = `${lengthPx(mb)}px`;
}

function applyTextProps(s: HTMLElement, tp: Element) {
  const color = tp.getAttributeNS(FO, 'color');
  if (color) s.style.color = color;
  const size = tp.getAttributeNS(FO, 'font-size');
  if (size && !size.endsWith('%')) s.style.fontSize = size;
  const bg = tp.getAttributeNS(FO, 'background-color');
  if (bg && bg !== 'transparent') s.style.backgroundColor = bg;
  const pos = tp.getAttributeNS(STYLE, 'text-position');
  if (pos?.startsWith('super') || /^\d/.test(pos ?? '')) s.style.verticalAlign = 'super';
  if (pos?.startsWith('sub') || pos?.startsWith('-')) s.style.verticalAlign = 'sub';
  const font = tp.getAttributeNS(STYLE, 'font-name');
  if (font) s.style.fontFamily = `"${font}", var(--doc-font)`;
}
