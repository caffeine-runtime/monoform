// Path helpers that work for both POSIX and Windows paths.

export function sep(p: string): string {
  return /^[A-Za-z]:\\|^\\\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/';
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return '.';
  if (i === 0) return p[0];
  // Keep "C:\" for a file directly on a drive.
  if (i === 2 && p[1] === ':') return p.slice(0, 3);
  return p.slice(0, i);
}

export function join(dir: string, ...parts: string[]): string {
  const s = sep(dir);
  let out = dir.replace(/[\\/]+$/, '');
  for (const part of parts) {
    for (const seg of part.split(/[\\/]+/)) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out = dirname(out);
      else out = (out.endsWith(s) ? out : out + s) + seg;
    }
  }
  return out || s;
}

/** Lower-case extension without the dot; compound archive extensions kept. */
export function extname(p: string): string {
  const b = basename(p).toLowerCase();
  for (const c of ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst']) if (b.endsWith('.' + c)) return c;
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1) : '';
}

export function stem(p: string): string {
  const b = basename(p);
  const e = extname(p);
  return e ? b.slice(0, b.length - e.length - 1) : b;
}

/** Resolve a relative link (as written in a markdown file) against a file. */
export function resolveRelative(fromFile: string, link: string): string {
  if (isAbsolute(link)) return link;
  return join(dirname(fromFile), decodeURIComponentSafe(link));
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** Path of `p` relative to `root`, or null if outside it. */
export function relative(root: string, p: string): string | null {
  const r = root.replace(/[\\/]+$/, '');
  if (p === r) return '';
  if (p.startsWith(r + '/') || p.startsWith(r + '\\')) return p.slice(r.length + 1);
  return null;
}

/** Shorten a path for display, replacing the home dir with ~. */
export function tildify(p: string, home: string): string {
  if (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))) return '~' + p.slice(home.length);
  return p;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function formatBytes(n: number): string {
  if (!isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
