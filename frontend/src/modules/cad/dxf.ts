// DXF (ASCII) reader. Keeps every group's line position so edits can patch
// the original text (writer.ts) and leave everything we don't understand
// untouched. Handles the entities most drawings use: LINE, LWPOLYLINE,
// POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, POINT, SOLID,
// 3DFACE, HATCH (boundary), INSERT (blocks, nested) and DIMENSION (via its
// block). Pure; unit-tested.

export interface Group {
  code: number;
  value: string;
  line: number; // index of the code line (the value is on line + 1)
}

export interface Entity {
  type: string;
  groups: Group[];
  start: number; // first line (the "0" code line)
  end: number; // line after the entity (and its VERTEX/SEQEND/ATTRIB followers)
  layer: string;
  color: number; // ACI (256 = by layer, 0 = by block); trueColor wins when set
  trueColor: number | null; // 0xRRGGBB
  handle: string | null;
  /** POLYLINE vertices / INSERT attributes come as following entities. */
  children: Entity[];
  /** Index in the ENTITIES section (model space), or -1 inside a block. */
  index: number;
}

export interface Layer {
  name: string;
  color: number; // negative = off
  trueColor: number | null;
  frozen: boolean;
  locked: boolean;
  lineType: string;
}

export interface Block {
  name: string;
  base: [number, number];
  entities: Entity[];
}

export interface Drawing {
  lines: string[];
  eol: string;
  version: string;
  units: number; // $INSUNITS
  layers: Map<string, Layer>;
  blocks: Map<string, Block>;
  entities: Entity[];
  /** Line index of ENDSEC of the ENTITIES section (where new entities go). */
  entitiesEnd: number;
  handseed: { line: number; value: string } | null;
  modelSpaceHandle: string | null;
  bounds: { min: [number, number]; max: [number, number] } | null;
}

/** Group value as a number (NaN when it isn't one). */
export const num = (e: Entity, code: number, i = 0): number => {
  const g = e.groups.filter((x) => x.code === code)[i];
  return g ? parseFloat(g.value) : NaN;
};
export const str = (e: Entity, code: number): string => e.groups.find((x) => x.code === code)?.value ?? '';

export function parse(text: string): Drawing {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF isn’t supported; save it as ASCII DXF.');
  return parseLines(text.split(/\r?\n/), text.includes('\r\n') ? '\r\n' : '\n');
}

/** Parse already split lines (after an edit, without joining and splitting again). */
export function parseLines(lines: string[], eol: string): Drawing {
  // Pair lines into groups.
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error(`Not a DXF file (line ${i + 1}: "${lines[i].slice(0, 30)}")`);
    groups.push({ code, value: lines[i + 1].trim(), line: i });
  }
  const d: Drawing = { lines, eol, version: '', units: 0, layers: new Map(), blocks: new Map(), entities: [], entitiesEnd: -1, handseed: null, modelSpaceHandle: null, bounds: null };
  let section = '';
  let i = 0;
  const n = groups.length;
  while (i < n) {
    const g = groups[i];
    if (g.code === 0 && g.value === 'SECTION') {
      section = groups[i + 1]?.value ?? '';
      i += 2;
      continue;
    }
    if (g.code === 0 && g.value === 'ENDSEC') {
      if (section === 'ENTITIES') d.entitiesEnd = g.line;
      section = '';
      i++;
      continue;
    }
    if (g.code === 0 && g.value === 'EOF') break;
    if (section === 'HEADER' && g.code === 9) {
      const name = g.value;
      const v = groups[i + 1];
      if (name === '$ACADVER' && v) d.version = v.value;
      else if (name === '$INSUNITS' && v) d.units = parseInt(v.value, 10) || 0;
      else if (name === '$HANDSEED' && v) d.handseed = { line: v.line, value: v.value };
      else if (name === '$EXTMIN' || name === '$EXTMAX') {
        const x = parseFloat(groups[i + 1]?.value);
        const y = parseFloat(groups[i + 2]?.value);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          d.bounds ??= { min: [x, y], max: [x, y] };
          if (name === '$EXTMIN') d.bounds.min = [x, y];
          else d.bounds.max = [x, y];
        }
      }
      i++;
      continue;
    }
    if (section === 'TABLES' && g.code === 0 && (g.value === 'LAYER' || g.value === 'BLOCK_RECORD')) {
      const kind = g.value;
      let j = i + 1;
      const own: Group[] = [];
      while (j < n && groups[j].code !== 0) own.push(groups[j++]);
      const get = (c: number) => own.find((x) => x.code === c)?.value;
      if (kind === 'LAYER' && get(2) !== undefined) {
        const flags = parseInt(get(70) ?? '0', 10);
        const tc = get(420);
        d.layers.set(get(2)!, { name: get(2)!, color: parseInt(get(62) ?? '7', 10), trueColor: tc ? parseInt(tc, 10) : null, frozen: !!(flags & 1), locked: !!(flags & 4), lineType: get(6) ?? 'CONTINUOUS' });
      } else if (kind === 'BLOCK_RECORD' && /^\*model_space$/i.test(get(2) ?? '')) d.modelSpaceHandle = get(5) ?? null;
      i = j;
      continue;
    }
    if (section === 'BLOCKS' && g.code === 0 && g.value === 'BLOCK') {
      let j = i + 1;
      const own: Group[] = [];
      while (j < n && groups[j].code !== 0) own.push(groups[j++]);
      const name = own.find((x) => x.code === 2)?.value ?? '';
      const bx = parseFloat(own.find((x) => x.code === 10)?.value ?? '0');
      const by = parseFloat(own.find((x) => x.code === 20)?.value ?? '0');
      const ents: Entity[] = [];
      while (j < n && !(groups[j].code === 0 && groups[j].value === 'ENDBLK')) {
        const [e, next] = readEntity(groups, j, -1);
        if (e) ents.push(e);
        j = next;
      }
      d.blocks.set(name, { name, base: [bx || 0, by || 0], entities: ents });
      i = j + 1;
      continue;
    }
    if (section === 'ENTITIES' && g.code === 0) {
      const [e, next] = readEntity(groups, i, d.entities.length);
      if (e) d.entities.push(e);
      i = next;
      continue;
    }
    i++;
  }
  if (d.entitiesEnd < 0) throw new Error('This DXF has no ENTITIES section.');
  return d;
}

/** One entity (with its VERTEX/ATTRIB followers up to SEQEND) starting at group i. */
function readEntity(groups: Group[], i: number, index: number): [Entity | null, number] {
  const head = groups[i];
  const type = head.value;
  let j = i + 1;
  const own: Group[] = [];
  while (j < groups.length && groups[j].code !== 0) own.push(groups[j++]);
  const e: Entity = {
    type,
    groups: own,
    start: head.line,
    end: groups[j]?.line ?? head.line + 2 * (own.length + 1),
    layer: own.find((x) => x.code === 8)?.value ?? '0',
    color: parseInt(own.find((x) => x.code === 62)?.value ?? '256', 10),
    trueColor: (() => {
      const v = own.find((x) => x.code === 420)?.value;
      return v ? parseInt(v, 10) : null;
    })(),
    handle: own.find((x) => x.code === 5)?.value ?? null,
    children: [],
    index,
  };
  const followed = type === 'POLYLINE' || (type === 'INSERT' && own.some((x) => x.code === 66 && x.value === '1'));
  if (followed) {
    while (j < groups.length && groups[j].code === 0 && groups[j].value !== 'SEQEND' && (groups[j].value === 'VERTEX' || groups[j].value === 'ATTRIB')) {
      const [c, next] = readEntity(groups, j, -1);
      if (c) e.children.push(c);
      j = next;
    }
    if (groups[j]?.code === 0 && groups[j].value === 'SEQEND') {
      j++;
      while (j < groups.length && groups[j].code !== 0) j++;
    }
    e.end = groups[j]?.line ?? e.end;
  }
  return [e, j];
}

// ---------- colours (AutoCAD Color Index) ----------

const BASE: Record<number, number> = { 1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff, 7: 0xffffff, 8: 0x808080, 9: 0xc0c0c0 };

/** RGB of an ACI colour (7 is white on dark backgrounds; the caller swaps it on light ones). */
export function aci(i: number): number {
  i = Math.abs(i);
  if (BASE[i] !== undefined) return BASE[i];
  if (i >= 250 && i <= 255) {
    const v = Math.round(51 + ((i - 250) * (255 - 51)) / 5);
    return (v << 16) | (v << 8) | v;
  }
  if (i < 10 || i > 249) return 0xffffff;
  // 10–249: 24 hues × 10 shades (even: saturated, odd: pale), getting darker in pairs.
  const hue = ((Math.floor(i / 10) - 1) * 15) % 360;
  const k = i % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
  const sat = k % 2 === 0 ? 1 : 0.5;
  const c = value * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

export const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** Clean MTEXT formatting codes (\P, {\f…;}, \H…; etc.) into plain lines. */
export function mtextPlain(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhLlOoQqTtWw][^;\\]*;?/g, '')
    .replace(/\\S([^;]*)\^([^;]*);/g, '$1/$2')
    .replace(/[{}]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/\\\\/g, '\\');
}
