// Folder search state (kept while the sidebar switches panels).
import { api, errorMessage } from './backend';
import { jobs } from './jobs.svelte';
import { settings } from './settings.svelte';

export interface Match {
  path: string;
  line: number;
  col: number;
  len: number;
  text: string;
  at: number;
}

export interface FileResult {
  path: string;
  matches: Match[];
  open: boolean;
}

class SearchState {
  query = $state('');
  caseSensitive = $state(false);
  wholeWord = $state(false);
  regex = $state(false);
  results = $state<FileResult[]>([]);
  running = $state(false);
  error = $state('');
  summary = $state<{ files: number; matches: number; scanned: number; truncated: boolean; millis: number } | null>(null);
  scanned = $state(0);
  private jobId = '';
  private byPath = new Map<string, FileResult>();

  async run(root: string) {
    this.cancel();
    this.results = [];
    this.byPath.clear();
    this.summary = null;
    this.error = '';
    this.scanned = 0;
    const q = this.query;
    if (!q.trim() || !root) return;
    this.running = true;
    let myId = '';
    try {
      const done = await jobs.run<{ files: number; matches: number; scanned: number; truncated: boolean }>(
        'Searching',
        async () => {
          myId = await api.SearchFolder(root, {
            query: q,
            caseSensitive: this.caseSensitive,
            wholeWord: this.wholeWord,
            regex: this.regex,
            showHidden: settings.value.showHidden,
            maxResults: 5000,
            maxFileSize: 20 << 20,
          });
          this.jobId = myId;
          return myId;
        },
        {
          silent: true,
          onData: (items: Match[]) => {
            if (this.jobId !== myId) return;
            for (const m of items) {
              let fr = this.byPath.get(m.path);
              if (!fr) {
                fr = { path: m.path, matches: [], open: true };
                this.byPath.set(m.path, fr);
                this.results.push(fr);
                fr = this.results[this.results.length - 1];
                this.byPath.set(m.path, fr);
              }
              fr.matches.push(m);
            }
          },
          onProgress: (p) => {
            if (this.jobId === myId) this.scanned = p.done;
          },
        },
      );
      if (this.jobId !== myId) return;
      for (const r of this.results) r.matches.sort((a, b) => a.line - b.line || a.col - b.col);
      this.results.sort((a, b) => a.path.localeCompare(b.path));
      if (done.error && !done.cancelled) this.error = done.error;
      else if (done.result) this.summary = { ...done.result, millis: done.millis };
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      if (this.jobId === myId) {
        this.running = false;
        this.jobId = '';
      }
    }
  }

  cancel() {
    if (this.jobId) {
      jobs.cancel(this.jobId);
      this.jobId = '';
    }
    this.running = false;
  }
}

export const folderSearch = new SearchState();
