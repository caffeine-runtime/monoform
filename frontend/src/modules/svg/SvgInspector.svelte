<script lang="ts">
  // Properties of the selected SVG element (colours, stroke, geometry, text,
  // every attribute), arrange/duplicate/delete, defaults for new shapes, and
  // an outline of the document to select from.
  import { attr, duplicate, moveSibling, removeEl, setAttr, setAttrs, setContent, type Change, type El } from './svgdoc';
  import { t } from '../../core/i18n';

  let {
    text,
    els,
    selected = $bindable(),
    style = $bindable(),
    onchange,
  }: {
    text: string;
    els: El[];
    selected: number | null;
    style: { fill: string; stroke: string; strokeWidth: number };
    onchange: (changes: Change[], select?: number | null) => void;
  } = $props();

  const el = $derived(selected !== null ? (els[selected] ?? null) : null);

  const GEOMETRY: Record<string, string[]> = {
    rect: ['x', 'y', 'width', 'height', 'rx'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    text: ['x', 'y', 'font-size', 'font-family'],
    image: ['x', 'y', 'width', 'height'],
    use: ['x', 'y'],
    svg: ['width', 'height', 'viewBox'],
  };
  const SHOWN = new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'id', 'style', 'd', 'points']);

  /** Any CSS colour → #rrggbb for the colour input (keeps 'none'). */
  const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  function hex(v: string | null): string {
    if (!v || v === 'none' || !probe) return '#000000';
    probe.fillStyle = '#000000';
    probe.fillStyle = v;
    const s = String(probe.fillStyle);
    return s.startsWith('#') ? s : '#000000';
  }

  /** A presentation value from the style attribute if it sets it, else the attribute. */
  function prop(e: El, name: string): string | null {
    const st = attr(e, 'style');
    const m = st && new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(st);
    return m ? m[1].trim() : attr(e, name);
  }

  /** Set a presentation value where it is defined (style wins over attributes in SVG). */
  function setProp(e: El, name: string, value: string | null) {
    const st = attr(e, 'style');
    if (st && new RegExp(`(?:^|;)\\s*${name}\\s*:`).test(st)) {
      const parts = st
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => !x.startsWith(`${name}:`) && !x.startsWith(`${name} :`));
      if (value !== null) parts.push(`${name}:${value}`);
      const c = setAttr(text, e, 'style', parts.join(';') || null);
      if (c) onchange([c], e.index);
      return;
    }
    const c = setAttr(text, e, name, value);
    if (c) onchange([c], e.index);
  }

  function set(name: string, value: string | null) {
    if (!el) return;
    const c = setAttr(text, el, name, value === '' ? null : value);
    if (c) onchange([c], el.index);
  }

  const outline = $derived(els.slice(1).map((e) => ({ e, label: `${e.tag}${attr(e, 'id') ? ` #${attr(e, 'id')}` : ''}` })));
  const ids = $derived(new Set(els.map((e) => attr(e, 'id')).filter((x): x is string => !!x)));
  const content = $derived(el && (el.tag === 'text' || el.tag === 'tspan') && !els.some((x) => x.parent === el.index) ? text.slice(el.tagEnd, el.closeStart).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null);
  let newAttr = $state('');

  const val = (e: Event) => (e.target as HTMLInputElement).value;
</script>

<aside data-sidepanel class="inspector" aria-label={t('Properties')}>
  {#if el && el.index > 0}
    <div class="head">
      <strong>&lt;{el.tag}&gt;</strong>
      <input class="input id" placeholder="id" value={attr(el, 'id') ?? ''} aria-label="id" onchange={(e) => set('id', val(e))} /><!-- i18n-ignore: the SVG attribute name -->
    </div>
    <h4>{t('Appearance')}</h4>
    <div class="grid">
      {#each [['fill', t('Fill'), t('Fill colour')], ['stroke', t('Stroke'), t('Stroke colour')]] as [k, label, colourLabel] (k)}
        {@const v = prop(el, k)}
        <span>{label}</span>
        <span class="row">
          <input type="color" value={hex(v)} disabled={v === 'none'} aria-label={colourLabel} onchange={(e) => setProp(el, k, val(e))} />
          <label class="chk"><input type="checkbox" checked={v === 'none'} onchange={(e) => setProp(el, k, (e.target as HTMLInputElement).checked ? 'none' : '#000000')} /> {t('none', {}, 'paint')}</label>
          {#if v && v !== 'none' && !v.startsWith('#')}<span class="muted mono">{v}</span>{/if}
        </span>
      {/each}
      <label for="sw">{t('Stroke width')}</label>
      <input id="sw" class="input num" type="number" min="0" step="0.5" value={prop(el, 'stroke-width') ?? ''} placeholder="1" onchange={(e) => setProp(el, 'stroke-width', val(e) || null)} />
      <label for="op">{t('Opacity')}</label>
      <span class="row"><input id="op" type="range" min="0" max="1" step="0.05" value={prop(el, 'opacity') ?? '1'} onchange={(e) => setProp(el, 'opacity', val(e) === '1' ? null : val(e))} /> {Math.round(+(prop(el, 'opacity') ?? 1) * 100)}%</span>
    </div>
    {#if GEOMETRY[el.tag]}
      <h4>{t('Geometry')}</h4>
      <div class="grid">
        {#each GEOMETRY[el.tag] as k (k)}
          <label for="g-{k}">{k}</label>
          <input id="g-{k}" class="input" value={attr(el, k) ?? ''} onchange={(e) => set(k, val(e))} />
        {/each}
      </div>
    {/if}
    {#if el.tag === 'path' || el.tag === 'polygon' || el.tag === 'polyline'}
      <h4>{el.tag === 'path' ? t('Path data (d)') : t('Points')}</h4>
      <textarea class="input code" rows="4" value={attr(el, el.tag === 'path' ? 'd' : 'points') ?? ''} onchange={(e) => set(el.tag === 'path' ? 'd' : 'points', (e.target as HTMLTextAreaElement).value)}></textarea>
    {/if}
    {#if content !== null}
      <h4>{t('Text')}</h4>
      <input class="input" value={content} aria-label={t('Text')} onchange={(e) => {
        const c = setContent(text, el, val(e));
        if (c) onchange([c], el.index);
      }} />
    {/if}
    {#if attr(el, 'transform')}
      <h4>{t('Transform')}</h4>
      <div class="row"><span class="mono small">{attr(el, 'transform')}</span><button class="btn ghost sm" title={t('Remove the move/scale/rotation')} onclick={() => set('transform', null)}>{t('Reset')}</button></div>
    {/if}
    <h4>{t('Arrange')}</h4>
    <div class="btns">
      <button class="btn ghost sm" title={t('Bring forward (drawn later)')} onclick={() => { const c = moveSibling(text, el, els, 1); if (c) onchange(c, null); }}>{t('Forward')}</button>
      <button class="btn ghost sm" title={t('Send backward (drawn earlier)')} onclick={() => { const c = moveSibling(text, el, els, -1); if (c) onchange(c, null); }}>{t('Backward')}</button>
      <button class="btn ghost sm" title={t('Duplicate ({key})', { key: 'Ctrl+D' })} onclick={() => onchange([duplicate(text, el, new Set(ids))], null)}>{t('Duplicate')}</button>
      <button class="btn ghost sm" title={t('Select the group containing this')} disabled={el.parent <= 0} onclick={() => (selected = el.parent)}>{t('Parent')}</button>
      <button class="btn ghost sm danger" title={t('Delete ({key})', { key: 'Del' })} onclick={() => onchange([removeEl(text, el)], null)}>{t('Delete')}</button>
    </div>
    <h4>{t('All attributes')}</h4>
    <div class="grid attrs">
      {#each el.attrs.filter((a) => !SHOWN.has(a.name) && !(GEOMETRY[el.tag] ?? []).includes(a.name)) as a (a.name)}
        <span class="mono small" title={a.name}>{a.name}</span>
        <span class="row"><input class="input" value={attr(el, a.name) ?? ''} onchange={(e) => set(a.name, val(e))} /><button class="x" title={t('Remove')} onclick={() => set(a.name, null)}>×</button></span>
      {/each}
      <input class="input" placeholder={t('new attribute')} bind:value={newAttr} aria-label={t('New attribute name')} />
      <button class="btn ghost sm" disabled={!/^[a-zA-Z_:][-\w:.]*$/.test(newAttr)} onclick={() => { const c = setAttrs(text, el, { [newAttr]: '' }); onchange(c, el.index); newAttr = ''; }}>{t('Add')}</button>
    </div>
  {:else}
    <h4>{t('New shapes')}</h4>
    <div class="grid">
      <span>{t('Fill')}</span>
      <span class="row"><input type="color" value={hex(style.fill)} disabled={style.fill === 'none'} aria-label={t('Fill colour')} oninput={(e) => (style = { ...style, fill: val(e) })} /><label class="chk"><input type="checkbox" checked={style.fill === 'none'} onchange={(e) => (style = { ...style, fill: (e.target as HTMLInputElement).checked ? 'none' : '#4a90d9' })} /> {t('none', {}, 'paint')}</label></span>
      <span>{t('Stroke')}</span>
      <span class="row"><input type="color" value={hex(style.stroke)} disabled={style.stroke === 'none'} aria-label={t('Stroke colour')} oninput={(e) => (style = { ...style, stroke: val(e) })} /><label class="chk"><input type="checkbox" checked={style.stroke === 'none'} onchange={(e) => (style = { ...style, stroke: (e.target as HTMLInputElement).checked ? 'none' : '#222222' })} /> {t('none', {}, 'paint')}</label></span>
      <label for="nsw">{t('Stroke width')}</label>
      <input id="nsw" class="input num" type="number" min="0" step="0.5" value={style.strokeWidth} oninput={(e) => (style = { ...style, strokeWidth: +val(e) })} />
    </div>
    {#if els[0]}
      <h4>{t('Document')}</h4>
      <div class="grid">
        {#each ['width', 'height', 'viewBox'] as k (k)}
          <label for="d-{k}">{k}</label>
          <input id="d-{k}" class="input" value={attr(els[0], k) ?? ''} onchange={(e) => { const c = setAttr(text, els[0], k, val(e) || null); if (c) onchange([c], null); }} />
        {/each}
      </div>
    {/if}
  {/if}
  <h4>{t('Outline')}</h4>
  <div class="outline" role="tree" aria-label={t('Elements')}>
    {#each outline as o (o.e.index)}
      <button class="node" class:sel={o.e.index === selected} role="treeitem" aria-selected={o.e.index === selected} style:padding-left="{6 + (o.e.depth - 1) * 12}px" onclick={() => (selected = o.e.index)}>{o.label}</button>
    {/each}
  </div>
</aside>

<style>
  .inspector {
    width: 260px;
    flex: none;
    overflow-y: auto;
    padding: 6px 12px 12px;
    border-left: 1px solid var(--border-soft);
    background: var(--bg-sidebar);
    font-size: var(--fs-small);
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  .id {
    flex: 1;
    min-width: 0;
  }
  h4 {
    margin: 12px 0 6px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 4px 8px;
    align-items: center;
  }
  .grid .input {
    height: calc(26px * var(--ui-scale));
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row .input {
    flex: 1;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sm {
    padding: 2px 8px;
    font-size: var(--fs-small);
  }
  .danger {
    color: var(--danger);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .small {
    font-size: calc(10.5px * var(--ui-scale));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--text-muted);
  }
  .code {
    width: 100%;
    font-family: var(--font-mono);
    font-size: calc(11px * var(--ui-scale));
    resize: vertical;
  }
  .x {
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .outline {
    display: flex;
    flex-direction: column;
    max-height: 260px;
    overflow-y: auto;
  }
  .node {
    text-align: left;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-family: var(--font-mono);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node:hover {
    background: var(--bg-hover);
  }
  .node.sel {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
