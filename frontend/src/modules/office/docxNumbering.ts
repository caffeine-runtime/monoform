// Word lists: word/numbering.xml (list definitions) and the list a paragraph
// style turns on (styles.xml). A list paragraph points at a numbering
// instance (w:numId) and a level (w:ilvl); the instance points at an abstract
// definition whose levels give the number format ("%1.", lower letters,
// a bullet character…), the start value and the indentation. Markers are
// computed for the whole document in order (renumber), and new lists made in
// the editor get definitions of their own, written back on save.

import { W } from './docxModel';

export interface Level {
  fmt: string; // numFmt: decimal, lowerLetter, upperRoman, bullet, none…
  text: string; // lvlText, e.g. "%1." or "•"
  start: number;
  left: number; // twips: where the text starts
  hanging: number; // twips: the marker sits this far left of the text
  legal: boolean; // isLgl: every level shown as decimal
}

export type ListKind = 'bullet' | 'number';

const MAX_LEVEL = 8;

function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name && c.namespaceURI === W) return c;
  return null;
}
const val = (el: Element | null | undefined) => el?.getAttributeNS(W, 'val') ?? null;

/** Symbol / Wingdings private-use bullets → characters any font has. */
const BULLETS: Record<string, string> = {
  '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '■', '': '□', '': '◆', '': '▸', '': '➔', o: '◦', '': '',
};

export function bulletChar(s: string): string {
  if (s in BULLETS) return BULLETS[s];
  const c = s.codePointAt(0) ?? 0;
  return c >= 0xf000 && c <= 0xf0ff ? '•' : s;
}

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of t) while (n >= v) (out += s), (n -= v);
  return out;
}

function letters(n: number): string {
  // Word: a…z, then aa…zz, aaa… (the letter repeated).
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

/** One counter in a level's number format. */
export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'ordinal': {
      const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][n % 10];
      return `${n}${s}`;
    }
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** The marker of a paragraph at level ilvl, given the counters of levels 0…ilvl. */
export function markerText(levels: Level[], counters: number[], ilvl: number): string {
  const lv = levels[ilvl];
  if (!lv) return '';
  if (lv.fmt === 'bullet') return bulletChar(lv.text);
  if (lv.fmt === 'none') return lv.text.replace(/%\d/g, '');
  return lv.text.replace(/%(\d)/g, (_, d) => {
    const k = Number(d) - 1;
    const l = levels[k];
    if (!l) return '';
    return formatNumber(counters[k] ?? l.start, lv.legal ? 'decimal' : l.fmt);
  });
}

function parseLevel(lvl: Element): Level {
  const ind = kid(kid(lvl, 'pPr'), 'ind');
  const twip = (name: string) => Number(ind?.getAttributeNS(W, name) ?? '') || 0;
  return {
    fmt: val(kid(lvl, 'numFmt')) ?? 'decimal',
    text: val(kid(lvl, 'lvlText')) ?? '',
    start: Number(val(kid(lvl, 'start')) ?? 1) || 0,
    left: twip('left') || twip('start'),
    hanging: twip('hanging'),
    legal: !!kid(lvl, 'isLgl'),
  };
}

export class Numbering {
  private xml: XMLDocument;
  private root: Element;
  /** abstractNumId → its levels. */
  private abstract = new Map<string, Level[]>();
  /** numId → abstractNumId and per-level start overrides. */
  private nums = new Map<string, { abs: string; starts: Map<number, number> }>();
  /** styleId → the list it turns on (resolved through basedOn). */
  private styleNums = new Map<string, { numId: string; ilvl: number }>();
  private made = new Map<ListKind, string>();
  /** True once the editor added definitions (numbering.xml must be written). */
  changed = false;
  /** The package had no numbering.xml. */
  readonly isNew: boolean;

  constructor(numberingXml: string, stylesXml = '') {
    this.isNew = !numberingXml.trim();
    const src = this.isNew ? `<w:numbering xmlns:w="${W}"/>` : numberingXml;
    this.xml = new DOMParser().parseFromString(src, 'application/xml');
    if (this.xml.getElementsByTagName('parsererror').length) this.xml = new DOMParser().parseFromString(`<w:numbering xmlns:w="${W}"/>`, 'application/xml');
    this.root = this.xml.documentElement;
    for (const a of Array.from(this.root.children)) {
      if (a.namespaceURI !== W) continue;
      if (a.localName === 'abstractNum') this.readAbstract(a);
      else if (a.localName === 'num') this.readNum(a);
    }
    if (stylesXml.trim()) this.readStyles(stylesXml);
  }

  private readAbstract(a: Element) {
    const id = a.getAttributeNS(W, 'abstractNumId') ?? '';
    const levels: Level[] = [];
    for (const l of Array.from(a.children)) {
      if (l.localName !== 'lvl' || l.namespaceURI !== W) continue;
      const i = Number(l.getAttributeNS(W, 'ilvl') ?? 0);
      if (i >= 0 && i <= MAX_LEVEL) levels[i] = parseLevel(l);
    }
    this.abstract.set(id, levels);
  }

  private readNum(n: Element) {
    const id = n.getAttributeNS(W, 'numId') ?? '';
    const starts = new Map<number, number>();
    for (const o of Array.from(n.children)) {
      if (o.localName !== 'lvlOverride' || o.namespaceURI !== W) continue;
      const s = val(kid(o, 'startOverride'));
      if (s !== null) starts.set(Number(o.getAttributeNS(W, 'ilvl') ?? 0), Number(s));
    }
    this.nums.set(id, { abs: val(kid(n, 'abstractNumId')) ?? '', starts });
  }

  private readStyles(stylesXml: string) {
    const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return;
    const own = new Map<string, { numId?: string; ilvl?: number; basedOn?: string }>();
    for (const s of Array.from(doc.getElementsByTagNameNS(W, 'style'))) {
      if (s.getAttributeNS(W, 'type') !== 'paragraph') continue;
      const numPr = kid(kid(s, 'pPr'), 'numPr');
      const ilvl = val(kid(numPr, 'ilvl'));
      own.set(s.getAttributeNS(W, 'styleId') ?? '', { numId: val(kid(numPr, 'numId')) ?? undefined, ilvl: ilvl === null ? undefined : Number(ilvl), basedOn: val(kid(s, 'basedOn')) ?? undefined });
    }
    for (const id of own.keys()) {
      let numId: string | undefined;
      let ilvl: number | undefined;
      const seen = new Set<string>();
      for (let s = own.get(id), sid = id; s && !seen.has(sid); sid = s.basedOn ?? '', s = own.get(sid)) {
        seen.add(sid);
        numId ??= s.numId;
        ilvl ??= s.ilvl;
      }
      if (numId && numId !== '0') this.styleNums.set(id, { numId, ilvl: ilvl ?? 0 });
    }
  }

  /** The list a paragraph style turns on, if any. */
  styleList(styleId: string): { numId: string; ilvl: number } | null {
    return this.styleNums.get(styleId) ?? null;
  }

  levels(numId: string): Level[] {
    const n = this.nums.get(numId);
    return (n && this.abstract.get(n.abs)) || [];
  }

  level(numId: string, ilvl: number): Level | null {
    return this.levels(numId)[ilvl] ?? null;
  }

  kind(numId: string, ilvl = 0): ListKind {
    return this.level(numId, ilvl)?.fmt === 'bullet' ? 'bullet' : 'number';
  }

  /** Whether numId is a list Word would show (an unknown or 0 id is "no list"). */
  has(numId: string): boolean {
    return numId !== '0' && this.nums.has(numId);
  }

  /**
   * Markers for paragraphs in document order. Counting follows Word: lists
   * sharing an abstract definition continue each other, a deeper level
   * restarts when a shallower one advances, and a num's start override
   * applies at its first paragraph.
   */
  renumber(items: { numId: string; ilvl: number }[]): string[] {
    const counters = new Map<string, number[]>();
    const begun = new Set<string>();
    return items.map(({ numId, ilvl }) => {
      const n = this.nums.get(numId);
      const levels = this.levels(numId);
      if (!n || !levels[ilvl]) return '';
      const c = counters.get(n.abs) ?? [];
      counters.set(n.abs, c);
      const override = !begun.has(numId) ? n.starts.get(ilvl) : undefined;
      begun.add(numId);
      if (override !== undefined) c[ilvl] = override;
      else c[ilvl] = c[ilvl] === undefined ? levels[ilvl].start : c[ilvl] + 1;
      c.length = ilvl + 1; // deeper levels start over
      for (let k = 0; k < ilvl; k++) c[k] ??= levels[k]?.start ?? 1;
      return markerText(levels, c, ilvl);
    });
  }

  /** A numbering instance for a new list of this kind (one definition per kind, reused). */
  newList(kind: ListKind): string {
    const had = this.made.get(kind);
    if (had) return had;
    const ids = (tag: string, attr: string) => Array.from(this.root.children).filter((c) => c.localName === tag).map((c) => Number(c.getAttributeNS(W, attr)) || 0);
    const absId = String(Math.max(-1, ...ids('abstractNum', 'abstractNumId')) + 1);
    const numId = String(Math.max(0, ...ids('num', 'numId')) + 1);
    const el = (name: string, attrs: Record<string, string> = {}, ...kids: Element[]) => {
      const e = this.xml.createElementNS(W, `w:${name}`);
      for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v);
      e.append(...kids);
      return e;
    };
    const abs = el('abstractNum', { abstractNumId: absId }, el('multiLevelType', { val: 'hybridMultilevel' }));
    const bullets = ['•', '◦', '▪'];
    const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    for (let i = 0; i <= MAX_LEVEL; i++) {
      const bullet = kind === 'bullet';
      abs.append(
        el(
          'lvl',
          { ilvl: String(i) },
          el('start', { val: '1' }),
          el('numFmt', { val: bullet ? 'bullet' : fmts[i % 3] }),
          el('lvlText', { val: bullet ? bullets[i % 3] : `%${i + 1}.` }),
          el('lvlJc', { val: bullet ? 'left' : i % 3 === 2 ? 'right' : 'left' }),
          el('pPr', {}, el('ind', { left: String(720 * (i + 1)), hanging: '360' })),
        ),
      );
    }
    // Schema order: every abstractNum before the first num.
    const firstNum = Array.from(this.root.children).find((c) => c.localName === 'num' && c.namespaceURI === W) ?? null;
    this.root.insertBefore(abs, firstNum);
    const num = el('num', { numId }, el('abstractNumId', { val: absId }));
    const cleanup = Array.from(this.root.children).find((c) => c.localName === 'numIdMacAtCleanup') ?? null;
    this.root.insertBefore(num, cleanup);
    this.readAbstract(abs);
    this.readNum(num);
    this.made.set(kind, numId);
    this.changed = true;
    return numId;
  }

  serialize(): string {
    let s = new XMLSerializer().serializeToString(this.xml);
    if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
    return s;
  }
}
