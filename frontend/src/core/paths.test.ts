import { describe, expect, it } from 'vitest';
import { basename, dirname, extname, formatBytes, join, relative, resolveRelative, stem, tildify } from './paths';

describe('paths', () => {
  it('handles posix paths', () => {
    expect(basename('/a/b/c.md')).toBe('c.md');
    expect(dirname('/a/b/c.md')).toBe('/a/b');
    expect(dirname('/c.md')).toBe('/');
    expect(join('/a/b', 'assets', 'x.png')).toBe('/a/b/assets/x.png');
    expect(join('/a/b/', '../c.md')).toBe('/a/c.md');
  });
  it('handles windows paths', () => {
    expect(basename('C:\\Users\\me\\notes.md')).toBe('notes.md');
    expect(dirname('C:\\Users\\me\\notes.md')).toBe('C:\\Users\\me');
    expect(dirname('C:\\notes.md')).toBe('C:\\');
    expect(join('C:\\Users\\me', 'assets/x.png')).toBe('C:\\Users\\me\\assets\\x.png');
  });
  it('extensions', () => {
    expect(extname('/x/backup.TAR.GZ')).toBe('tar.gz');
    expect(extname('/x/.bashrc')).toBe('');
    expect(extname('/x/photo.JPG')).toBe('jpg');
    expect(stem('/x/backup.tar.gz')).toBe('backup');
  });
  it('resolves markdown links', () => {
    expect(resolveRelative('/n/a.md', 'b.md')).toBe('/n/b.md');
    expect(resolveRelative('/n/a.md', '../img/x%20y.png')).toBe('/img/x y.png');
    expect(resolveRelative('/n/a.md', '/abs/c.md')).toBe('/abs/c.md');
  });
  it('relative and tildify', () => {
    expect(relative('/root', '/root/a/b')).toBe('a/b');
    expect(relative('/root', '/rootx/a')).toBeNull();
    expect(tildify('/home/u/x', '/home/u')).toBe('~/x');
  });
  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
