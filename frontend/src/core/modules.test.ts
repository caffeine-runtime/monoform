import { describe, expect, it, vi } from 'vitest';
import { ModuleRegistry, type LoadedModule } from './modules';

const fake = (): Promise<LoadedModule> => Promise.resolve({ default: (() => {}) as never });

describe('ModuleRegistry', () => {
  it('picks modules by extension and priority', () => {
    const r = new ModuleRegistry();
    r.register({ id: 'text', name: 'Text', extensions: ['txt', 'md', 'json'], mimeTypes: ['text/*'], load: fake });
    r.register({ id: 'md', name: 'Markdown', extensions: ['md'], mimeTypes: ['text/markdown'], priority: 10, load: fake });
    r.register({ id: 'arc', name: 'Archive', extensions: ['zip', 'tar.gz'], mimeTypes: ['application/zip'], load: fake });
    r.register({ id: 'hash', name: 'Hash', extensions: ['txt'], mimeTypes: [], tool: true, load: fake });
    expect(r.forPath('/a/notes.MD')?.id).toBe('md');
    expect(r.forPath('/a/x.txt')?.id).toBe('text');
    expect(r.forPath('/a/b.tar.gz')?.id).toBe('arc');
    expect(r.forPath('/a/noext')).toBeUndefined();
    r.register({ id: 'cfg', name: 'Config', extensions: ['env'], fileNames: /^\.env(\..+)?$/i, mimeTypes: [], load: fake });
    expect(r.forPath('/a/.env')?.id).toBe('cfg');
    expect(r.forPath('C:\\a\\.env.local')?.id).toBe('cfg');
    expect(r.forPath('/a/x.local')).toBeUndefined();
  });

  it('matches MIME types with wildcards', () => {
    const r = new ModuleRegistry();
    r.register({ id: 'text', name: 'Text', extensions: [], mimeTypes: ['text/*'], load: fake });
    r.register({ id: 'pdf', name: 'PDF', extensions: [], mimeTypes: ['application/pdf'], load: fake });
    expect(r.forMime('application/pdf')?.id).toBe('pdf');
    expect(r.forMime('text/x-weird')?.id).toBe('text');
    expect(r.forMime('image/png')).toBeUndefined();
  });

  it('loads lazily and only once', async () => {
    const r = new ModuleRegistry();
    const load = vi.fn(fake);
    r.register({ id: 'x', name: 'X', extensions: ['x'], mimeTypes: [], load });
    expect(load).not.toHaveBeenCalled();
    expect(r.isLoaded('x')).toBe(false);
    await Promise.all([r.load('x'), r.load('x')]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(r.load('nope')).rejects.toThrow();
  });

  it('retries a failed load', async () => {
    const r = new ModuleRegistry();
    let n = 0;
    r.register({ id: 'f', name: 'F', extensions: [], mimeTypes: [], load: () => (n++ === 0 ? Promise.reject(new Error('x')) : fake()) });
    await expect(r.load('f')).rejects.toThrow();
    await new Promise((res) => setTimeout(res));
    await expect(r.load('f')).resolves.toBeTruthy();
  });
});
