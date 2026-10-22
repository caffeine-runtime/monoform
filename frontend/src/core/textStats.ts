// Word and character counts as Obsidian shows them: words are runs of
// letters/digits (apostrophes and hyphens inside a word keep it one word),
// each Chinese/Japanese character counts as a word, and characters are
// everything but line breaks. For Markdown the markup that isn't read is left
// out: front matter, link targets, and the # of headings.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD = /[\p{L}\p{N}\p{M}_]+(?:['’.\-][\p{L}\p{N}\p{M}_]+)*/gu;

export interface Counts {
  words: number;
  chars: number;
}

/** Counts in plain text. */
export function countText(text: string): Counts {
  let words = 0;
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = cjk ? text.replace(CJK, ' ') : text;
  for (const _ of rest.matchAll(WORD)) words++;
  const breaks = text.match(/\r?\n|\r/g)?.length ?? 0;
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const pairs = text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0;
  return { words: words + cjk, chars: text.length - breaks - crlf - pairs };
}

/** Markdown as it reads: without front matter, link targets and heading marks. */
export function markdownReadable(md: string): string {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')
    .replace(/!?\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]\n]*)\]\]/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]{0,3}(?:```|~~~).*$/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '');
}

export function countMarkdown(md: string): Counts {
  return countText(markdownReadable(md));
}

/** "1,234 words · 5,678 characters" (or "12 of 1,234 words · …" for a selection). */
export function formatCounts(all: Counts, sel?: Counts | null): string {
  const n = (v: number) => v.toLocaleString();
  const w = (v: number) => (v === 1 ? 'word' : 'words');
  const c = (v: number) => (v === 1 ? 'character' : 'characters');
  if (sel && (sel.words || sel.chars)) return `${n(sel.words)} of ${n(all.words)} ${w(all.words)} · ${n(sel.chars)} of ${n(all.chars)} ${c(all.chars)}`;
  return `${n(all.words)} ${w(all.words)} · ${n(all.chars)} ${c(all.chars)}`;
}

export interface OutlineItem {
  level: number;
  text: string;
  /** 1-based source line (Markdown) or the index of the heading element (documents). */
  line: number;
}

/** Headings of a Markdown text (ATX "# …" and setext "…\n===" ones; none inside code or front matter). */
export function markdownHeadings(md: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const lines = md.split(/\r?\n/);
  let fence = '';
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((l, j) => j > 0 && (l === '---' || l === '...'));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    const f = /^ {0,3}(```|~~~)/.exec(l);
    if (f) {
      if (!fence) fence = f[1];
      else if (fence === f[1]) fence = '';
      continue;
    }
    if (fence) continue;
    const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
    if (h) {
      if (h[2]) out.push({ level: h[1].length, text: inlineText(h[2]), line: i + 1 });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && l.trim() && !/^ {0,3}([-*+>]|\d+[.)])\s/.test(l) && /^ {0,3}(=+|-+)[ \t]*$/.test(next)) {
      out.push({ level: next.trim()[0] === '=' ? 1 : 2, text: inlineText(l.trim()), line: i + 1 });
      i++;
    }
  }
  return out;
}

/** Heading text without inline markup. */
function inlineText(s: string): string {
  return s
    .replace(/!?\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]\n]*)\]\]/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, '$2')
    .trim();
}

export interface OutlineNode extends OutlineItem {
  children: OutlineNode[];
}

/** Nests headings: each one goes under the closest earlier heading of a smaller level. */
export function outlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const it of items) {
    const node: OutlineNode = { ...it, children: [] };
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** The heading a line falls under (the last one at or above it), or -1. */
export function headingAt(items: OutlineItem[], line: number): number {
  let k = -1;
  for (let i = 0; i < items.length && items[i].line <= line; i++) k = i;
  return k;
}
