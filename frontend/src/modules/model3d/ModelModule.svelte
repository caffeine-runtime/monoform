<script lang="ts">
  import Camera from '@lucide/svelte/icons/camera';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Box from '@lucide/svelte/icons/box';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Focus from '@lucide/svelte/icons/focus';
  import Glasses from '@lucide/svelte/icons/glasses';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { fitBar, isNarrow } from '../../core/fit';
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type * as THREE from 'three';
  import Icon from '../../shell/Icon.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Square from '@lucide/svelte/icons/square';
  import Film from '@lucide/svelte/icons/film';
  import type { Tab } from '../../core/tabs.svelte';
  import { api, saveFile } from '../../core/backend';
  import { dirname, extname, join, stem } from '../../core/paths';
  import { ui, toastError, type MenuItem } from '../../core/ui.svelte';
  import { num, t, tn } from '../../core/i18n';
  import { ModelViewer, type AnimState, type ModelStats } from './viewer';
  import { MAIN_THREAD_EXTS } from './load';
  import { modelViews } from './views';
  import { allNodes, boundsOf, buildParts, listCsv, partsList, shownState, unitsUnder, type ListRow, type PartNode } from './parts';
  import { ClipboardSetText } from '../../wailsjs/runtime/runtime';
  import type { LoadOut } from './loadWorker';

  let { tab }: { tab: Tab } = $props();

  let host = $state<HTMLDivElement>();
  let viewer = $state.raw<ModelViewer | null>(null);
  let loading = $state(true);
  let progress = $state(0);
  let error = $state('');
  let stats = $state<ModelStats | null>(null);
  let anims = $state<{ name: string; duration: number }[]>([]);
  let anim = $state<AnimState>({ index: -1, playing: false, time: 0, duration: 0, speed: 1 });
  let wireframe = $state(false);
  let lighting = $state(true);
  let grid = $state(true);
  let bg = $state<'dark' | 'light'>('dark');
  let loadInfo = $state({ millis: 0, worker: true });
  let loadedIn = '';
  const ext = $derived(extname(tab.name));

  // ---- parts ----
  let parts = $state.raw<PartNode | null>(null);
  let byId = new Map<string, PartNode>();
  let ownerOf = new Map<THREE.Object3D, PartNode>();
  let swatch = $state.raw(new Map<string, string>());
  let dupe = $state.raw(new Map<string, number>());
  /** Parts (that draw something themselves) hidden, or drawn see-through: by id. */
  const hidden = new SvelteSet<string>();
  const ghost = new SvelteSet<string>();
  /** Selected nodes (a part, or an assembly and everything in it). */
  const selected = new SvelteSet<string>();
  const open = new SvelteSet<string>();
  let filter = $state('');
  /** The panel as the assembly tree, or as a parts list (each part once, with how many). */
  let partsView = $state<'tree' | 'list'>('tree');
  let hover = $state<{ text: string; x: number; y: number } | null>(null);
  let bodyW = $state(0);
  const narrow = $derived(isNarrow(bodyW));
  let panelOpen = $state(false);
  let listEl = $state<HTMLDivElement>();
  const unitCount = $derived(parts ? unitsUnder(parts).length : 0);
  const hasParts = $derived(unitCount >= 2);
  const selUnits = $derived.by(() => {
    const out = new Set<PartNode>();
    for (const id of selected) {
      const n = parts && byId.get(id);
      if (n) for (const u of unitsUnder(n)) out.add(u);
    }
    return [...out];
  });

  function setParts(root: PartNode | null) {
    parts = root;
    byId = new Map(allNodes(root).map((n) => [n.id, n]));
    ownerOf = new Map();
    swatch = new Map();
    dupe = new Map();
    for (const n of byId.values()) {
      for (const o of n.own) ownerOf.set(o, n);
      const mesh = unitsUnder(n)[0]?.own.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
      const mat = mesh && (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
      const c = (mat as THREE.MeshStandardMaterial | undefined)?.color;
      if (c) swatch.set(n.id, `#${c.getHexString()}`);
      // Several of the same part side by side: numbered.
      const same = n.parent?.children.filter((s) => label(s) === label(n)) ?? [];
      if (same.length > 1) dupe.set(n.id, same.indexOf(n) + 1);
    }
    // Keep what still exists (a reload); forget the rest.
    for (const set of [hidden, ghost, selected, open]) for (const id of [...set]) if (!byId.has(id)) set.delete(id);
    if (root) open.add(root.id);
  }

  function label(n: PartNode): string {
    if (n.body) return t('Body {n}', { n: n.body });
    return n.name || (n === parts ? tab.title : t('Unnamed part'));
  }

  // The viewer follows the panel.
  $effect(() => {
    if (!viewer || !parts) return;
    const objs = new Set<THREE.Object3D>();
    for (const id of hidden) for (const o of byId.get(id)?.own ?? []) objs.add(o);
    viewer.setHidden(objs);
  });
  $effect(() => {
    if (!viewer || !parts) return;
    const objs = new Set<THREE.Object3D>();
    for (const id of ghost) for (const o of byId.get(id)?.own ?? []) objs.add(o);
    viewer.setGhosted(objs);
  });
  $effect(() => {
    if (!viewer || !parts) return;
    viewer.setSelected(selUnits.flatMap((u) => u.own));
    untrack(updateStatus);
  });

  /** Select a node (or add it / take it out with Shift or Ctrl), and show its row. */
  function select(n: PartNode | null, add = false) {
    if (!add) selected.clear();
    if (!n) return;
    if (add && selected.has(n.id)) selected.delete(n.id);
    else selected.add(n.id);
    for (let p = n.parent; p; p = p.parent) open.add(p.id);
    void tick().then(() => listEl?.querySelector(`[data-part="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  const allUnits = () => (parts ? unitsUnder(parts) : []);

  function hideSelected() {
    if (!selUnits.length) return;
    for (const u of selUnits) hidden.add(u.id);
    selected.clear();
  }
  /** Only the selection stays; with `glass` the rest is drawn see-through instead of hidden. */
  function only(glass = false) {
    if (!selUnits.length) return;
    const keep = new Set(selUnits.map((u) => u.id));
    for (const u of allUnits()) {
      if (keep.has(u.id)) {
        hidden.delete(u.id);
        ghost.delete(u.id);
      } else if (glass) {
        hidden.delete(u.id);
        ghost.add(u.id);
      } else {
        hidden.add(u.id);
        ghost.delete(u.id);
      }
    }
  }
  function showAll() {
    hidden.clear();
    ghost.clear();
  }
  function focusSelection() {
    viewer?.frame(selUnits.flatMap((u) => u.own));
  }
  function toggleShown(n: PartNode) {
    const units = unitsUnder(n);
    if (shownState(n, hidden) === 'shown') for (const u of units) hidden.add(u.id);
    else for (const u of units) hidden.delete(u.id);
  }

  function onPick(o: THREE.Object3D | null, e: PointerEvent) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const n = o ? ownerOf.get(o) ?? null : null;
    if (!n && add) return;
    select(n, add);
  }

  function onHover(o: THREE.Object3D | null, e: PointerEvent) {
    const n = o ? ownerOf.get(o) : undefined;
    if (!n || !hasParts || !host) return void (hover = null);
    const r = host.getBoundingClientRect();
    hover = { text: label(n), x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const list = $derived(parts && partsView === 'list' ? partsList(parts, label) : []);
  const listHead = (): [string, string, string, string, string] => [t('Part'), t('Quantity'), t('Length'), t('Width'), t('Height')];

  function selectRow(r: ListRow, add: boolean) {
    const on = r.nodes.every((n) => selected.has(n.id));
    if (!add) selected.clear();
    for (const n of r.nodes) {
      if (add && on) selected.delete(n.id);
      else selected.add(n.id);
    }
  }

  /** Tab-separated, for pasting into a spreadsheet. */
  async function copyList() {
    const lines = [listHead(), ...list.map((r) => [r.name, String(r.nodes.length), ...r.size.map(fmtLen)])];
    await ClipboardSetText(lines.map((l) => l.join('\t')).join('\n') + '\n').catch(() => {});
    ui.toast(t('Copied'), 'success');
  }

  async function exportList() {
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.csv`);
    let path = await api.SaveFileDialog(t('Export CSV…'), base, [{ name: 'CSV', patterns: '*.csv' }]);
    if (!path) return;
    if (extname(path) !== 'csv') path += '.csv';
    try {
      await saveFile(path, listCsv(list, listHead()));
      ui.toast(t('Saved'), 'success');
    } catch (e) {
      toastError(e);
    }
  }

  const matches = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q || !parts) return null;
    return allNodes(parts).filter((n) => n !== parts && label(n).toLowerCase().includes(q));
  });

  // ---- loading ----

  async function folderBase(): Promise<string> {
    if (!tab.filePath) return `${location.origin}/__mf/page/none/`;
    try {
      return `${location.origin}/__mf/page/${await api.PageRoot(dirname(tab.filePath))}/`;
    } catch {
      return `${location.origin}/__mf/page/none/`;
    }
  }

  let firstLoad = true;

  async function load() {
    loading = true;
    error = '';
    progress = 0;
    const t0 = performance.now();
    try {
      const base = await folderBase();
      let scene, animations;
      if (MAIN_THREAD_EXTS.includes(ext)) {
        // These loaders need DOMParser, which workers lack.
        const [{ loadModel }, { fetchBytes }] = await Promise.all([import('./load'), import('../../core/fetchbytes')]);
        const bytes = await fetchBytes(tab.url(), (d, t) => (progress = d / t));
        ({ scene, animations } = await loadModel(ext, bytes.buffer as ArrayBuffer, base, tab.title));
        loadInfo = { millis: 0, worker: false };
      } else {
        const { default: LoadWorker } = await import('./loadWorker?worker');
        const w = new LoadWorker();
        const out = await new Promise<Extract<LoadOut, { ok: true }>>((resolve, reject) => {
          w.onmessage = (e: MessageEvent<LoadOut>) => {
            const m = e.data;
            if ('progress' in m) progress = m.progress;
            else if (m.ok) resolve(m);
            else reject(new Error(m.error));
          };
          w.onerror = (e) => reject(new Error(e.message || t('could not read the model')));
          w.postMessage({ url: new URL(tab.url(), location.href).href, ext, base, name: tab.title });
        }).finally(() => w.terminate());
        const { unpack } = await import('./transfer');
        ({ scene, animations } = await unpack(out.packed));
        loadInfo = { millis: out.millis, worker: true };
      }
      selected.clear();
      parts = null; // the effects let go of the old model
      await viewer!.setModel(scene, animations);
      setParts(buildParts(scene));
      if (firstLoad) {
        // What was hidden when the session was saved.
        const st = tab.restoredState as { hidden?: string[]; ghost?: string[] } | undefined;
        for (const id of st?.hidden ?? []) if (byId.has(id)) hidden.add(id);
        for (const id of st?.ghost ?? []) if (byId.has(id)) ghost.add(id);
        firstLoad = false;
      }
      if (hidden.size || ghost.size) await tick().then(() => viewer?.frame());
      stats = viewer!.stats();
      anims = viewer!.animations;
      loadedIn = t('loaded in {ms} ms', { ms: Math.round(performance.now() - t0) });
      updateStatus();
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  const fmtLen = (v: number) => num(v, { maximumFractionDigits: v < 10 ? 2 : 1 });

  function updateStatus() {
    const s = stats;
    let info = loadedIn || tab.status.info;
    if (selUnits.length) {
      // Width × depth × height (the model stands Y up here).
      const b = boundsOf(selUnits.flatMap((u) => u.own), true);
      const name = selected.size === 1 ? label(byId.get([...selected][0])!) : tn('{n} part', '{n} parts', selUnits.length);
      info = t('{name} · {w} × {d} × {h}', { name, w: fmtLen(b.max.x - b.min.x), d: fmtLen(b.max.z - b.min.z), h: fmtLen(b.max.y - b.min.y) });
    }
    tab.status = {
      ...tab.status,
      type: t('{format} model', { format: ext.toUpperCase() }),
      position: s ? (s.points && !s.meshes ? tn('{n} points', '{n} points', s.points) : tn('{n} triangles', '{n} triangles', s.triangles)) : undefined,
      info,
    };
  }

  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  function toggle(which: 'wireframe' | 'lighting' | 'grid') {
    if (!viewer) return;
    if (which === 'wireframe') viewer.setWireframe((wireframe = !wireframe));
    else if (which === 'lighting') viewer.setLighting((lighting = !lighting));
    else viewer.setGrid((grid = !grid));
  }

  async function screenshot() {
    if (!viewer) return;
    const base = join(dirname(tab.filePath ?? tab.path ?? ''), `${stem(tab.title)}.png`);
    let path = await api.SaveFileDialog(t('Save view as PNG'), base, [{ name: 'PNG', patterns: '*.png' }]);
    if (!path) return;
    if (extname(path) !== 'png') path += '.png';
    try {
      await saveFile(path, await viewer.screenshot());
      ui.toast(t('View saved'), 'success');
    } catch (e) {
      toastError(e);
    }
  }

  /** Right-click: the part under the pointer (selected, unless it already is) and what to do with it. */
  function contextMenu(e: MouseEvent): MenuItem[] | null {
    if (!hasParts || !viewer || !(e.target as HTMLElement)?.closest?.('.stage')) return null;
    const hit = viewer.pick(e.clientX, e.clientY);
    const n = hit ? ownerOf.get(hit) : undefined;
    if (n && !selUnits.some((u) => unitsUnder(n).includes(u))) select(n);
    const none = !selUnits.length;
    return [
      { label: t('Hide'), shortcut: 'H', disabled: none, run: hideSelected },
      { label: t('Show only this'), shortcut: 'I', disabled: none, run: () => only() },
      { label: t('See-through others'), shortcut: 'X', disabled: none, run: () => only(true) },
      { label: t('Zoom to selection'), shortcut: 'F', disabled: none, run: focusSelection },
      { separator: true },
      { label: t('Show all'), shortcut: 'Alt+H', disabled: !hidden.size && !ghost.size, run: showAll },
    ];
  }

  modelViews.set(tab.id, {
    reset: () => viewer?.frame(),
    toggle,
    play: (i: number) => viewer?.play(i),
    pause: () => viewer?.togglePause(),
    hide: hideSelected,
    only: () => only(),
    seeThrough: () => only(true),
    showAll,
    focus: focusSelection,
    deselect: () => selected.clear(),
    hasSelection: () => selUnits.length > 0,
    hasHidden: () => hidden.size + ghost.size > 0,
  });

  onMount(() => {
    try {
      viewer = new ModelViewer(host!);
    } catch (e) {
      error = t('3D needs WebGL, which is not available here ({error}).', { error: (e as Error).message });
      loading = false;
      return;
    }
    partsView = (tab.restoredState as { partsView?: 'tree' | 'list' } | undefined)?.partsView ?? 'tree';
    viewer.onAnim = (a) => (anim = a);
    viewer.onPick = onPick;
    viewer.onHover = onHover;
    tab.handlers = {
      ...tab.handlers,
      reload: load,
      onShow: () => (viewer?.attach(), updateStatus()),
      getState: () => (hidden.size || ghost.size || partsView !== 'tree' ? { hidden: [...hidden], ghost: [...ghost], ...(partsView !== 'tree' ? { partsView } : {}) } : undefined),
      contextMenu,
    };
    void load();
    return () => {
      modelViews.delete(tab.id);
      viewer?.destroy();
    };
  });

  (tab as unknown as { modelTest: unknown }).modelTest = {
    viewer: () => viewer,
    stats: () => stats,
    anims: () => anims,
    anim: () => anim,
    loading: () => loading,
    error: () => error,
    loadInfo: () => loadInfo,
    toggle,
    parts: () => parts,
    hidden: () => hidden,
    ghost: () => ghost,
    selected: () => selected,
    select,
    setView: (v: 'tree' | 'list') => (partsView = v),
    list: () => list,
  };
</script>

{#snippet row(n: PartNode, depth: number)}
  {@const state = shownState(n, hidden)}
  {@const glass = unitsUnder(n).every((u) => ghost.has(u.id))}
  <div class="part" class:sel={selected.has(n.id)} class:off={state === 'hidden'} class:glass data-part={n.id} style:padding-left="{4 + depth * 14}px">
    {#if n.children.length && !matches}
      <button class="icon-btn xs" title={open.has(n.id) ? t('Collapse') : t('Expand')} onclick={() => (open.has(n.id) ? open.delete(n.id) : open.add(n.id))}><Icon icon={open.has(n.id) ? ChevronDown : ChevronRight} size={13} /></button>
    {:else}
      <span class="indent"></span>
    {/if}
    <button class="icon-btn xs eye" class:mixed={state === 'mixed'} title={state === 'shown' ? t('Hide') : t('Show')} onclick={() => toggleShown(n)}><Icon icon={state === 'hidden' ? EyeOff : Eye} size={13} /></button>
    {#if swatch.get(n.id)}<span class="sw" style:background={swatch.get(n.id)}></span>{/if}
    <button class="name" title={label(n)} onclick={(e) => select(n, e.shiftKey || e.ctrlKey || e.metaKey)} ondblclick={() => (select(n), focusSelection())}>{label(n)}{#if dupe.get(n.id)}<span class="nth"> #{dupe.get(n.id)}</span>{/if}</button>
    {#if n.children.length}<span class="count" title={tn('{n} part', '{n} parts', unitsUnder(n).length)}>{num(unitsUnder(n).length)}</span>{/if}
  </div>
  {#if n.children.length && open.has(n.id) && !matches}
    {#each n.children as c (c.id)}{@render row(c, depth + 1)}{/each}
  {/if}
{/snippet}

<div class="toolbar" use:fitBar>
  <button class="btn ghost" class:on={wireframe} title="{t('Wireframe')} (W)" onclick={() => toggle('wireframe')}><Icon icon={Box} size={14} /> {t('Wireframe')}</button>
  <button class="btn ghost" class:on={lighting} title={t('Lighting on/off (L) — off shows flat, unlit colours')} onclick={() => toggle('lighting')}><Icon icon={Lightbulb} size={14} /> {t('Lighting')}</button>
  <button class="btn ghost" class:on={grid} title="{t('Floor grid')} (G)" onclick={() => toggle('grid')}><Icon icon={Grid3x3} size={14} /> {t('Grid')}</button>
  <span class="sep"></span>
  <div class="seg" role="group" aria-label={t('Background')}>
    <button class="btn ghost" class:on={bg === 'dark'} title={t('Dark background')} onclick={() => viewer?.setBackground((bg = 'dark'))}><Icon icon={Moon} size={14} /></button>
    <button class="btn ghost" class:on={bg === 'light'} title={t('Light background')} onclick={() => viewer?.setBackground((bg = 'light'))}><Icon icon={Sun} size={14} /></button>
  </div>
  <span class="spacer"></span>
  {#if stats}
    <span class="label">{stats.meshes ? `${tn('{n} mesh', '{n} meshes', stats.meshes)} · ${tn('{n} vertices', '{n} vertices', stats.vertices)}` : ''}{stats.points ? ` · ${tn('{n} points', '{n} points', stats.points)}` : ''}{stats.materials ? ` · ${tn('{n} material', '{n} materials', stats.materials)}` : ''}{stats.bones ? ` · ${tn('{n} bones', '{n} bones', stats.bones)}` : ''}</span>
    <span class="sep"></span>
  {/if}
  <button class="btn ghost" title="{t('Reset view')} (0)" onclick={() => viewer?.frame()}><Icon icon={RotateCcw} size={14} /> {t('Reset view')}</button>
  <button class="btn ghost" title={t('Save the current view as PNG')} onclick={screenshot}><Icon icon={Camera} size={14} /> {t('Screenshot…')}</button>
  {#if narrow && (hasParts || anims.length)}<button class="icon-btn" class:on={panelOpen} title={t('Parts')} onclick={() => (panelOpen = !panelOpen)}><Icon icon={PanelRight} /></button>{/if}
</div>

<div class="body" bind:clientWidth={bodyW}>
  <div class="stage" bind:this={host}>
    {#if loading}
      <div class="empty-state overlay">
        <span class="spinner"></span>
        {#if progress > 0 && progress < 1}<span class="muted">{Math.round(progress * 100)}%</span>{/if}
      </div>
    {/if}
    {#if error}<div class="empty-state overlay err">{error}</div>{/if}
    {#if hover}<div class="tip" style:left="{hover.x + 14}px" style:top="{hover.y + 14}px">{hover.text}</div>{/if}
  </div>
  {#if (hasParts || anims.length) && (!narrow || panelOpen)}
    <aside data-sidepanel class="side" class:floating={narrow} class:right={narrow} aria-label={hasParts ? t('Parts') : t('Animations')}>
      {#if hasParts && parts}
        <section class="parts">
          <div class="phead">
            <h4><Icon icon={Boxes} size={14} /> {t('Parts ({n})', { n: unitCount })}</h4>
            <div class="seg small" role="group" aria-label={t('Parts')}>
              <button class="btn ghost" class:on={partsView === 'tree'} onclick={() => (partsView = 'tree')}>{t('Tree')}</button>
              <button class="btn ghost" class:on={partsView === 'list'} onclick={() => (partsView = 'list')}>{t('List')}</button>
            </div>
          </div>
          {#if partsView === 'list'}
            <div class="listbar">
              <button class="btn ghost" onclick={copyList}>{t('Copy list')}</button>
              <button class="btn ghost" onclick={exportList}>{t('Export CSV…')}</button>
            </div>
          {:else if unitCount > 8}<input class="input filter" type="search" placeholder={t('Find a part')} bind:value={filter} spellcheck="false" />{/if}
          <div class="list" bind:this={listEl}>
            {#if partsView === 'list'}
              {#each list as r, i (i)}
                <button class="bom" class:sel={r.nodes.every((n) => selected.has(n.id))} title={r.name} onclick={(e) => selectRow(r, e.shiftKey || e.ctrlKey || e.metaKey)} ondblclick={() => (selectRow(r, false), focusSelection())}>
                  <span class="what"><span class="nm">{r.name}</span><span class="dims">{r.size.map(fmtLen).join(' × ')}</span></span>
                  <span class="qty">×{num(r.nodes.length)}</span>
                </button>
              {/each}
            {:else if matches}
              {#each matches as n (n.id)}{@render row(n, 0)}{/each}
              {#if !matches.length}<p class="muted none">{t('No part is called that.')}</p>{/if}
            {:else}
              {@render row(parts, 0)}
            {/if}
          </div>
          <div class="actions">
            <button class="icon-btn" title="{t('Hide')} (H)" disabled={!selUnits.length} onclick={hideSelected}><Icon icon={EyeOff} size={15} /></button>
            <button class="icon-btn" title="{t('Show only this')} (I)" disabled={!selUnits.length} onclick={() => only()}><Icon icon={Focus} size={15} /></button>
            <button class="icon-btn" title="{t('See-through others')} (X)" disabled={!selUnits.length} onclick={() => only(true)}><Icon icon={Glasses} size={15} /></button>
            <button class="icon-btn" title="{t('Zoom to selection')} (F)" disabled={!selUnits.length} onclick={focusSelection}><Icon icon={ScanSearch} size={15} /></button>
            <span class="spacer"></span>
            <button class="btn ghost" title="{t('Show all')} (Alt+H)" disabled={!hidden.size && !ghost.size} onclick={showAll}><Icon icon={Eye} size={14} /> {t('Show all')}</button><!-- i18n-ignore -->
          </div>
        </section>
      {/if}
      {#if anims.length}
        <section class="anims">
          <h4><Icon icon={Film} size={14} /> {t('Animations ({n})', { n: anims.length })}</h4>
          <div class="list" role="listbox">
            {#each anims as a, i (i)}
              <button class="clip" class:on={anim.index === i} role="option" aria-selected={anim.index === i} onclick={() => viewer?.play(i)} title={t('Play {name}', { name: a.name })}>
                <span class="ico"><Icon icon={anim.index === i && anim.playing ? Pause : Play} size={13} /></span>
                <span class="nm">{a.name}</span>
                <span class="dur">{a.duration.toFixed(1)} s</span>
              </button>
            {/each}
          </div>
          {#if anim.index >= 0}
            <div class="transport">
              <input type="range" min="0" max={anim.duration} step="0.01" value={anim.time} oninput={(e) => viewer?.seek(+(e.target as HTMLInputElement).value)} aria-label={t('Animation time')} />
              <div class="row">
                <button class="icon-btn" title={anim.playing ? t('Pause') : t('Play')} onclick={() => viewer?.togglePause()}><Icon icon={anim.playing ? Pause : Play} size={14} /></button>
                <button class="icon-btn" title={t('Stop')} onclick={() => viewer?.stopAnimation()}><Icon icon={Square} size={14} /></button>
                <span class="t">{fmtTime(anim.time)} / {fmtTime(anim.duration)}</span>
                <select value={String(anim.speed)} onchange={(e) => viewer?.setSpeed(+(e.target as HTMLSelectElement).value)} title={t('Speed')}>
                  {#each [0.25, 0.5, 1, 1.5, 2] as s (s)}<option value={String(s)}>{s}×</option>{/each}
                </select>
              </div>
            </div>
          {/if}
        </section>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .stage {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .stage :global(canvas) {
    display: block;
  }
  .overlay {
    position: absolute;
    inset: 0;
    gap: 8px;
  }
  .err {
    color: var(--danger);
  }
  .tip {
    position: absolute;
    z-index: 5;
    max-width: 320px;
    padding: 3px 8px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow);
    font-size: var(--fs-small);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .side {
    width: calc(260px * var(--ui-scale));
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border-soft);
    min-height: 0;
  }
  .parts {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .anims {
    flex: none;
    max-height: 45%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .parts + .anims {
    border-top: 1px solid var(--border-soft);
  }
  h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 10px 12px;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .filter {
    margin: 0 8px 6px;
  }
  .phead {
    display: flex;
    align-items: center;
    padding-right: 8px;
  }
  .phead h4 {
    flex: 1;
  }
  .seg.small .btn {
    height: calc(24px * var(--ui-scale));
    padding: 0 8px;
    font-size: var(--fs-small);
  }
  .listbar {
    display: flex;
    gap: 2px;
    padding: 0 6px 6px;
  }
  .bom {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .bom:hover {
    background: var(--bg-hover);
  }
  .bom.sel {
    background: var(--accent-soft);
  }
  .bom .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .bom .dims {
    color: var(--text-faint);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  .bom .qty {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 6px;
  }
  .none {
    padding: 6px 8px;
    margin: 0;
  }
  .part {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 4px;
    border-radius: var(--radius);
  }
  .part:hover {
    background: var(--bg-hover);
  }
  .part.sel {
    background: var(--accent-soft);
  }
  .part.off .name,
  .part.off .sw {
    opacity: 0.45;
  }
  .part.glass .name {
    color: var(--text-muted);
    font-style: italic;
  }
  .icon-btn.xs {
    width: 20px;
    height: 22px;
    flex: none;
  }
  .indent {
    width: 20px;
    flex: none;
  }
  .eye.mixed {
    opacity: 0.55;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    border: 1px solid var(--border);
    flex: none;
  }
  .part .name {
    flex: 1;
    min-width: 0;
    padding: 4px 2px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nth,
  .count {
    color: var(--text-faint);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-top: 1px solid var(--border-soft);
  }
  .actions .spacer {
    flex: 1;
  }
  .clip {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .clip:hover {
    background: var(--bg-hover);
  }
  .clip.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ico {
    display: inline-flex;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dur {
    color: var(--text-faint);
    font-size: var(--fs-small);
  }
  .transport {
    padding: 8px 10px;
    border-top: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .transport input {
    width: 100%;
    accent-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .t {
    flex: 1;
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
