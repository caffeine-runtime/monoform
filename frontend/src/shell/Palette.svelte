<script lang="ts">
  import Icon from './Icon.svelte';
  import { Command as CommandIcon, Clock, TextSearch, Sparkles } from '../core/icons';
  import { onDestroy } from 'svelte';
  import { jobs } from '../core/jobs.svelte';
  import type { Match } from '../core/search.svelte';
  import { semantic, type Hit } from '../core/semantic/semantic.svelte';
  import { commands, type Command } from '../core/commands';
  import { fuzzyFilter, highlightSegments } from '../core/fuzzy';
  import { formatShortcut } from '../core/keys';
  import { basename, dirname, relative, tildify } from '../core/paths';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { ui } from '../core/ui.svelte';
  import { api } from '../core/backend';
  import { boot } from '../core/boot';
  import { iconFor } from '../core/fileicons';

  type Item =
    | { type: 'command'; cmd: Command; label: string; positions: number[] }
    | { type: 'file'; path: string; label: string; detail: string; positions: number[]; recent: boolean }
    | { type: 'match'; path: string; label: string; detail: string; positions: number[]; line: number; col: number; len: number; text: string }
    | { type: 'meaning'; path: string; label: string; detail: string; positions: number[]; line: number; score: number };

  // Meaning hits are kept when close to the best one: scores of unrelated
  // passages sit only ~0.1 below a real match, so a fixed cut-off can't work.
  const MEANING_SPREAD = 0.08;

  const keyOf = (it: Item) => (it.type === 'command' ? 'c:' + it.cmd.id : it.type === 'file' ? 'f:' + it.path : it.type === 'match' ? `m:${it.path}:${it.line}` : `s:${it.path}`);

  let input: HTMLInputElement;
  let listEl: HTMLDivElement;
  let query = $state(ui.paletteQuery);
  let selected = $state(0);
  let folderFiles = $state<string[]>([]);

  $effect(() => {
    input?.focus();
    input?.select();
    semantic.maybeReindex(60_000);
    const root = workspace.folder;
    if (root) {
      api
        .QuickFiles(root, 20000)
        .then((f) => (folderFiles = f ?? []))
        .catch(() => {});
    }
  });

  const commandMode = $derived(query.startsWith('>'));
  const q = $derived(commandMode ? query.slice(1).trim() : query.trim());

  // Text inside files (Go folder search) and, when turned on, by meaning.
  let matches = $state<Match[]>([]);
  let contentJob = '';
  let hits = $state<Hit[] | null>(null);
  let meaningState = $state('');
  let seq = 0;

  function stopContent() {
    if (contentJob) jobs.cancel(contentJob);
    contentJob = '';
  }

  $effect(() => {
    const text = commandMode ? '' : q;
    const root = workspace.folder;
    const my = ++seq;
    matches = [];
    hits = null;
    meaningState = '';
    stopContent();
    if (!root || text.length < 2) return;
    const t1 = setTimeout(() => {
      const found: Match[] = [];
      void jobs.run('Searching', async () => (contentJob = await api.SearchFolder(root, { query: text, caseSensitive: false, wholeWord: false, regex: false, showHidden: settings.value.showHidden, maxResults: 200, maxFileSize: 4 << 20 })), {
        silent: true,
        onData: (items: Match[]) => {
          if (my !== seq) return;
          found.push(...items);
          // First match of each file, best files first (more matches = higher).
          const per = new Map<string, { m: Match; n: number }>();
          for (const m of found) {
            const e = per.get(m.path);
            if (e) e.n++;
            else per.set(m.path, { m, n: 1 });
          }
          matches = [...per.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((e) => e.m);
        },
      });
    }, 120);
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (semantic.usable && text.length >= 3) {
      meaningState = semantic.model === 'ready' ? '' : 'Loading the search model…';
      t2 = setTimeout(() => {
        if (semantic.model === 'ready') meaningState = 'Searching by meaning…';
        semantic
          .search(text, 5)
          .then((h) => {
            if (my !== seq) return;
            hits = h;
            meaningState = '';
          })
          .catch((e) => {
            if (my === seq) meaningState = `Search by meaning failed: ${e instanceof Error ? e.message : e}`;
          });
      }, 350);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  });

  onDestroy(stopContent);

  const items = $derived.by((): { heading: string; items: Item[] }[] => {
    const cmds = commands.available();
    const cmdLabel = (c: Command) => (c.category ? `${c.category}: ${c.title}` : c.title);
    const cmdItems: Item[] = fuzzyFilter(q, cmds, cmdLabel, q ? 50 : 200).map((r) => ({
      type: 'command',
      cmd: r.item,
      label: cmdLabel(r.item),
      positions: r.match.positions,
    }));
    if (commandMode) return [{ heading: 'Commands', items: cmdItems }];

    const recents = settings.value.recents;
    const recentSet = new Set(recents);
    const root = workspace.folder;
    const pool = [...recents, ...folderFiles.filter((f) => !recentSet.has(f))];
    const display = (p: string) => (root && relative(root, p) !== null ? relative(root, p)! : tildify(p, boot.home));
    const fileItems: Item[] = (q ? fuzzyFilter(q, pool, display, 30) : fuzzyFilter('', recents, display, 6)).map((r) => ({
      type: 'file',
      path: r.item,
      label: display(r.item),
      detail: tildify(dirname(r.item), boot.home),
      positions: r.match.positions,
      recent: recentSet.has(r.item),
    }));
    const groups: { heading: string; items: Item[] }[] = [];
    if (!q) {
      if (fileItems.length) groups.push({ heading: 'Recent files', items: fileItems });
      groups.push({ heading: 'Commands', items: cmdItems });
    } else {
      // Show whichever group matches better first.
      const bestCmd = cmdItems.length ? fuzzyFilter(q, [cmdItems[0].label], (s) => s)[0]?.match.score ?? -1e9 : -1e9;
      const bestFile = fileItems.length ? fuzzyFilter(q, [fileItems[0].label], (s) => s)[0]?.match.score ?? -1e9 : -1e9;
      const cg = { heading: 'Commands', items: cmdItems.slice(0, 12) };
      const fg = { heading: 'Files', items: fileItems };
      for (const g of bestFile > bestCmd ? [fg, cg] : [cg, fg]) if (g.items.length) groups.push(g);
      const inFiles: Item[] = matches.map((m) => ({
        type: 'match',
        path: m.path,
        label: `${display(m.path)}:${m.line}`,
        detail: m.text.trim(),
        positions: [],
        line: m.line,
        col: m.col,
        len: m.len,
        text: m.text,
      }));
      if (inFiles.length) groups.push({ heading: 'In files', items: inFiles });
      const top = hits?.[0]?.score ?? 0;
      const meaning: Item[] = (hits ?? [])
        .filter((h) => h.score >= top - MEANING_SPREAD)
        .map((h) => ({ type: 'meaning', path: h.path, label: `${display(h.path)}:${h.line}`, detail: h.snippet, positions: [], line: h.line, score: h.score }));
      if (meaning.length) groups.push({ heading: 'By meaning', items: meaning });
    }
    return groups;
  });

  const flat = $derived(items.flatMap((g) => g.items));

  $effect(() => {
    void q;
    selected = 0;
  });

  function close() {
    ui.paletteOpen = false;
  }

  function choose(it: Item | undefined) {
    if (!it) return;
    close();
    if (it.type === 'command') commands.execute(it.cmd.id);
    else if (it.type === 'match') void workspace.openPath(it.path, { reveal: { line: it.line, col: it.col, text: it.text.slice(it.col - 1, it.col - 1 + it.len) || undefined } });
    else if (it.type === 'meaning') void workspace.openPath(it.path, { reveal: { line: it.line, col: 1 } });
    else void workspace.openPath(it.path);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      selected = Math.min(flat.length - 1, selected + 1);
    } else if (e.key === 'ArrowUp') {
      selected = Math.max(0, selected - 1);
    } else if (e.key === 'PageDown') {
      selected = Math.min(flat.length - 1, selected + 8);
    } else if (e.key === 'PageUp') {
      selected = Math.max(0, selected - 8);
    } else if (e.key === 'Enter') {
      choose(flat[selected]);
    } else if (e.key === 'Escape') {
      close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
    queueMicrotask(() => listEl?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" onclick={close}>
  <div class="palette" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label="Command palette">
    <input
      bind:this={input}
      bind:value={query}
      class="q"
      placeholder="Search files, text and commands…  (type > for commands only)"
      spellcheck="false"
      autocomplete="off"
      onkeydown={keydown}
    />
    <div class="list" bind:this={listEl} role="listbox">
      {#each items as g (g.heading)}
        <div class="heading">{g.heading}</div>
        {#each g.items as it (keyOf(it))}
          {@const idx = flat.indexOf(it)}
          <div class="item" class:sel={idx === selected} role="option" tabindex="-1" aria-selected={idx === selected} onmousemove={() => (selected = idx)} onclick={() => choose(it)}>
            <span class="ico">
              {#if it.type === 'command'}<Icon icon={CommandIcon} size={14} />{:else if it.type === 'match'}<Icon icon={TextSearch} size={14} />{:else if it.type === 'meaning'}<Icon icon={Sparkles} size={14} />{:else if it.recent}<Icon icon={Clock} size={14} />{:else}<Icon icon={iconFor(it.path)} size={14} />{/if}
            </span>
            <span class="label">
              {#each highlightSegments(it.label, it.positions) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
            </span>
            {#if it.type === 'command'}
              {@const sc = commands.shortcutOf(it.cmd.id)}
              {#if sc}<span class="kbd">{formatShortcut(sc)}</span>{/if}
            {:else if it.type === 'match' || it.type === 'meaning'}
              <span class="snip">{it.detail}</span>
            {:else}
              <span class="detail">{it.detail}</span>
            {/if}
          </div>
        {/each}
      {/each}
      {#if meaningState}
        <div class="heading">By meaning</div>
        <div class="pending">{meaningState}</div>
      {/if}
      {#if flat.length === 0 && !meaningState}
        <div class="none">No matching commands or files</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.18);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
  }
  .palette {
    width: min(640px, calc(100vw - 32px));
    max-height: 62vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
    border: 1px solid var(--border-soft);
  }
  .q {
    height: 48px;
    border: none;
    outline: none;
    padding: 0 18px;
    background: transparent;
    font-size: 15px;
    border-bottom: 1px solid var(--border-soft);
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .heading {
    font-size: var(--fs-small);
    color: var(--text-muted);
    padding: 8px 10px 4px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius);
    cursor: pointer;
    white-space: nowrap;
  }
  .item.sel {
    background: var(--bg-hover);
  }
  .ico {
    display: inline-flex;
    color: var(--text-muted);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }
  mark {
    background: none;
    color: var(--accent-text);
    font-weight: 600;
  }
  .detail {
    flex: 1 1 0;
    min-width: 0;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
    font-size: var(--fs-small);
    direction: rtl;
  }
  .snip {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .kbd {
    margin-left: auto;
  }
  .pending {
    padding: 6px 10px 8px 34px;
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .none {
    padding: 18px;
    text-align: center;
    color: var(--text-muted);
  }
</style>
