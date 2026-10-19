<script lang="ts">
  import Icon from './Icon.svelte';
  import { Command as CommandIcon, Clock, File } from '../core/icons';
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
    | { type: 'file'; path: string; label: string; detail: string; positions: number[]; recent: boolean };

  let input: HTMLInputElement;
  let listEl: HTMLDivElement;
  let query = $state(ui.paletteQuery);
  let selected = $state(0);
  let folderFiles = $state<string[]>([]);

  $effect(() => {
    input?.focus();
    input?.select();
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
      placeholder="Search commands and files…  (type > for commands only)"
      spellcheck="false"
      autocomplete="off"
      onkeydown={keydown}
    />
    <div class="list" bind:this={listEl} role="listbox">
      {#each items as g (g.heading)}
        <div class="heading">{g.heading}</div>
        {#each g.items as it (it.type === 'command' ? 'c:' + it.cmd.id : 'f:' + it.path)}
          {@const idx = flat.indexOf(it)}
          <div class="item" class:sel={idx === selected} role="option" tabindex="-1" aria-selected={idx === selected} onmousemove={() => (selected = idx)} onclick={() => choose(it)}>
            <span class="ico">
              {#if it.type === 'command'}<Icon icon={CommandIcon} size={14} />{:else if it.recent}<Icon icon={Clock} size={14} />{:else}<Icon icon={iconFor(it.path)} size={14} />{/if}
            </span>
            <span class="label">
              {#each highlightSegments(it.label, it.positions) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
            </span>
            {#if it.type === 'command'}
              {@const sc = commands.shortcutOf(it.cmd.id)}
              {#if sc}<span class="kbd">{formatShortcut(sc)}</span>{/if}
            {:else}
              <span class="detail">{it.detail}</span>
            {/if}
          </div>
        {/each}
      {/each}
      {#if flat.length === 0}
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
  .kbd {
    margin-left: auto;
  }
  .none {
    padding: 18px;
    text-align: center;
    color: var(--text-muted);
  }
</style>
