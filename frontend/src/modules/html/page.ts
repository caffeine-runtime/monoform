// Builds the preview document for an HTML file: a Content-Security-Policy
// (no remote content unless allowed, scripts only when enabled, no network
// requests from scripts), a <base> pointing at the file's folder served by
// the read-only page route, and external links disabled. Parsing with
// DOMParser runs nothing.

export interface PageOptions {
  /** URL prefix serving the page's folder, ending in "/". */
  base: string;
  /** App origin (e.g. "wails://wails"), allowed for the folder route. */
  origin: string;
  scripts: boolean;
  remote: boolean;
}

export interface BuiltPage {
  html: string;
  title: string;
  /** Remote resources (http/https) the page references. */
  remoteRefs: number;
  /** External links disabled in the preview. */
  externalLinks: number;
}

const REMOTE = /^(https?:)?\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function csp(o: PageOptions): string {
  const self = o.origin;
  const remote = o.remote ? ' https: http:' : '';
  return [
    "default-src 'none'",
    `img-src ${self} data: blob:${remote}`,
    `style-src ${self} 'unsafe-inline'${remote}`,
    `font-src ${self} data:${remote}`,
    `media-src ${self} data: blob:${remote}`,
    `frame-src ${self}`,
    o.scripts ? `script-src ${self} 'unsafe-inline' 'unsafe-eval'${remote}` : "script-src 'none'",
    o.scripts && o.remote ? 'connect-src https: http:' : "connect-src 'none'",
    "form-action 'none'",
    `base-uri ${self}`,
  ].join('; ');
}

export function buildPage(text: string, o: PageOptions): BuiltPage {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const head = doc.head;
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', csp(o));
  const base = doc.createElement('base');
  base.setAttribute('href', o.base);
  // The page's own <base> would redirect relative URLs outside its folder route.
  doc.querySelectorAll('base').forEach((b) => b.remove());
  head.prepend(meta, base);

  let remoteRefs = 0;
  for (const el of doc.querySelectorAll('[src], link[href], [poster], [srcset]')) {
    for (const attr of ['src', 'href', 'poster', 'srcset']) {
      const v = el.getAttribute(attr);
      if (v && REMOTE.test(v.trim())) remoteRefs++;
    }
  }
  remoteRefs += (text.match(/url\(\s*['"]?(https?:)?\/\//gi) ?? []).length;

  let externalLinks = 0;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href], area[href]')) {
    const href = (a.getAttribute('href') ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    if (REMOTE.test(href) || (SCHEME.test(href) && !/^(data|blob):/i.test(href))) {
      externalLinks++;
      a.setAttribute('data-mf-href', href);
      a.removeAttribute('href');
      a.setAttribute('title', `${href} — use “Open in browser” to follow external links`);
      a.style.cursor = 'not-allowed';
    }
  }
  for (const f of doc.querySelectorAll('form')) f.removeAttribute('action');

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '';
  return { html: doctype + doc.documentElement.outerHTML, title: doc.title, remoteRefs, externalLinks };
}
