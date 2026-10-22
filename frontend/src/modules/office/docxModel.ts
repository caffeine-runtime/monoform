// WordprocessingML <-> editable HTML.
//
// render(): builds HTML from word/document.xml. Every block keeps a pointer
// (data-p / data-tbl / data-opaque) to its original XML element and every
// text span a pointer to its run (data-r), so serialize() can rebuild the XML
// reusing the original paragraph and run properties. Content the editor
// can't edit safely (tracked changes, fields, content controls, equations…)
// is shown read-only and written back unchanged.

import { t } from '../../core/i18n';
import { Numbering, type ListKind } from './docxNumbering';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface DocContext {
  styles: Record<string, string>; // styleId -> lower-case name
  rels: { id: string; type: string; target: string; external: boolean }[];
  /** URL for an internal package part (images). */
  partUrl: (entry: string) => string;
  /** List definitions (numbering.xml) and the lists paragraph styles turn on. */
  numbering?: Numbering;
  /** The raw styles.xml (new heading / title styles are added to it). */
  stylesXml?: string;
}

/** The deepest list level Word has. */
export const MAX_LIST_LEVEL = 8;

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
  readonly numbering: Numbering;
  private stylesDoc: XMLDocument | null = null;
  /** True once the editor added a paragraph style (styles.xml must be written). */
  stylesChanged = false;

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
    this.numbering = ctx.numbering ?? new Numbering('');
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
    this.renderListInfo(el, p);
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

  /** A list paragraph: its numbering instance and level, from its own numPr or its style. */
  private renderListInfo(el: HTMLElement, p: Element) {
    const pPr = child(p, 'pPr');
    const numPr = child(pPr, 'numPr');
    let numId = child(numPr, 'numId')?.getAttributeNS(W, 'val') ?? null;
    let ilvl = Number(child(numPr, 'ilvl')?.getAttributeNS(W, 'val') ?? NaN);
    let src = 'own';
    if (numId === null) {
      const styleId = child(pPr, 'pStyle')?.getAttributeNS(W, 'val') ?? '';
      const sl = styleId ? this.numbering.styleList(styleId) : null;
      if (sl) {
        numId = sl.numId;
        if (Number.isNaN(ilvl)) ilvl = sl.ilvl;
        src = 'style';
      }
    }
    if (Number.isNaN(ilvl)) ilvl = 0;
    if (numId === null || !this.numbering.has(numId)) return;
    el.dataset.numId = el.dataset.numIdOrig = numId;
    el.dataset.ilvl = el.dataset.ilvlOrig = String(ilvl);
    el.dataset.numSrc = src;
    this.decorateList(el, child(pPr, 'ind'));
  }

  /** Class and indentation of a list paragraph (or their removal); ownInd: the paragraph's own w:ind, which wins over the level's. */
  decorateList(el: HTMLElement, ownInd: Element | null = null) {
    const numId = el.dataset.numId;
    if (!numId || numId === '0') {
      el.classList.remove('li');
      delete el.dataset.marker;
      if (el.dataset.listIndent) el.style.marginLeft = el.style.paddingLeft = '';
      delete el.dataset.listIndent;
      return;
    }
    el.classList.add('li');
    const lv = this.numbering.level(numId, Number(el.dataset.ilvl ?? 0));
    const own = (name: string) => Number(ownInd?.getAttributeNS(W, name) ?? NaN);
    const left = (Number.isNaN(own('left')) ? own('start') : own('left')) || lv?.left || 720 * (Number(el.dataset.ilvl ?? 0) + 1);
    const hanging = (Number.isNaN(own('hanging')) ? NaN : own('hanging')) || lv?.hanging || 360;
    el.style.marginLeft = `${Math.max(0, twipsToPx(String(left - hanging)))}px`;
    el.style.paddingLeft = `${Math.max(18, twipsToPx(String(hanging)))}px`;
    el.dataset.listIndent = '1';
  }

  /** Set every list paragraph's marker (data-marker), in document order. */
  renumber(root: HTMLElement) {
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-num-id]')).filter((e) => e.dataset.numId !== '0');
    const markers = this.numbering.renumber(items.map((e) => ({ numId: e.dataset.numId!, ilvl: Number(e.dataset.ilvl ?? 0) })));
    items.forEach((e, i) => {
      if (e.dataset.marker !== markers[i]) e.dataset.marker = markers[i];
    });
  }

  /** The kind of list a paragraph is in (null: none). */
  listKind(el: HTMLElement): ListKind | null {
    const id = el.dataset.numId;
    return id && id !== '0' && this.numbering.has(id) ? this.numbering.kind(id, Number(el.dataset.ilvl ?? 0)) : null;
  }

  /**
   * Bulleted / numbered list on or off for these paragraphs (Word's list
   * buttons): when all are already that kind of list it turns them off,
   * otherwise they join the list just before them (if it is that kind) or a
   * new one.
   */
  toggleList(paras: HTMLElement[], kind: ListKind) {
    if (!paras.length) return;
    if (paras.every((p) => this.listKind(p) === kind)) {
      for (const p of paras) {
        p.dataset.numId = '0';
        p.dataset.ilvl = '0';
        this.decorateList(p);
      }
      return;
    }
    const prev = previousBlock(paras[0]);
    const numId = prev && this.listKind(prev) === kind && prev.dataset.ilvl === '0' ? prev.dataset.numId! : this.numbering.newList(kind);
    for (const p of paras) {
      const sameKind = this.listKind(p) === kind;
      p.dataset.numId = numId;
      if (!sameKind) p.dataset.ilvl = '0';
      this.decorateList(p);
    }
  }

  /** Move list paragraphs a level deeper (+1) or shallower (-1); shallower than the first level ends the list. */
  changeLevel(paras: HTMLElement[], delta: number) {
    for (const p of paras) {
      if (!this.listKind(p)) continue;
      const next = Number(p.dataset.ilvl ?? 0) + delta;
      if (next < 0) {
        p.dataset.numId = '0';
        p.dataset.ilvl = '0';
      } else p.dataset.ilvl = String(Math.min(MAX_LIST_LEVEL, next));
      this.decorateList(p);
    }
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
    // Headings and the title are styles; a plain paragraph keeps any other style it had.
    const level = /^H([1-6])$/.exec(el.tagName)?.[1];
    const want = level ? (el.classList.contains('title') ? 'title' : `heading ${level}`) : '';
    const had = orig ? this.paragraphStyle(orig) : '';
    const hadHeading = /^(heading\s*\d|title)$/.test(had);
    if (want !== had && (want || hadHeading)) {
      pPr ??= xml.createElementNS(W, 'w:pPr');
      let ps = child(pPr, 'pStyle');
      if (want) {
        if (!ps) {
          ps = xml.createElementNS(W, 'w:pStyle');
          pPr.insertBefore(ps, pPr.firstChild);
        }
        ps.setAttributeNS(W, 'w:val', this.ensureStyle(want));
      } else if (ps) pPr.removeChild(ps);
    }
    pPr = this.serializeParagraphFormat(el, pPr);
    pPr = this.serializeList(el, pPr, orig);
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
        // A typed tab is a w:tab between pieces of text.
        text.split('\t').forEach((piece, k) => {
          if (k > 0) r.append(xml.createElementNS(W, 'w:tab'));
          if (!piece) return;
          const t = xml.createElementNS(W, 'w:t');
          t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
          t.textContent = piece;
          r.append(t);
        });
        append(r, s.link);
      }
      i = j;
    }
    if (orig && first) for (const b of Array.from(orig.children)) if (b.localName === 'bookmarkEnd') p.append(b.cloneNode(true));
    return p;
  }

  /** Alignment, left indent and line spacing, where the editor changed them from what the paragraph showed. */
  private serializeParagraphFormat(el: HTMLElement, pPr: Element | null): Element | null {
    const shown = el.ownerDocument.createElement('p');
    const origPPr = child(this.node(el.dataset.p), 'pPr');
    if (origPPr) applyParagraphStyle(shown, origPPr);
    const xml = this.xml;
    const ensure = () => (pPr ??= xml.createElementNS(W, 'w:pPr'));
    const align = el.style.textAlign;
    if (align !== shown.style.textAlign) {
      const old = child(ensure(), 'jc');
      if (old) pPr!.removeChild(old);
      const jc = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'both' }[align];
      if (jc) {
        const e = xml.createElementNS(W, 'w:jc');
        e.setAttributeNS(W, 'w:val', jc);
        insertPPr(pPr!, e);
      }
    }
    if (!el.classList.contains('li') && !el.dataset.listIndent && el.style.marginLeft !== shown.style.marginLeft) {
      let ind = child(ensure(), 'ind');
      const px = parseFloat(el.style.marginLeft) || 0;
      if (px > 0) {
        if (!ind) insertPPr(pPr!, (ind = xml.createElementNS(W, 'w:ind')));
        ind.removeAttributeNS(W, 'start');
        ind.setAttributeNS(W, 'w:left', String(Math.round(px * 15)));
      } else if (ind) {
        ind.removeAttributeNS(W, 'left');
        ind.removeAttributeNS(W, 'start');
        if (!ind.attributes.length) pPr!.removeChild(ind);
      }
    }
    if (el.style.lineHeight !== shown.style.lineHeight) {
      let sp = child(ensure(), 'spacing');
      const v = Number(el.style.lineHeight);
      if (v > 0) {
        if (!sp) insertPPr(pPr!, (sp = xml.createElementNS(W, 'w:spacing')));
        sp.setAttributeNS(W, 'w:line', String(Math.round(v * 240)));
        sp.setAttributeNS(W, 'w:lineRule', 'auto');
      } else if (sp) {
        sp.removeAttributeNS(W, 'line');
        sp.removeAttributeNS(W, 'lineRule');
        if (!sp.attributes.length) pPr!.removeChild(sp);
      }
    }
    return pPr;
  }

  /** The id of a paragraph style by name ("heading 4", "title"), added to styles.xml when the document lacks it. */
  ensureStyle(name: string): string {
    const have = this.styleIdByName.get(name);
    if (have) return have;
    const level = /^heading (\d)$/.exec(name)?.[1];
    const id = level ? `Heading${level}` : 'Title';
    this.stylesDoc ??= new DOMParser().parseFromString(this.ctx.stylesXml?.trim() ? this.ctx.stylesXml : `<w:styles xmlns:w="${W}"/>`, 'application/xml');
    const root = this.stylesDoc.documentElement;
    const mk = (tag: string, attrs: Record<string, string> = {}, ...kids: Element[]) => {
      const e = this.stylesDoc!.createElementNS(W, `w:${tag}`);
      for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v);
      e.append(...kids);
      return e;
    };
    const size = level ? [32, 26, 24, 22, 22, 22][Number(level) - 1] : 56;
    const rPr = mk('rPr', {}, ...(level && Number(level) <= 4 ? [mk('b')] : []), ...(level && Number(level) >= 5 ? [mk('i')] : []), mk('sz', { val: String(size) }), mk('szCs', { val: String(size) }));
    const pPr = level ? mk('pPr', {}, mk('keepNext'), mk('spacing', { before: '240', after: '80' }), mk('outlineLvl', { val: String(Number(level) - 1) })) : mk('pPr', {}, mk('spacing', { after: '80' }), mk('contextualSpacing'));
    const normal = this.styleIdByName.get('normal');
    root.append(mk('style', { type: 'paragraph', styleId: id }, mk('name', { val: level ? name : 'Title' }), ...(normal ? [mk('basedOn', { val: normal }), mk('next', { val: normal })] : []), mk('qFormat'), pPr, rPr)); // i18n-ignore: Word's style name in the file
    this.styleIdByName.set(name, id);
    this.ctx.styles[id] = name;
    this.stylesChanged = true;
    return id;
  }

  /** styles.xml with the styles the editor added. */
  serializeStyles(): string {
    let s = this.stylesDoc ? new XMLSerializer().serializeToString(this.stylesDoc) : this.ctx.stylesXml ?? '';
    if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
    return s;
  }

  /** The paragraph's list (numPr) when the editor changed it; anything else stays as it was. */
  private serializeList(el: HTMLElement, pPr: Element | null, orig: Element | undefined): Element | null {
    const numId = el.dataset.numId;
    const ilvl = el.dataset.ilvl ?? '0';
    if ((numId ?? '') === (el.dataset.numIdOrig ?? '') && ilvl === (el.dataset.ilvlOrig ?? '0')) return pPr;
    const xml = this.xml;
    pPr ??= xml.createElementNS(W, 'w:pPr');
    const old = child(pPr, 'numPr');
    if (old) pPr.removeChild(old);
    const styleId = child(pPr, 'pStyle')?.getAttributeNS(W, 'val') ?? '';
    const styleList = styleId ? this.numbering.styleList(styleId) : null;
    if (!numId || numId === '0') {
      // Off: a style's own list needs an explicit "no list".
      if (styleList) insertPPr(pPr, numPrEl(xml, '0', '0'));
    } else {
      insertPPr(pPr, numPrEl(xml, numId, ilvl));
      // A new level takes that level's indentation.
      if (ilvl !== (el.dataset.ilvlOrig ?? '') || !orig) {
        const ind = child(pPr, 'ind');
        if (ind) pPr.removeChild(ind);
      }
    }
    return pPr.children.length ? pPr : null;
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
    // The rest only where it differs from what the run showed (theme colours, other fonts stay).
    const was = fmtOfRPr(rPrOrig);
    const set = (name: string, attrs: Record<string, string> | null) => {
      const old = child(rPr, name);
      if (old) rPr.removeChild(old);
      if (!attrs) return;
      const e = xml.createElementNS(W, `w:${name}`);
      for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v);
      insertRPr(rPr, e);
    };
    if (fmt.color !== was.color) set('color', fmt.color ? { val: fmt.color } : null);
    if (fmt.size !== was.size) {
      const half = fmt.size ? String(Math.round(fmt.size * 2)) : null;
      set('sz', half ? { val: half } : null);
      set('szCs', half ? { val: half } : null);
    }
    if (fmt.font !== was.font) set('rFonts', fmt.font ? { ascii: fmt.font, hAnsi: fmt.font, cs: fmt.font, eastAsia: fmt.font } : null);
    if (fmt.bg !== was.bg) {
      const name = fmt.bg ? highlightName(fmt.bg) : undefined;
      set('highlight', name ? { val: name } : null);
      set('shd', fmt.bg && !name ? { val: 'clear', color: 'auto', fill: fmt.bg } : null);
    }
    if (fmt.va !== was.va) set('vertAlign', fmt.va ? { val: fmt.va } : null);
    if (rPr.children.length) r.append(rPr);
    return r;
  }
}

export interface Fmt {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  color?: string; // RRGGBB
  bg?: string; // RRGGBB (a highlight or shading)
  size?: number; // points
  font?: string;
  va?: 'superscript' | 'subscript';
}

export type Segment =
  | { kind: 'text'; text: string; run?: string; link?: string; fmt: Fmt }
  | { kind: 'br'; run?: string; link?: string; fmt: Fmt }
  | { kind: 'atom'; atom: string; link?: string };

export function sameFmt(a: Fmt, b: Fmt) {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.color === b.color && a.bg === b.bg && a.size === b.size && a.font === b.font && a.va === b.va;
}

/** A CSS colour (rgb(), #rgb, #rrggbb) as RRGGBB; undefined for none or transparent. */
export function hexColor(css: string | null | undefined): string | undefined {
  if (!css) return undefined;
  const c = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
  m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return m[1].toUpperCase();
  const r = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(c);
  if (r) {
    if (r[4] !== undefined && Number(r[4]) === 0) return undefined;
    return [r[1], r[2], r[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return undefined;
}

/** A CSS font size in points (pt or px; relative sizes are not a run's own). */
function points(css: string): number | undefined {
  const m = /^([\d.]+)(pt|px)$/.exec(css.trim());
  if (!m) return undefined;
  const v = m[2] === 'pt' ? Number(m[1]) : Number(m[1]) * 0.75;
  return Math.round(v * 2) / 2;
}

/** The first family of a CSS font-family list (the document default isn't a choice). */
function firstFamily(css: string): string | undefined {
  const f = css.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return f && !f.startsWith('var(') ? f : undefined;
}

/** What render() shows of a run's properties, as a Fmt (to tell what the editor changed). */
function fmtOfRPr(rPr: Element | null): Fmt {
  const f: Fmt = { b: on(child(rPr, 'b')), i: on(child(rPr, 'i')), u: !!child(rPr, 'u') && child(rPr, 'u')!.getAttributeNS(W, 'val') !== 'none', s: on(child(rPr, 'strike')) };
  if (!rPr) return f;
  const color = child(rPr, 'color')?.getAttributeNS(W, 'val');
  if (color && color !== 'auto') f.color = color.toUpperCase();
  const sz = child(rPr, 'sz')?.getAttributeNS(W, 'val');
  if (sz) f.size = Number(sz) / 2;
  const fonts = child(rPr, 'rFonts');
  const font = fonts?.getAttributeNS(W, 'ascii') || fonts?.getAttributeNS(W, 'hAnsi');
  if (font) f.font = font;
  const hl = child(rPr, 'highlight')?.getAttributeNS(W, 'val');
  const fill = child(rPr, 'shd')?.getAttributeNS(W, 'fill');
  if (hl && hl !== 'none') f.bg = hexColor(HIGHLIGHT[hl] ?? '');
  else if (fill && fill !== 'auto') f.bg = fill.toUpperCase();
  const va = child(rPr, 'vertAlign')?.getAttributeNS(W, 'val');
  if (va === 'superscript' || va === 'subscript') f.va = va;
  return f;
}

/** Word's highlight name for a colour of the highlight palette. */
function highlightName(hex: string): string | undefined {
  return Object.entries(HIGHLIGHT).find(([, v]) => hexColor(v) === hex)?.[0];
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
    if (tag === 'SUP') f.va = 'superscript';
    if (tag === 'SUB') f.va = 'subscript';
    if (tag === 'FONT') {
      const c = hexColor(e.getAttribute('color'));
      if (c) f.color = c;
      const face = e.getAttribute('face');
      if (face) f.font = firstFamily(face) ?? f.font;
    }
    if (st.color) f.color = hexColor(st.color) ?? f.color;
    if (st.backgroundColor) f.bg = hexColor(st.backgroundColor);
    if (st.fontSize) f.size = points(st.fontSize) ?? f.size;
    if (st.fontFamily) f.font = firstFamily(st.fontFamily) ?? f.font;
    if (st.verticalAlign === 'super') f.va = 'superscript';
    else if (st.verticalAlign === 'sub') f.va = 'subscript';
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

// pPr children must follow the schema order.
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];

export function insertPPr(pPr: Element, el: Element) {
  const idx = PPR_ORDER.indexOf(el.localName);
  for (const c of Array.from(pPr.children)) {
    if (PPR_ORDER.indexOf(c.localName) > idx) {
      pPr.insertBefore(el, c);
      return;
    }
  }
  pPr.append(el);
}

function numPrEl(xml: XMLDocument, numId: string, ilvl: string): Element {
  const numPr = xml.createElementNS(W, 'w:numPr');
  const l = xml.createElementNS(W, 'w:ilvl');
  l.setAttributeNS(W, 'w:val', ilvl);
  const n = xml.createElementNS(W, 'w:numId');
  n.setAttributeNS(W, 'w:val', numId);
  numPr.append(l, n);
  return numPr;
}

/** The paragraph-like element before this one (crossing nothing but empty text). */
function previousBlock(el: HTMLElement): HTMLElement | null {
  const prev = el.previousElementSibling as HTMLElement | null;
  return prev && /^(P|H[1-6])$/.test(prev.tagName) ? prev : null;
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
  const line = Number(sp?.getAttributeNS(W, 'line') ?? '');
  const rule = sp?.getAttributeNS(W, 'lineRule') ?? 'auto';
  if (line > 0) el.style.lineHeight = rule === 'auto' ? String(Math.round((line / 240) * 100) / 100) : `${line / 20}pt`;
}

function applyRunStyle(s: HTMLElement, rPr: Element | null) {
  if (!rPr) return;
  const color = child(rPr, 'color')?.getAttributeNS(W, 'val');
  if (color && color !== 'auto') s.style.color = `#${color}`;
  const sz = child(rPr, 'sz')?.getAttributeNS(W, 'val');
  if (sz) s.style.fontSize = `${Number(sz) / 2}pt`;
  const hl = child(rPr, 'highlight')?.getAttributeNS(W, 'val');
  const fill = child(rPr, 'shd')?.getAttributeNS(W, 'fill');
  if (hl && hl !== 'none') s.style.backgroundColor = HIGHLIGHT[hl] ?? hl;
  else if (fill && fill !== 'auto') s.style.backgroundColor = `#${fill}`;
  const fonts = child(rPr, 'rFonts');
  const font = fonts?.getAttributeNS(W, 'ascii') || fonts?.getAttributeNS(W, 'hAnsi');
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
  const va = child(rPr, 'vertAlign')?.getAttributeNS(W, 'val');
  if (va === 'superscript') wrap('sup');
  if (va === 'subscript') wrap('sub');
  return out;
}

export const HIGHLIGHT: Record<string, string> = {
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
