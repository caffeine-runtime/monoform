<script lang="ts">
  // The start page: drop or open something, make something new, and the
  // files you had open recently. (Tools live in the ☰ menu and Ctrl+K.)
  import type { Component } from 'svelte';
  import Icon from './Icon.svelte';
  import { ArrowDownToLine, Braces, FileSpreadsheet, FileText, FolderOpen, Globe, ImageIcon, NotebookPen, PenTool, Table, Type, X } from '../core/icons';
  import { commands } from '../core/commands';
  import { iconFor, kindOf } from '../core/fileicons';
  import { formatShortcut } from '../core/keys';
  import { NEW_KINDS, newFileOfKind } from '../core/newfile';
  import { settings } from '../core/settings.svelte';
  import { workspace } from '../core/tabs.svelte';
  import { basename, dirname, tildify } from '../core/paths';
  import { boot } from '../core/boot';
  import { t } from '../core/i18n';

  // A tile per kind of new file.
  const KIND: Record<string, Component<any>> = {
    markdown: NotebookPen,
    docx: FileText,
    xlsx: FileSpreadsheet,
    csv: Table,
    image: ImageIcon,
    svg: PenTool,
    html: Globe,
    json: Braces,
    text: Type,
  };
  const kinds = NEW_KINDS.filter((k) => KIND[k.kind]);

  const tip = (label: string, id: string) => {
    const sc = commands.shortcutOf(id);
    return sc ? `${label} (${formatShortcut(sc)})` : label;
  };
</script>

<div class="welcome">
  <div class="inner">
    <section class="drop" aria-label={t('Open')}>
      <span class="dropicon"><Icon icon={ArrowDownToLine} size={18} /></span>
      <div class="droptext">
        <strong>{t('Drop files here')}</strong>
        <span>{t('or open something from your computer')}</span>
      </div>
      <div class="dropbtns">
        <button class="btn primary" title={tip(t('Open a file'), 'file.open')} onclick={() => commands.execute('file.open')}><Icon icon={FileText} size={15} /> {t('Open file')}</button>
        <button class="btn" title={tip(t('Open a folder'), 'file.openFolder')} onclick={() => commands.execute('file.openFolder')}><Icon icon={FolderOpen} size={15} /> {t('Open folder')}</button>
      </div>
    </section>

    <h3>{t('Create')}</h3>
    <div class="kinds">
      {#each kinds as k (k.kind)}
        <button class="kind" data-kind={k.kind} title="{k.title} — {k.detail}" onclick={() => void newFileOfKind(undefined, k.kind)}>
          <span class="badge"><Icon icon={KIND[k.kind]} size={17} /></span>
          <span class="kn">{k.label}</span>
        </button>
      {/each}
    </div>

    {#if settings.value.recents.length}
      <h3>{t('Recent')}</h3>
      <div class="recents">
        {#each settings.value.recents.slice(0, 8) as p (p)}
          <div class="rrow">
            <button class="recent" title={p} onclick={() => workspace.openPath(p)}>
              <Icon icon={iconFor(p, kindOf(p))} size={16} />
              <span class="rn">{basename(p)}</span>
              <span class="rd">{tildify(dirname(p), boot.home)}</span>
            </button>
            <button class="rm icon-btn xs" title={t('Remove from recents')} aria-label={t('Remove {name} from recents', { name: basename(p) })} onclick={() => settings.removeRecent(p)}><Icon icon={X} size={12} /></button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome {
    height: 100%;
    overflow: auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .inner {
    width: min(680px, 100%);
    padding: 9vh 24px 40px;
  }
  /* Opening is what most visits are for: a big, friendly target. */
  .drop {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px 16px;
    padding: 18px 20px;
    border: 1.5px dashed var(--border);
    border-radius: 8px;
    background: var(--bg-sidebar);
  }
  .dropicon {
    display: grid;
    place-items: center;
    width: calc(38px * var(--ui-scale));
    height: calc(38px * var(--ui-scale));
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text-muted);
    flex: none;
  }
  .droptext {
    flex: 1 1 12em;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .droptext strong {
    font-size: calc(16px * var(--ui-scale));
    font-weight: 600;
  }
  .droptext span {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .dropbtns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dropbtns .btn {
    height: calc(34px * var(--ui-scale));
    padding: 0 14px;
    border-radius: 5px;
  }
  h3 {
    font-size: calc(13px * var(--ui-scale));
    font-weight: 600;
    letter-spacing: 0.02em;
    margin: 30px 0 12px;
    color: var(--text-muted);
  }
  /* Small tiles in the app's own colours: a cream badge, the name under it. */
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(100px * var(--ui-scale)), 1fr));
    gap: 8px;
  }
  .kind {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 12px 6px 10px;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: var(--text);
    transition:
      background 0.12s var(--ease),
      border-color 0.12s var(--ease);
  }
  .kind:hover {
    background: var(--bg-hover);
    border-color: var(--border);
  }
  .kind:hover .badge {
    color: var(--text);
  }
  .kind:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: calc(34px * var(--ui-scale));
    height: calc(34px * var(--ui-scale));
    border-radius: 5px;
    background: var(--bg-hover);
    color: var(--text-muted);
    transition: color 0.12s var(--ease);
  }
  .kn {
    max-width: 100%;
    font-size: var(--fs-small);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recents {
    display: flex;
    flex-direction: column;
  }
  .rrow {
    position: relative;
  }
  .rrow .rm {
    position: absolute;
    right: -4px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
  }
  .rrow:hover .rm,
  .rrow .rm:focus-visible {
    opacity: 1;
  }
  .rrow:hover .rd {
    visibility: hidden;
  }
  .recent {
    display: flex;
    align-items: center;
    gap: 10px;
    height: calc(34px * var(--ui-scale));
    padding: 0 10px;
    margin: 0 -10px;
    width: calc(100% + 20px);
    border: none;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text);
  }
  .recent :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .recent:hover {
    background: var(--bg-hover);
  }
  .rn {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rd {
    min-width: 0;
    color: var(--text-faint);
    font-size: var(--fs-small);
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
