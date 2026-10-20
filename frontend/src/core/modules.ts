// The module registry. A module is a lazily loaded viewer/editor for some
// file types. Core code never imports a module directly: opening a file picks
// a module by extension (or by MIME type detected in Go) and calls load() the
// first time it is needed, so each module lives in its own chunk.
import type { Component } from 'svelte';
import type { Tab } from './tabs.svelte';
import { extname } from './paths';

export interface ModuleProps {
  tab: Tab;
}

export interface LoadedModule {
  default: Component<ModuleProps>;
}

export interface ModuleDef {
  id: string;
  name: string;
  /** Lower-case extensions without dot (compound like "tar.gz" allowed). */
  extensions: string[];
  /** MIME types (wildcards like "text/*" allowed) matched after detection. */
  mimeTypes: string[];
  /** File names claimed regardless of extension (e.g. /^\.env(\..+)?$/ for .env.local). */
  fileNames?: RegExp;
  /** Higher wins when several modules claim the same extension. */
  priority?: number;
  /** Tool modules (hash, ...) are opened by commands, not by file type. */
  tool?: boolean;
  load: () => Promise<LoadedModule>;
}

export class ModuleRegistry {
  private defs: ModuleDef[] = [];
  private cache = new Map<string, Promise<LoadedModule>>();

  register(def: ModuleDef): () => void {
    this.defs.push(def);
    return () => {
      this.defs = this.defs.filter((d) => d !== def);
      this.cache.delete(def.id);
    };
  }

  all(): ModuleDef[] {
    return [...this.defs];
  }

  get(id: string): ModuleDef | undefined {
    return this.defs.find((d) => d.id === id);
  }

  /** Pick a module by file extension; undefined when no module claims it. */
  forPath(path: string): ModuleDef | undefined {
    const name = path.split(/[\\/]/).pop() ?? path;
    const byName = this.best(this.defs.filter((d) => !d.tool && d.fileNames?.test(name)));
    if (byName) return byName;
    const ext = extname(path);
    if (!ext) return undefined;
    return this.best(this.defs.filter((d) => !d.tool && d.extensions.includes(ext)));
  }

  /** Pick a module by MIME type (after magic-byte detection). */
  forMime(mime: string): ModuleDef | undefined {
    if (!mime) return undefined;
    const exact = this.defs.filter((d) => !d.tool && d.mimeTypes.includes(mime));
    if (exact.length) return this.best(exact);
    const major = mime.split('/')[0] + '/*';
    return this.best(this.defs.filter((d) => !d.tool && d.mimeTypes.includes(major)));
  }

  /** Load (once) and return the module's code. */
  load(id: string): Promise<LoadedModule> {
    let p = this.cache.get(id);
    if (!p) {
      const def = this.get(id);
      if (!def) return Promise.reject(new Error(`unknown module ${id}`));
      p = def.load();
      p.catch(() => this.cache.delete(id));
      this.cache.set(id, p);
    }
    return p;
  }

  isLoaded(id: string): boolean {
    return this.cache.has(id);
  }

  private best(list: ModuleDef[]): ModuleDef | undefined {
    return list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  }
}

export const modules = new ModuleRegistry();
