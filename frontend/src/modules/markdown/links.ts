// Obsidian-style links between notes: [[Note]], [[folder/Note#Heading|label]],
// ![[embed]] and relative [text](Note.md) links. The folder's notes are
// indexed in Go (internal/notes); this resolves links against that index the
// way Obsidian does (by note name, nearest first) and builds backlinks.
import type { MarkdownIt, StateInline } from 'markdown-it';
import { basename, dirname, join, resolveRelative } from '../../core/paths';

export interface NoteLink {
  target: string;
  heading?: string;
  wiki: boolean;
  embed?: boolean;
  line: number;
  text: string;
}

export interface NoteHeading {
  level: number;
  text: string;
  line: number;
}

export interface IndexedNote {
  path: string;
  links: NoteLink[];
  headings: NoteHeading[];
}

const NOTE_EXT = /\.(md|markdown|mdown|mkd)$/i;
export const isNotePath = (p: string) => NOTE_EXT.test(p);
const norm = (p: string) => p.replace(/\\/g, '/');
/** A note's name: its file name without .md. */
export const noteName = (p: string) => basename(p).replace(NOTE_EXT, '');

/** Links in a note's text (the current, possibly unsaved, one); same rules as internal/notes.Parse. */
export function parseLinks(text: string): NoteLink[] {
  const out: NoteLink[] = [];
  const lines = text.split('\n');
  let fence = '';
  let i = 0;
  if (lines[0]?.replace(/\r$/, '') === '---') {
    const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\r?$/.test(l));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = /^ {0,3}(```|~~~)/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (fence === f[1]) fence = '';
      continue;
    }
    if (fence || !line.includes('[')) continue;
    const plain = line.replace(/`+[^`\n]*`+/g, (s) => ' '.repeat(s.length));
    for (const m of plain.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
      const inner = m[2].split('|')[0];
      const hash = inner.indexOf('#');
      const target = (hash >= 0 ? inner.slice(0, hash) : inner).trim();
      const heading = hash >= 0 ? inner.slice(hash + 1).trim() : '';
      if (!target && !heading) continue;
      out.push({ target, heading: heading || undefined, wiki: true, embed: !!m[1] || undefined, line: i + 1, text: line.trim() });
    }
    for (const m of plain.matchAll(/(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g)) {
      const href = m[2];
      if ((/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) || href.startsWith('#')) continue;
      const hash = href.indexOf('#');
      let p = hash >= 0 ? href.slice(0, hash) : href;
      let heading = hash >= 0 ? href.slice(hash + 1) : '';
      try {
        p = decodeURIComponent(p);
        heading = decodeURIComponent(heading);
      } catch {
        /* keep as written */
      }
      if (!isNotePath(p)) continue;
      out.push({ target: p, heading: heading || undefined, wiki: false, embed: !!m[1] || undefined, line: i + 1, text: line.trim() });
    }
  }
  return out;
}

/** Common leading folders of two paths (for "nearest note first"). */
function shared(a: string, b: string): number {
  const x = norm(a).split('/');
  const y = norm(b).split('/');
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

/**
 * The note a link points to, or null. Wiki links match by note name (with any
 * folders written in the link as a path suffix), case-insensitively; when
 * several notes share the name, the one nearest to the linking note wins.
 * Markdown links are paths relative to the linking note.
 */
export function resolveLink(link: Pick<NoteLink, 'target' | 'wiki'>, from: string, notes: string[]): string | null {
  if (!link.target) return from;
  if (!link.wiki) {
    const p = norm(resolveRelative(from, link.target));
    return notes.find((n) => norm(n) === p) ?? notes.find((n) => norm(n).toLowerCase() === p.toLowerCase()) ?? null;
  }
  const want = norm(link.target).replace(NOTE_EXT, '').replace(/^\/+/, '').toLowerCase();
  const cands = notes.filter((n) => {
    const p = norm(n).replace(NOTE_EXT, '').toLowerCase();
    return p === want || p.endsWith(`/${want}`);
  });
  if (!cands.length) return null;
  return cands.reduce((best, n) => {
    const d = shared(n, from) - shared(best, from);
    return d > 0 || (d === 0 && norm(n).split('/').length < norm(best).split('/').length) ? n : best;
  });
}

/** Where a new note for an unresolved [[link]] goes: next to the linking note (folders in the link kept). */
export function newNotePath(target: string, from: string): string {
  const rel = norm(target).replace(/^\/+/, '');
  return join(dirname(from), isNotePath(rel) ? rel : `${rel}.md`);
}

export interface Backlink {
  path: string;
  links: NoteLink[];
}

/** Notes linking to `path`, each with its links to it (in line order); nearest folders first. */
export function backlinks(path: string, notes: IndexedNote[]): Backlink[] {
  const paths = notes.map((n) => n.path);
  const out: Backlink[] = [];
  for (const n of notes) {
    if (norm(n.path) === norm(path)) continue;
    const ls = n.links.filter((l) => l.target && resolveLink(l, n.path, paths) === path);
    if (ls.length) out.push({ path: n.path, links: ls });
  }
  return out.sort((a, b) => noteName(a.path).localeCompare(noteName(b.path)) || a.path.localeCompare(b.path));
}

/** The line of a heading in a note (by its text, case-insensitively), or undefined. */
export function headingLine(note: IndexedNote | undefined, heading: string | undefined): number | undefined {
  if (!note || !heading) return undefined;
  const h = heading.trim().toLowerCase();
  return note.headings.find((x) => x.text.toLowerCase() === h)?.line;
}

/**
 * markdown-it plugin: [[Note#Heading|label]] renders as a link the preview
 * resolves on click (`data-wiki`, `data-heading`); ![[picture.png]] as an image
 * next to the note; ![[Note]] as a link (embedding notes isn't supported).
 */
export function wikiLinks(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src;
    let pos = state.pos;
    const embed = src.charCodeAt(pos) === 0x21; /* ! */
    if (embed) pos++;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim() || /[[\]\n]/.test(inner)) return false;
    if (!silent) {
      const bar = inner.indexOf('|');
      const ref = bar >= 0 ? inner.slice(0, bar) : inner;
      const label = bar >= 0 ? inner.slice(bar + 1).trim() : '';
      const hash = ref.indexOf('#');
      const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
      const heading = hash >= 0 ? ref.slice(hash + 1).trim() : '';
      if (embed && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(target)) {
        const t = state.push('wiki_image', 'img', 0);
        t.attrSet('data-wiki-image', target);
        t.attrSet('alt', label || target);
      } else {
        const open = state.push('wiki_open', 'a', 1);
        open.attrSet('class', 'wikilink');
        open.attrSet('data-wiki', target);
        if (heading) open.attrSet('data-heading', heading);
        open.attrSet('title', ref.trim());
        const txt = state.push('text', '', 0);
        txt.content = label || (target ? (heading ? `${target} › ${heading}` : target) : heading);
        state.push('wiki_close', 'a', -1);
      }
    }
    state.pos = end + 2;
    return true;
  });
}

/** The link at a column of a line (0-based), for Ctrl+click in the source: a note link or a web address. */
export function linkAt(line: string, col: number): { link?: Pick<NoteLink, 'target' | 'heading' | 'wiki'>; url?: string } | null {
  for (const m of line.matchAll(/!?\[\[([^[\]\n]+?)\]\]/g)) {
    if (col < m.index! || col > m.index! + m[0].length) continue;
    const ref = m[1].split('|')[0];
    const hash = ref.indexOf('#');
    return { link: { target: (hash >= 0 ? ref.slice(0, hash) : ref).trim(), heading: hash >= 0 ? ref.slice(hash + 1).trim() || undefined : undefined, wiki: true } };
  }
  for (const m of line.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g)) {
    if (col < m.index! || col > m.index! + m[0].length) continue;
    const href = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return { url: href };
    const hash = href.indexOf('#');
    let p = hash >= 0 ? href.slice(0, hash) : href;
    try {
      p = decodeURIComponent(p);
    } catch {
      /* as written */
    }
    return { link: { target: p, heading: hash >= 0 ? href.slice(hash + 1) || undefined : undefined, wiki: false } };
  }
  for (const m of line.matchAll(/\bhttps?:\/\/[^\s<>()\]]+/g)) {
    if (col >= m.index! && col <= m.index! + m[0].length) return { url: m[0] };
  }
  return null;
}
