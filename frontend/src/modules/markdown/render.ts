// Markdown → HTML for the preview. Raw HTML in notes is escaped (html:false),
// relative images load through the app's file endpoint, and links carry
// data attributes the preview uses to open files inside the app.
import MarkdownIt from 'markdown-it';
import { isAbsolute, resolveRelative } from '../../core/paths';
import { kindOfFence } from '../diagram/fence';
import { wikiLinks } from './links';

export interface RenderEnv {
  /** Absolute path of the note, for resolving relative links. */
  base: string;
  /** Session token for /__mf/ URLs. */
  token: string;
}

export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href);
}

export function fileUrlFor(path: string, token: string): string {
  return `/__mf/file?t=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
}

export function createRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
  md.use(wikiLinks);

  // ![[picture.png]]: a picture next to the note.
  md.renderer.rules.wiki_image = (tokens, idx, _options, envIn) => {
    const env = (envIn ?? {}) as unknown as RenderEnv;
    const t = tokens[idx];
    const target = String(t.attrGet('data-wiki-image') ?? '');
    const alt = md.utils.escapeHtml(String(t.attrGet('alt') ?? ''));
    const path = env.base ? (isAbsolute(target) ? target : resolveRelative(env.base, target)) : '';
    return path ? `<img src="${md.utils.escapeHtml(fileUrlFor(path, env.token))}" data-path="${md.utils.escapeHtml(path)}" alt="${alt}" loading="lazy">` : `<span class="wikilink unresolved">${alt}</span>`;
  };

  // Source line numbers on block elements, for scroll sync.
  md.core.ruler.push('source_lines', (state) => {
    for (const t of state.tokens) {
      if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0] + 1));
      if (t.map && (t.type === 'fence' || t.type === 'code_block' || t.type === 'hr')) t.attrSet('data-line', String(t.map[0] + 1));
    }
  });

  // Heading ids so #anchors work.
  md.core.ruler.push('heading_ids', (state) => {
    const seen = new Map<string, number>();
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'heading_open') continue;
      const text = toks[i + 1]?.children?.map((c: { content: string }) => c.content).join('') ?? '';
      let slug = slugify(text);
      const n = seen.get(slug) ?? 0;
      seen.set(slug, n + 1);
      if (n) slug += `-${n}`;
      toks[i].attrSet('id', slug);
    }
  });

  // Mermaid and Graphviz blocks become placeholders the preview draws.
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const kind = kindOfFence(t.info);
    if (!kind) return defaultFence(tokens, idx, options, env, self);
    const line = t.map ? ` data-line="${t.map[0] + 1}"` : '';
    return `<div class="diagram" data-kind="${kind}"${line}><pre class="diagram-src">${md.utils.escapeHtml(t.content)}</pre></div>\n`;
  };

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, envIn, self) => {
    const env = (envIn ?? {}) as unknown as RenderEnv;
    const t = tokens[idx];
    const src = String(t.attrGet('src') ?? '');
    if (src && !isExternal(src) && !src.startsWith('#') && env.base) {
      const path = isAbsolute(src) ? src : resolveRelative(env.base, src.split('#')[0].split('?')[0]);
      t.attrSet('src', fileUrlFor(path, env.token));
      t.attrSet('data-path', path);
    } else if (/^https?:/i.test(src)) {
      // Offline by design: remote images are not fetched.
      t.attrSet('src', '');
      t.attrSet('data-remote', src);
      t.attrSet('title', `Remote image not loaded: ${src}`);
    }
    t.attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, options, envIn, self);
  };

  md.renderer.rules.link_open = (tokens, idx, options, envIn, self) => {
    const env = (envIn ?? {}) as unknown as RenderEnv;
    const t = tokens[idx];
    const href = String(t.attrGet('href') ?? '');
    if (href.startsWith('#')) t.attrSet('data-anchor', href.slice(1));
    else if (isExternal(href)) t.attrSet('data-external', href);
    else if (env.base) {
      const [p, frag] = href.split('#');
      if (p) t.attrSet('data-file', resolveRelative(env.base, p));
      if (frag) t.attrSet('data-anchor', frag);
    }
    t.attrSet('title', href);
    return self.renderToken(tokens, idx, options);
  };

  return md;
}
