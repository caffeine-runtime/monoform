<script lang="ts" module>
  export type NotePanelView = 'outline' | 'backlinks' | 'links';
</script>

<script lang="ts">
  // The Markdown side panel, as in Obsidian: the note's outline, the notes
  // that link here (backlinks, with the line each link is on) and the links
  // going out of it (unresolved ones can be created).
  import OutlineTree from '../../shell/OutlineTree.svelte';
  import type { OutlineItem } from '../../core/textStats';
  import { relative } from '../../core/paths';
  import { backlinks, noteName, resolveLink, type NoteLink } from './links';
  import { noteIndex } from './noteIndex.svelte';
  import { t } from '../../core/i18n';

  let {
    path,
    headings,
    active,
    links,
    view = $bindable<NotePanelView>('outline'),
    floating = false,
    onheading,
    onopen,
    oncreate,
  }: {
    path: string;
    headings: OutlineItem[];
    active: number;
    links: NoteLink[];
    view?: NotePanelView;
    floating?: boolean;
    onheading: (i: number) => void;
    onopen: (path: string, link?: { line?: number; heading?: string }) => void;
    oncreate: (link: NoteLink) => void;
  } = $props();

  const back = $derived.by(() => {
    void noteIndex.version;
    return path ? backlinks(path, noteIndex.notes) : [];
  });
  const backCount = $derived(back.reduce((n, b) => n + b.links.length, 0));
  const out = $derived.by(() => {
    void noteIndex.version;
    const paths = noteIndex.paths();
    const seen = new Set<string>();
    const rows: { link: NoteLink; to: string | null; key: string }[] = [];
    for (const l of links) {
      const to = l.target ? resolveLink(l, path, paths) : path;
      if (to === path && !l.target) continue; // [[#heading]] in the same note
      const key = `${to ?? l.target.toLowerCase()}#${l.heading ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ link: l, to, key });
    }
    return rows;
  });
  const rel = (p: string) => (noteIndex.root ? (relative(noteIndex.root, p) ?? p) : p);

  /** The line with the link marked, for the backlink list. */
  function mark(text: string, target: string): { before: string; hit: string; after: string } {
    const re = /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)/g;
    for (const m of text.matchAll(re)) {
      if (m[0].toLowerCase().includes(target.toLowerCase().replace(/\.md$/i, ''))) return { before: text.slice(0, m.index), hit: m[0], after: text.slice(m.index! + m[0].length) };
    }
    return { before: text, hit: '', after: '' };
  }
</script>

<aside data-sidepanel class="notepanel" class:floating class:right={floating} aria-label={t('Note outline and links')}>
  <div class="seg" role="tablist">
    <button role="tab" class:on={view === 'outline'} aria-selected={view === 'outline'} onclick={() => (view = 'outline')}>{t('Outline')}</button>
    <button role="tab" class:on={view === 'backlinks'} aria-selected={view === 'backlinks'} onclick={() => (view = 'backlinks')}>{t('Backlinks')} <span class="n">{backCount}</span></button>
    <button role="tab" class:on={view === 'links'} aria-selected={view === 'links'} onclick={() => (view = 'links')}>{t('Links')} <span class="n">{out.length}</span></button>
  </div>
  <div class="body">
    {#if view === 'outline'}
      <OutlineTree items={headings} {active} onpick={onheading} empty={t('No headings in this note')} />
    {:else if view === 'backlinks'}
      {#if back.length}
        <ul class="files">
          {#each back as b (b.path)}
            <li>
              <button class="file" title={b.path} onclick={() => onopen(b.path, { line: b.links[0].line })}>
                <span class="name">{noteName(b.path)}</span>
                <span class="where">{rel(b.path)}</span>
              </button>
              <ul class="hits">
                {#each b.links as l, k (k)}
                  {@const m = mark(l.text, l.target)}
                  <li><button class="hit" onclick={() => onopen(b.path, { line: l.line })}>{m.before}<mark>{m.hit}</mark>{m.after}</button></li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">{noteName(noteIndex.root || '') ? t('No notes in {folder} link here yet.', { folder: noteName(noteIndex.root || '') }) : t('No notes in this folder link here yet.')} {t('Link to it with')} <code>[[{noteName(path)}]]</code>.</p>
      {/if}
      {#if noteIndex.truncated}<p class="none">{t('Only the first {n} notes of the folder are searched.', { n: 20000 })}</p>{/if}
    {:else if out.length}
      <ul class="files">
        {#each out as o (o.key)}
          <li>
            {#if o.to}
              <button class="file" title={o.to} onclick={() => onopen(o.to!, { heading: o.link.heading })}>
                <span class="name">{noteName(o.to)}{o.link.heading ? ` › ${o.link.heading}` : ''}</span>
                <span class="where">{rel(o.to)}</span>
              </button>
            {:else}
              <button class="file missing" title={t('No note “{name}” yet — click to create it', { name: o.link.target })} onclick={() => oncreate(o.link)}>
                <span class="name">{o.link.target}</span>
                <span class="where">{t('Not created yet · click to create')}</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">{t("This note doesn't link to other notes. Type")} <code>[[</code> {t('to link one.')}</p>
    {/if}
  </div>
</aside>

<style>
  .notepanel {
    width: 260px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 6px;
    border-bottom: 1px solid var(--border-soft);
  }
  .seg button {
    flex: 1;
    border: none;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-small);
    padding: 4px 2px;
    border-radius: 5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .seg button:hover {
    background: var(--bg-hover);
  }
  .seg button.on {
    background: var(--bg-active);
    color: var(--text);
  }
  .n {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .files {
    padding: 4px;
  }
  .files > li + li {
    margin-top: 4px;
  }
  .file,
  .hit {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .file {
    padding: 4px 6px;
  }
  .file:hover,
  .hit:hover {
    background: var(--bg-hover);
  }
  .name {
    display: block;
    font-weight: 600;
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    display: block;
    color: var(--text-faint);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .missing .name {
    color: var(--text-muted);
    font-style: italic;
  }
  .hits {
    margin: 2px 0 0 6px;
    border-left: 2px solid var(--border-soft);
  }
  .hit {
    padding: 3px 8px;
    font-size: var(--fs-small);
    color: var(--text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  mark {
    background: var(--accent-soft);
    color: var(--text);
    border-radius: 3px;
  }
  .none {
    color: var(--text-muted);
    font-size: var(--fs-small);
    padding: 8px 12px;
    margin: 0;
    line-height: 1.5;
  }
  code {
    font-size: 0.95em;
  }
</style>
