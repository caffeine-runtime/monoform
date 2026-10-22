// WordprocessingML <-> editable HTML.
//
// render(): builds HTML from word/document.xml. Every block keeps a pointer
// (data-p / data-tbl / data-opaque) to its original XML element and every
// text span a pointer to its run (data-r), so serialize() can rebuild the XML
// reusing the original paragraph and run properties. Content the editor
// can't edit safely (tracked changes, fields, content controls, equations…)
// is shown read-only and written back unchanged.

import { t } from '../../core/i18n';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface DocContext {
  styles: Record<string, string>; // styleId -> lower-case name
  rels: { id: string; type: string; target: string; external: boolean }[];
  /** URL for an internal package part (images). */
  partUrl: (entry: string) => string;
}

/** Elements inside a paragraph that make it read-only. */
const OPAQUE_INLINE = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'fldSimple', 'sdt', 'customXml', 'smartTag', 'oMath', 'oMathPara', 'subDoc']);
/** Run children shown as uneditable atoms and written back as-is. */
const ATOM_RUN_CHILDREN = new Set(['drawing', 'pict', 'object', 'sym', 'footnoteReference', 'endnoteReference', 'commentReference', 'ptab', 'noBreakHyphen', 'softHyphen']);
/** Run children that make the paragraph read-only (complex fields). */
const FIELD_RUN_CHILDREN = new Set(['fldChar', 'instrText', 'delText', 'delInstrText']);

export class DocModel {
  readonly xml: XMLDocument;
  readonly body: Element;
  private nodes: Element[] = []; // id -> XML element (paragraphs, runs, tables, opaque)
  private atoms: Element[] = []; // atom id -> standalone w:r
  styleIdByName = new Map<string, string>();

  constructor(
    documentXml: string,
    private ctx: DocContext,
  ) {
    this.xml = new DOMParser().parseFromString(documentXml, 'application/xml');
    const err = this.xml.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(t('{part} could not be parsed', { part: 'document.xml' }));
    const body = this.xml.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error(t('document has no body'));
    this.body = body;
    for (const [id, name] of Object.entries(ctx.styles)) if (!this.styleIdByName.has(name)) this.styleIdByName.set(name, id);
  }

  private ref(el: Element): string {
    this.nodes.push(el);
    return String(this.nodes.length - 1);
  }

  private node(id: string | undefined): Element | undefined {
    return id === undefined ? undefined : this.nodes[Number(id)];
  }

  // ---------- render ----------

  render(doc: Document): DocumentFragment {
    const frag = doc.createDocumentFragment();
    for (const child of Array.from(this.body.children)) {
      const el = this.renderBlock(doc, child);
      if (el) frag.append(el);
    }
    if (!frag.childNodes.length) {
      const p = doc.createElement('p');
      p.append(doc.createElement('br'));
      frag.append(p);
    }
    return frag;
  }

  private renderBlock(doc: Document, el: Element): HTMLElement | null {
    if (el.namespaceURI !== W) return this.opaque(doc, el);
    switch (el.localName) {
      case 'p':
        return this.renderParagraph(doc, el);
      case 'tbl':
        return this.renderTable(doc, el);
      case 'sectPr':
        return null; // kept in place by serialize()
      case 'bookmarkStart':
      case 'bookmarkEnd':
        return null;
      default:
        return this.opaque(doc, el);
    }
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

  paragraphStyle(p: Element): string {
    const id = child(child(p, 'pPr'), 'pStyle')?.getAttributeNS(W, 'val') ?? '';
    return this.ctx.styles[id] ?? id.toLowerCase();
  }

  private renderParagraph(doc: Document, p: Element): HTMLElement {
    const style = this.paragraphStyle(p);
    const m = /^(?:heading\s*(\d))|^title$/.exec(style);
    const level = m ? (m[1] ? Math.min(6, Number(m[1])) : 1) : 0;
    const el = doc.createElement(level ? `h${level}` : 'p');
    el.dataset.p = this.ref(p);
    const pPr = child(p, 'pPr');
    if (pPr) applyParagraphStyle(el, pPr);
    if (style === 'title') el.classList.add('title');
    if (child(pPr, 'numPr') || /list/.test(style)) el.classList.add('li');
    const readOnly = [...p.getElementsByTagName('*')].some((n) => n.namespaceURI === W && (OPAQUE_INLINE.has(n.localName) || FIELD_RUN_CHILDREN.has(n.localName)));
    if (readOnly) {
      el.dataset.opaque = el.dataset.p;
      el.contentEditable = 'false';
      el.classList.add('locked');
      el.title = t('Contains tracked changes, fields or content controls — kept as it is');
    }
    for (const c of Array.from(p.children)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 'r') this.renderRun(doc, el, c);
      else if (c.localName === 'hyperlink') {
        const a = doc.createElement('a');
        a.dataset.hl = this.ref(c);
        const rid = c.getAttributeNS(R_NS, 'id');
        const rel = this.ctx.rels.find((r) => r.id === rid);
        if (rel?.external) a.title = rel.target;
        for (const r of Array.from(c.children)) if (r.localName === 'r') this.renderRun(doc, a, r);
        el.append(a);
      } else if (readOnly) {
        el.append(doc.createTextNode(c.textContent ?? ''));
      }
    }
    if (!el.textContent && !el.querySelector('img,.atom')) el.append(doc.createElement('br'));
    return el;
  }

  private renderRun(doc: Document, parent: HTMLElement, r: Element) {
    const rPr = child(r, 'rPr');
    const id = this.ref(r);
    for (const c of Array.from(r.children)) {
      if (c.namespaceURI !== W) continue;
      switch (c.localName) {
        case 'rPr':
        case 'lastRenderedPageBreak':
          break;
        case 't': {
          const s = doc.createElement('span');
          s.dataset.r = id;
          applyRunStyle(s, rPr);
          s.textContent = c.textContent ?? '';
          parent.append(wrapFormatting(doc, s, rPr));
          break;
        }
        case 'br':
        case 'cr': {
          if (c.getAttributeNS(W, 'type') === 'page') {
            parent.append(this.atom(doc, r, c, '⤓ page break'));
          } else {
            const br = doc.createElement('br');
            br.dataset.r = id;
            parent.append(br);
          }
          break;
        }
        case 'tab': {
          const s = this.atom(doc, r, c, '\t');
          s.classList.add('tab');
          parent.append(s);
          break;
        }
        default:
          if (ATOM_RUN_CHILDREN.has(c.localName) || !FIELD_RUN_CHILDREN.has(c.localName)) parent.append(this.atom(doc, r, c));
      }
    }
  }

  /** An uneditable inline element standing for one run child. */
  private atom(doc: Document, r: Element, c: Element, label?: string): HTMLElement {
    const single = r.cloneNode(false) as Element;
    const rPr = child(r, 'rPr');
    if (rPr) single.append(rPr.cloneNode(true));
    single.append(c.cloneNode(true));
    this.atoms.push(single);
    const s = doc.createElement('span');
    s.className = 'atom';
    s.contentEditable = 'false';
    s.dataset.atom = String(this.atoms.length - 1);
    if (label !== undefined) {
      s.textContent = label;
      return s;
    }
    if (c.localName === 'drawing') {
      const blip = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
      const rid = blip?.getAttributeNS(R_NS, 'embed');
      const rel = this.ctx.rels.find((x) => x.id === rid);
      const ext = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
      if (rel && !rel.external) {
        const img = doc.createElement('img');
        img.src = this.ctx.partUrl(rel.target);
        img.alt = '';
        if (ext) {
          img.style.width = `${Math.round(Number(ext.getAttribute('cx')) / 9525)}px`;
          img.style.maxWidth = '100%';
        }
        s.append(img);
        return s;
      }
    }
    s.textContent = c.localName === 'footnoteReference' ? '¹' : c.localName === 'sym' ? '◆' : `[${c.localName}]`;
    s.classList.add('chip');
    return s;
  }

  private renderTable(doc: Document, tbl: Element): HTMLElement {
    const t = doc.createElement('table');
    t.dataset.tbl = this.ref(tbl);
    for (const tr of Array.from(tbl.children).filter((c) => c.localName === 'tr')) {
      const row = doc.createElement('tr');
      for (const tc of Array.from(tr.children).filter((c) => c.localName === 'tc')) {
        const cell = doc.createElement('td');
        const span = child(child(tc, 'tcPr'), 'gridSpan')?.getAttributeNS(W, 'val');
        if (span) cell.colSpan = Number(span);
        for (const b of Array.from(tc.children)) {
          if (b.localName === 'tcPr') continue;
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

  /** Rebuild document.xml from the edited HTML. */
  serialize(root: HTMLElement): string {
    const xml = this.xml;
    const body = this.body;
    const sectPr = Array.from(body.children).find((c) => c.localName === 'sectPr' && c.namespaceURI === W);
    const usedParagraphs = new Set<string>();
    const out: Element[] = [];
    for (const el of Array.from(root.children) as HTMLElement[]) out.push(...this.serializeBlock(el, usedParagraphs));
    while (body.firstChild) body.removeChild(body.firstChild);
    for (const n of out) body.append(n);
    if (sectPr) body.append(sectPr);
    let s = new XMLSerializer().serializeToString(xml);
    if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
    // Re-render must use fresh element refs.
    return s;
  }

  private serializeBlock(el: HTMLElement, used: Set<string>): Element[] {
    if (el.dataset.opaque) {
      const orig = this.node(el.dataset.opaque);
      return orig ? [orig.cloneNode(true) as Element] : [];
    }
    if (el.tagName === 'TABLE') return [this.serializeTable(el as HTMLTableElement, used)];
    if (/^(P|H[1-6]|DIV|LI|BLOCKQUOTE|PRE)$/.test(el.tagName)) {
      // A browser may wrap new lines in nested divs; flatten them.
      const blockKids = Array.from(el.children).filter((c) => /^(P|H[1-6]|DIV|TABLE|UL|OL|LI)$/.test(c.tagName));
      if (blockKids.length && blockKids.length === el.children.length && !hasOwnText(el)) return blockKids.flatMap((k) => this.serializeBlock(k as HTMLElement, used));
      return [this.serializeParagraph(el, used)];
    }
    if (el.tagName === 'UL' || el.tagName === 'OL') return Array.from(el.children).flatMap((k) => this.serializeBlock(k as HTMLElement, used));
    return [this.serializeParagraph(el, used)];
  }

  private serializeTable(t: HTMLTableElement, used: Set<string>): Element {
    const orig = this.node(t.dataset.tbl);
    const tbl = (orig ? orig.cloneNode(true) : this.xml.createElementNS(W, 'w:tbl')) as Element;
    const xmlRows = Array.from(tbl.children).filter((c) => c.localName === 'tr');
    const htmlRows = Array.from(t.rows);
    htmlRows.forEach((hr, ri) => {
      const xr = xmlRows[ri];
      if (!xr) return;
      const xmlCells = Array.from(xr.children).filter((c) => c.localName === 'tc');
      Array.from(hr.cells).forEach((hc, ci) => {
        const xc = xmlCells[ci];
        if (!xc) return;
        for (const n of Array.from(xc.children)) if (n.localName !== 'tcPr') xc.removeChild(n);
        const blocks = Array.from(hc.children).flatMap((k) => this.serializeBlock(k as HTMLElement, used));
        // A cell must contain at least one paragraph.
        if (!blocks.some((b) => b.localName === 'p')) blocks.push(this.xml.createElementNS(W, 'w:p'));
        for (const b of blocks) xc.append(b);
      });
    });
    return tbl;
  }

  private serializeParagraph(el: HTMLElement, used: Set<string>): Element {
    const xml = this.xml;
    const orig = this.node(el.dataset.p);
    const p = xml.createElementNS(W, 'w:p');
    // Paragraph properties come from the original (also for paragraphs the
    // browser created by splitting it with Enter).
    const pPrOrig = child(orig, 'pPr');
    let pPr = pPrOrig ? (pPrOrig.cloneNode(true) as Element) : null;
    const wantLevel = /^H([1-6])$/.exec(el.tagName)?.[1];
    const origLevel = orig ? /^heading\s*(\d)/.exec(this.paragraphStyle(orig))?.[1] : undefined;
    const isTitle = orig ? this.paragraphStyle(orig) === 'title' : false;
    if ((wantLevel ?? '') !== (origLevel ?? '') && !(isTitle && wantLevel === '1')) {
      pPr ??= xml.createElementNS(W, 'w:pPr');
      let ps = child(pPr, 'pStyle');
      if (wantLevel) {
        if (!ps) {
          ps = xml.createElementNS(W, 'w:pStyle');
          pPr.insertBefore(ps, pPr.firstChild);
        }
        ps.setAttributeNS(W, 'w:val', this.styleIdByName.get(`heading ${wantLevel}`) ?? `Heading${wantLevel}`);
      } else if (ps) pPr.removeChild(ps);
    }
    if (pPr) p.append(pPr);
    // Bookmarks belong to the first copy of a split paragraph.
    const first = el.dataset.p !== undefined && !used.has(el.dataset.p);
    if (el.dataset.p !== undefined) used.add(el.dataset.p);
    if (orig && first) for (const b of Array.from(orig.children)) if (b.localName === 'bookmarkStart') p.append(b.cloneNode(true));

    const segments = collect(el);
    let currentLink: string | undefined;
    let linkEl: Element | null = null;
    const append = (r: Element, link?: string) => {
      if (link !== currentLink) {
        currentLink = link;
        linkEl = null;
        if (link !== undefined) {
          const o = this.node(link);
          linkEl = o ? (o.cloneNode(false) as Element) : null;
          if (linkEl) p.append(linkEl);
        }
      }
      (linkEl ?? p).append(r);
    };
    let i = 0;
    while (i < segments.length) {
      const s = segments[i];
      if (s.kind === 'atom') {
        const a = this.atoms[Number(s.atom)];
        if (a) append(a.cloneNode(true) as Element, s.link);
        i++;
        continue;
      }
      if (s.kind === 'br') {
        const r = this.makeRun(s.run, s.fmt);
        r.append(xml.createElementNS(W, 'w:br'));
        append(r, s.link);
        i++;
        continue;
      }
      // Merge consecutive text with identical formatting/run/link.
      let text = s.text;
      let j = i + 1;
      while (j < segments.length) {
        const n = segments[j];
        if (n.kind !== 'text' || n.run !== s.run || n.link !== s.link || !sameFmt(n.fmt, s.fmt)) break;
        text += n.text;
        j++;
      }
      if (text) {
        const r = this.makeRun(s.run, s.fmt);
        const t = xml.createElementNS(W, 'w:t');
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        t.textContent = text;
        r.append(t);
        append(r, s.link);
      }
      i = j;
    }
    if (orig && first) for (const b of Array.from(orig.children)) if (b.localName === 'bookmarkEnd') p.append(b.cloneNode(true));
    return p;
  }

  /** A run with the original run's properties, adjusted for b/i/u/s. */
  private makeRun(runId: string | undefined, fmt: Fmt): Element {
    const xml = this.xml;
    const r = xml.createElementNS(W, 'w:r');
    const orig = this.node(runId);
    const rPrOrig = child(orig, 'rPr');
    const rPr = (rPrOrig ? rPrOrig.cloneNode(true) : xml.createElementNS(W, 'w:rPr')) as Element;
    setToggle(xml, rPr, 'b', fmt.b);
    setToggle(xml, rPr, 'i', fmt.i);
    setToggle(xml, rPr, 'strike', fmt.s);
    const u = child(rPr, 'u');
    const hasU = !!u && u.getAttributeNS(W, 'val') !== 'none';
    if (fmt.u && !hasU) {
      const nu = u ?? xml.createElementNS(W, 'w:u');
      nu.setAttributeNS(W, 'w:val', 'single');
      if (!u) insertRPr(rPr, nu);
    } else if (!fmt.u && u) rPr.removeChild(u);
    if (rPr.children.length) r.append(rPr);
    return r;
  }
}

export interface Fmt {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
}

export type Segment =
  | { kind: 'text'; text: string; run?: string; link?: string; fmt: Fmt }
  | { kind: 'br'; run?: string; link?: string; fmt: Fmt }
  | { kind: 'atom'; atom: string; link?: string };

export function sameFmt(a: Fmt, b: Fmt) {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s;
}

/** Walk a paragraph's DOM collecting text with its effective formatting. */
export function collect(el: HTMLElement): Segment[] {
  const out: Segment[] = [];
  const walk = (n: Node, fmt: Fmt, run: string | undefined, link: string | undefined) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent ?? '').replace(/ /g, ' ').replace(/​/g, '');
      if (text) out.push({ kind: 'text', text, run, link, fmt });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    if (e.dataset.atom !== undefined) {
      out.push({ kind: 'atom', atom: e.dataset.atom, link });
      return;
    }
    if (e.tagName === 'BR') {
      // A lone <br> in an otherwise empty paragraph is just the caret holder.
      if (e.parentElement === el && el.childNodes.length === 1) return;
      if (e === el.lastChild && !e.dataset.r) return;
      out.push({ kind: 'br', run: e.dataset.r ?? run, link, fmt });
      return;
    }
    const f = { ...fmt };
    const tag = e.tagName;
    if (tag === 'B' || tag === 'STRONG') f.b = true;
    if (tag === 'I' || tag === 'EM') f.i = true;
    if (tag === 'U') f.u = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
    const st = e.style;
    if (st.fontWeight) f.b = st.fontWeight === 'bold' || Number(st.fontWeight) >= 600;
    if (st.fontStyle) f.i = st.fontStyle === 'italic';
    const deco = st.textDecorationLine || st.textDecoration;
    if (deco) {
      f.u = deco.includes('underline');
      f.s = deco.includes('line-through');
    }
    if (e.dataset.fmtB) f.b = e.dataset.fmtB === '1';
    const r = e.dataset.r ?? run;
    const l = e.dataset.hl ?? link;
    for (const c of Array.from(e.childNodes)) walk(c, f, r, l);
  };
  for (const c of Array.from(el.childNodes)) walk(c, { b: false, i: false, u: false, s: false }, undefined, undefined);
  return out;
}

export function hasOwnText(el: HTMLElement) {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
}

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name && c.namespaceURI === W) return c;
  return null;
}

function on(el: Element | null): boolean {
  if (!el) return false;
  const v = el.getAttributeNS(W, 'val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v);
}

// rPr children must follow the schema order; this is the relevant subset.
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

function insertRPr(rPr: Element, el: Element) {
  const idx = RPR_ORDER.indexOf(el.localName);
  for (const c of Array.from(rPr.children)) {
    if (RPR_ORDER.indexOf(c.localName) > idx) {
      rPr.insertBefore(el, c);
      return;
    }
  }
  rPr.append(el);
}

function setToggle(xml: XMLDocument, rPr: Element, name: string, want: boolean) {
  const el = child(rPr, name);
  if (want === on(el)) return;
  if (el) rPr.removeChild(el);
  if (want) insertRPr(rPr, xml.createElementNS(W, `w:${name}`));
  else if (el) {
    // Explicitly off (a style may otherwise turn it on).
    const off = xml.createElementNS(W, `w:${name}`);
    off.setAttributeNS(W, 'w:val', '0');
    insertRPr(rPr, off);
  }
}

function twipsToPx(v: string | null): number {
  return v ? Math.round(Number(v) / 15) : 0;
}

function applyParagraphStyle(el: HTMLElement, pPr: Element) {
  const jc = child(pPr, 'jc')?.getAttributeNS(W, 'val');
  if (jc) el.style.textAlign = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc;
  const ind = child(pPr, 'ind');
  const left = ind?.getAttributeNS(W, 'left') ?? ind?.getAttributeNS(W, 'start');
  if (left) el.style.marginLeft = `${twipsToPx(left)}px`;
  const sp = child(pPr, 'spacing');
  const before = sp?.getAttributeNS(W, 'before');
  const after = sp?.getAttributeNS(W, 'after');
  if (before) el.style.marginTop = `${twipsToPx(before)}px`;
  if (after) el.style.marginBottom = `${twipsToPx(after)}px`;
}

function applyRunStyle(s: HTMLElement, rPr: Element | null) {
  if (!rPr) return;
  const color = child(rPr, 'color')?.getAttributeNS(W, 'val');
  if (color && color !== 'auto') s.style.color = `#${color}`;
  const sz = child(rPr, 'sz')?.getAttributeNS(W, 'val');
  if (sz) s.style.fontSize = `${Number(sz) / 2}pt`;
  const hl = child(rPr, 'highlight')?.getAttributeNS(W, 'val');
  if (hl && hl !== 'none') s.style.backgroundColor = HIGHLIGHT[hl] ?? hl;
  const va = child(rPr, 'vertAlign')?.getAttributeNS(W, 'val');
  if (va === 'superscript') s.style.verticalAlign = 'super';
  if (va === 'subscript') s.style.verticalAlign = 'sub';
  if (va) s.style.fontSize = '0.75em';
  const font = child(rPr, 'rFonts')?.getAttributeNS(W, 'ascii');
  if (font) s.style.fontFamily = `"${font}", var(--doc-font)`;
}

/** Wrap a run span in b/i/u/s elements so the browser's formatting commands see them. */
function wrapFormatting(doc: Document, s: HTMLElement, rPr: Element | null): HTMLElement {
  let out: HTMLElement = s;
  const wrap = (tag: string) => {
    const w = doc.createElement(tag);
    w.append(out);
    out = w;
  };
  if (on(child(rPr, 'b'))) wrap('b');
  if (on(child(rPr, 'i'))) wrap('i');
  const u = child(rPr, 'u');
  if (u && u.getAttributeNS(W, 'val') !== 'none') wrap('u');
  if (on(child(rPr, 'strike'))) wrap('s');
  return out;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: '#fff59d',
  green: '#c5e1a5',
  cyan: '#b2ebf2',
  magenta: '#f8bbd0',
  blue: '#90caf9',
  red: '#ef9a9a',
  darkBlue: '#5c6bc0',
  lightGray: '#e0e0e0',
  darkGray: '#9e9e9e',
};
