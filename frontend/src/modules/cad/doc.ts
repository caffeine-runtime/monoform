// An open DXF drawing and its edits. Every edit is a set of line patches on
// the original text: only the values that change are rewritten, so anything
// this editor doesn't understand (objects, dictionaries, xdata, unknown
// entities) survives byte-for-byte. New entities get handles from $HANDSEED
// and the subclass markers R13+ readers expect. Pure; unit-tested.
import { num, parseLines, type Drawing, type Entity, type Group } from './dxf';
import { angleOf, apply, conj, flipped, hatch, linear, measure, scaleOf, type M } from './geometry';

export interface Patch {
  at: number;
  del: number;
  ins: string[];
}

/** Apply patches (positions refer to the original lines) in one pass. */
export function applyPatches(lines: string[], patches: Patch[]): string[] {
  if (!patches.length) return lines;
  const order = patches.map((p, i) => ({ p, i })).sort((a, b) => a.p.at - b.p.at || a.i - b.i);
  const out: string[] = [];
  let cur = 0;
  for (const { p } of order) {
    for (; cur < p.at; cur++) out.push(lines[cur]);
    for (const s of p.ins) out.push(s);
    cur = Math.max(cur, p.at + p.del);
  }
  for (; cur < lines.length; cur++) out.push(lines[cur]);
  return out;
}

/** A DXF real: up to ~14 significant digits, always with a decimal point, no exponent. */
export function fmt(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-12) return '0.0';
  const digits = Math.max(0, Math.min(20, 13 - Math.floor(Math.log10(Math.abs(v)))));
  let s = v.toFixed(digits);
  s = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s + '.0';
  return s === '-0.0' ? '0.0' : s;
}

const normDeg = (a: number) => {
  const r = ((a % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-10 ? 0 : r;
};

/** Which groups of an entity are points, vectors, lengths and angles. null: can't be transformed. */
interface Roles {
  points: [number, number][];
  vectors: [number, number][];
  lengths: number[];
  angles: number[]; // degrees
  radians: number[];
}

function rolesOf(e: Entity): Roles | null {
  const g = e.groups;
  const r: Roles = { points: [], vectors: [], lengths: [], angles: [], radians: [] };
  const pairsOf = (xc: number, into: [number, number][]) => {
    for (let i = 0; i < g.length; i++) {
      if (g[i].code !== xc) continue;
      const j = g[i + 1]?.code === xc + 10 ? i + 1 : g[i + 2]?.code === xc + 10 ? i + 2 : -1;
      if (j >= 0) into.push([i, j]);
    }
  };
  const codes = (into: number[], ...cs: number[]) => g.forEach((x, i) => cs.includes(x.code) && into.push(i));
  switch (e.type) {
    case 'LINE':
      pairsOf(10, r.points);
      pairsOf(11, r.points);
      break;
    case 'POINT':
      pairsOf(10, r.points);
      break;
    case 'CIRCLE':
      pairsOf(10, r.points);
      codes(r.lengths, 40);
      break;
    case 'ARC':
      pairsOf(10, r.points);
      codes(r.lengths, 40);
      codes(r.angles, 50, 51);
      break;
    case 'ELLIPSE':
      pairsOf(10, r.points);
      pairsOf(11, r.vectors);
      break;
    case 'LWPOLYLINE':
      pairsOf(10, r.points);
      codes(r.lengths, 40, 41, 43);
      break;
    case 'POLYLINE':
    case 'VERTEX':
      if (e.type === 'VERTEX') pairsOf(10, r.points); // POLYLINE's own 10 is an elevation, not a point
      codes(r.lengths, 40, 41);
      break;
    case 'SPLINE':
      pairsOf(10, r.points);
      pairsOf(11, r.points);
      pairsOf(12, r.vectors);
      pairsOf(13, r.vectors);
      break;
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      pairsOf(10, r.points);
      pairsOf(11, r.points);
      codes(r.lengths, 40);
      codes(r.angles, 50);
      break;
    case 'MTEXT':
      pairsOf(10, r.points);
      pairsOf(11, r.vectors);
      codes(r.lengths, 40, 41);
      codes(r.radians, 50);
      break;
    case 'INSERT':
      pairsOf(10, r.points);
      codes(r.lengths, 41, 42, 44, 45);
      codes(r.angles, 50);
      break;
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      for (const c of [10, 11, 12, 13]) pairsOf(c, r.points);
      break;
    case 'LEADER':
      pairsOf(10, r.points);
      break;
    case 'HATCH': {
      const h = hatch(e);
      r.points = h.points;
      r.vectors = h.vectors;
      r.lengths = h.lengths;
      r.angles = h.angles;
      if (!h.solid) {
        codes(r.angles, 52);
        codes(r.lengths, 41);
      }
      break;
    }
    default:
      return null;
  }
  return r;
}

export const canTransform = (e: Entity) => rolesOf(e) !== null;

export interface NewEntity {
  type: 'LINE' | 'LWPOLYLINE' | 'CIRCLE' | 'ARC' | 'TEXT' | 'POINT';
  pts?: [number, number][];
  closed?: boolean;
  r?: number;
  /** ARC angles, degrees, counter-clockwise */
  a0?: number;
  a1?: number;
  text?: string;
  h?: number;
  rot?: number; // degrees
  layer: string;
  color?: number; // ACI; omitted = BYLAYER
}

export interface Prop {
  label: string;
  code: number;
  occ: number;
  value: string;
  kind: 'num' | 'text' | 'ro' | 'flag';
}

export class CadDoc {
  lines: string[];
  d: Drawing;
  private past: string[][] = [];
  private future: string[][] = [];
  private saved: string[];
  private seed: bigint | null = null;

  constructor(text: string) {
    if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF isn’t supported; save it as ASCII DXF.');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    this.lines = text.split(/\r?\n/);
    this.d = parseLines(this.lines, eol);
    this.saved = this.lines;
  }

  get dirty() {
    return this.lines !== this.saved;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  text() {
    return this.lines.join(this.d.eol);
  }
  markSaved() {
    this.saved = this.lines;
  }

  private commit(patches: Patch[]) {
    if (!patches.length) return;
    if (this.seed !== null && this.d.handseed) patches.push({ at: this.d.handseed.line + 1, del: 1, ins: [this.seed.toString(16).toUpperCase()] });
    this.past.push(this.lines);
    if (this.past.length > (this.lines.length > 400_000 ? 20 : 100)) this.past.shift();
    this.future = [];
    this.set(applyPatches(this.lines, patches));
  }

  private set(lines: string[]) {
    this.lines = lines;
    this.d = parseLines(lines, this.d.eol);
    this.seed = null;
  }

  undo(): boolean {
    const l = this.past.pop();
    if (!l) return false;
    this.future.push(this.lines);
    this.set(l);
    return true;
  }

  redo(): boolean {
    const l = this.future.pop();
    if (!l) return false;
    this.past.push(this.lines);
    this.set(l);
    return true;
  }

  // ---------- formatting helpers ----------

  /** Code line in the file's style (R12 files often right-align codes to 3 columns). */
  private code(c: number): string {
    return /^\s/.test(this.lines[0] ?? '') ? String(c).padStart(3) : String(c);
  }
  private get modern() {
    return (this.d.version || 'AC1009') >= 'AC1012';
  }
  private get useHandles() {
    return this.modern || this.d.entities.some((e) => e.handle !== null);
  }
  private handle(): string {
    if (this.seed === null) {
      let s = this.d.handseed ? BigInt('0x' + (this.d.handseed.value || '1')) : 1n;
      if (!this.d.handseed) {
        // No $HANDSEED: start after the largest handle in the file.
        for (let i = 0; i + 1 < this.lines.length; i += 2) {
          const c = this.lines[i].trim();
          if (c === '5' || c === '105') {
            try {
              const h = BigInt('0x' + this.lines[i + 1].trim());
              if (h >= s) s = h + 1n;
            } catch {
              /* not hex */
            }
          }
        }
      }
      this.seed = s;
    }
    const h = this.seed.toString(16).toUpperCase();
    this.seed++;
    return h;
  }

  private setValue(g: Group, v: string): Patch {
    return { at: g.line + 1, del: 1, ins: [v] };
  }
  private insertAfter(g: Group, code: number, v: string): Patch {
    return { at: g.line + 2, del: 0, ins: [this.code(code), v] };
  }
  /** End of an entity's own groups (before VERTEX/ATTRIB followers). */
  private ownEnd(e: Entity): number {
    const last = e.groups[e.groups.length - 1];
    return last ? last.line + 2 : e.start + 2;
  }

  // ---------- transforms ----------

  private transformPatches(e: Entity, m: M, inOcs = false): Patch[] | null {
    const r = rolesOf(e);
    if (!r) return null;
    const g = e.groups;
    const mm = flipped(e) || inOcs ? conj(m) : m;
    const k = scaleOf(m);
    const da = angleOf(mm);
    const out: Patch[] = [];
    for (const [xi, yi] of r.points) {
      const [x, y] = apply(mm, +g[xi].value, +g[yi].value);
      out.push(this.setValue(g[xi], fmt(x)), this.setValue(g[yi], fmt(y)));
    }
    for (const [xi, yi] of r.vectors) {
      const [x, y] = linear(mm, +g[xi].value, +g[yi].value);
      out.push(this.setValue(g[xi], fmt(x)), this.setValue(g[yi], fmt(y)));
    }
    if (k !== 1) for (const i of r.lengths) out.push(this.setValue(g[i], fmt(+g[i].value * k)));
    if (da) {
      for (const i of r.angles) out.push(this.setValue(g[i], fmt(normDeg(+g[i].value + (da * 180) / Math.PI))));
      for (const i of r.radians) out.push(this.setValue(g[i], fmt(+g[i].value + da)));
    }
    // Groups that are often left out when they hold their default.
    const anchor = (...codes: number[]) => {
      for (const c of codes) {
        const found = [...g].reverse().find((x) => x.code === c);
        if (found) return found;
      }
      return g[g.length - 1];
    };
    if (e.type === 'INSERT') {
      if (k !== 1) for (const c of [42, 41]) if (!g.some((x) => x.code === c)) out.push(this.insertAfter(anchor(30, 20), c, fmt(k)));
      if (da && !g.some((x) => x.code === 50)) out.push(this.insertAfter(anchor(42, 41, 30, 20), 50, fmt(normDeg((da * 180) / Math.PI))));
    } else if ((e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') && da && !g.some((x) => x.code === 50)) {
      out.push(this.insertAfter(anchor(1, 40), 50, fmt(normDeg((da * 180) / Math.PI))));
    } else if (e.type === 'MTEXT' && da && !r.vectors.length && !g.some((x) => x.code === 50)) {
      out.push(this.insertAfter(anchor(40), 50, fmt(da)));
    }
    for (const c of e.children) {
      const p = this.transformPatches(c, m, e.type === 'POLYLINE' && flipped(e));
      if (p) out.push(...p);
    }
    return out;
  }

  /** Move / rotate / scale entities. Returns how many couldn't be changed (e.g. dimensions). */
  transform(ids: number[], m: M): { skipped: number } {
    const patches: Patch[] = [];
    let skipped = 0;
    for (const i of ids) {
      const e = this.d.entities[i];
      const p = e && this.transformPatches(e, m);
      if (p) patches.push(...p);
      else skipped++;
    }
    this.commit(patches);
    return { skipped };
  }

  /** Copies of entities (optionally transformed), added at the end. Returns their indices. */
  copy(ids: number[], m: M | null): { added: number[]; skipped: number } {
    const blocks: string[] = [];
    let skipped = 0;
    let made = 0;
    for (const i of ids) {
      const e = this.d.entities[i];
      if (!e) continue;
      const p = m ? this.transformPatches(e, m) : [];
      if (!p) {
        skipped++;
        continue;
      }
      const own = this.lines.slice(e.start, e.end);
      const moved = applyPatches(
        own,
        p.map((x) => ({ ...x, at: x.at - e.start })),
      );
      blocks.push(...this.rehandle(moved));
      made++;
    }
    const before = this.d.entities.length;
    this.commit(blocks.length ? [{ at: this.d.entitiesEnd, del: 0, ins: blocks }] : []);
    return { added: Array.from({ length: made }, (_, k) => before + k), skipped };
  }

  /** Give copied lines fresh handles (owners of followers follow) and drop reactor/xdictionary links. */
  private rehandle(lines: string[]): string[] {
    const map = new Map<string, string>();
    const out: string[] = [];
    let skip = false;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = lines[i].trim();
      const v = lines[i + 1].trim();
      if (c === '102') {
        if (v === '{ACAD_REACTORS' || v === '{ACAD_XDICTIONARY') {
          skip = true;
          continue;
        }
        if (skip && v === '}') {
          skip = false;
          continue;
        }
      }
      if (skip) continue;
      if (c === '5' && this.useHandles) {
        const h = this.handle();
        map.set(v, h);
        out.push(lines[i], h);
      } else if (c === '330' && map.has(v)) out.push(lines[i], map.get(v)!);
      else out.push(lines[i], lines[i + 1]);
    }
    return out;
  }

  remove(ids: number[]) {
    const patches: Patch[] = [];
    for (const i of new Set(ids)) {
      const e = this.d.entities[i];
      if (e) patches.push({ at: e.start, del: e.end - e.start, ins: [] });
    }
    this.commit(patches);
  }

  // ---------- new entities ----------

  private entityLines(n: NewEntity): string[] {
    const L: string[] = [];
    const g = (c: number, v: string | number) => L.push(this.code(c), typeof v === 'number' ? fmt(v) : v);
    const modern = this.modern;
    const head = (type: string, sub: string[]) => {
      g(0, type);
      if (this.useHandles) g(5, this.handle());
      if (modern && this.d.modelSpaceHandle) g(330, this.d.modelSpaceHandle);
      if (modern) g(100, 'AcDbEntity');
      g(8, n.layer || '0');
      if (n.color !== undefined && n.color !== 256) L.push(this.code(62), String(n.color));
      if (modern) for (const s of sub) g(100, s);
    };
    const p = n.pts ?? [];
    switch (n.type) {
      case 'LINE':
        head('LINE', ['AcDbLine']);
        g(10, p[0][0]);
        g(20, p[0][1]);
        g(30, 0);
        g(11, p[1][0]);
        g(21, p[1][1]);
        g(31, 0);
        break;
      case 'POINT':
        head('POINT', ['AcDbPoint']);
        g(10, p[0][0]);
        g(20, p[0][1]);
        g(30, 0);
        break;
      case 'CIRCLE':
      case 'ARC':
        head(n.type, ['AcDbCircle']);
        g(10, p[0][0]);
        g(20, p[0][1]);
        g(30, 0);
        g(40, n.r ?? 1);
        if (n.type === 'ARC') {
          if (modern) g(100, 'AcDbArc');
          g(50, normDeg(n.a0 ?? 0));
          g(51, normDeg(n.a1 ?? 90));
        }
        break;
      case 'TEXT':
        head('TEXT', ['AcDbText']);
        g(10, p[0][0]);
        g(20, p[0][1]);
        g(30, 0);
        g(40, n.h ?? 2.5);
        g(1, n.text ?? '');
        if (n.rot) g(50, normDeg(n.rot));
        if (modern) g(100, 'AcDbText');
        break;
      case 'LWPOLYLINE':
        if (modern) {
          head('LWPOLYLINE', ['AcDbPolyline']);
          L.push(this.code(90), String(p.length), this.code(70), n.closed ? '1' : '0');
          for (const [x, y] of p) {
            g(10, x);
            g(20, y);
          }
        } else {
          // R12 has no LWPOLYLINE: POLYLINE + VERTEX + SEQEND.
          head('POLYLINE', []);
          L.push(this.code(66), '1');
          g(10, 0);
          g(20, 0);
          g(30, 0);
          L.push(this.code(70), n.closed ? '1' : '0');
          for (const [x, y] of p) {
            g(0, 'VERTEX');
            if (this.useHandles) g(5, this.handle());
            g(8, n.layer || '0');
            g(10, x);
            g(20, y);
            g(30, 0);
          }
          g(0, 'SEQEND');
          if (this.useHandles) g(5, this.handle());
          g(8, n.layer || '0');
        }
        break;
    }
    return L;
  }

  add(list: NewEntity[]): number[] {
    const before = this.d.entities.length;
    const ins = list.flatMap((n) => this.entityLines(n));
    this.commit(ins.length ? [{ at: this.d.entitiesEnd, del: 0, ins }] : []);
    return Array.from({ length: this.d.entities.length - before }, (_, k) => before + k);
  }

  // ---------- properties ----------

  setLayer(ids: number[], layer: string) {
    const patches: Patch[] = [];
    const on = (e: Entity) => {
      const g = e.groups.find((x) => x.code === 8);
      if (g) patches.push(this.setValue(g, layer));
      else {
        const sub = e.groups.find((x) => x.code === 100 && x.value === 'AcDbEntity') ?? e.groups.find((x) => x.code === 5) ?? null;
        patches.push(sub ? this.insertAfter(sub, 8, layer) : { at: e.start + 2, del: 0, ins: [this.code(8), layer] });
      }
      for (const c of e.children) on(c);
    };
    for (const i of ids) if (this.d.entities[i]) on(this.d.entities[i]);
    this.commit(patches);
  }

  /** ACI colour (256 = BYLAYER, 0 = BYBLOCK); clears any true colour. */
  setColor(ids: number[], aci: number) {
    const patches: Patch[] = [];
    for (const i of ids) {
      const e = this.d.entities[i];
      if (!e) continue;
      const g = e.groups.find((x) => x.code === 62);
      if (g) patches.push(this.setValue(g, String(aci)));
      else if (aci !== 256) {
        const l = e.groups.find((x) => x.code === 8);
        patches.push(l ? this.insertAfter(l, 62, String(aci)) : { at: e.start + 2, del: 0, ins: [this.code(62), String(aci)] });
      }
      for (const t of e.groups) if (t.code === 420 || t.code === 430) patches.push({ at: t.line, del: 2, ins: [] });
    }
    this.commit(patches);
  }

  props(i: number): { type: string; handle: string | null; layer: string; color: number; trueColor: number | null; props: Prop[]; length?: number; area?: number; editable: boolean } | null {
    const e = this.d.entities[i];
    if (!e) return null;
    const P: Prop[] = [];
    const add = (label: string, code: number, kind: Prop['kind'] = 'num', occ = 0) => {
      const g = e.groups.filter((x) => x.code === code)[occ];
      P.push({ label, code, occ, value: g?.value ?? '', kind });
    };
    const xy = (l: string, c: number) => {
      add(`${l} X`, c);
      add(`${l} Y`, c + 10);
    };
    switch (e.type) {
      case 'LINE':
        xy('Start', 10);
        xy('End', 11);
        break;
      case 'POINT':
        xy('Position', 10);
        break;
      case 'CIRCLE':
        xy('Centre', 10);
        add('Radius', 40);
        break;
      case 'ARC':
        xy('Centre', 10);
        add('Radius', 40);
        add('Start angle', 50);
        add('End angle', 51);
        break;
      case 'ELLIPSE':
        xy('Centre', 10);
        add('Minor/major ratio', 40);
        break;
      case 'TEXT':
      case 'MTEXT':
        add('Text', 1, 'text');
        if (e.type === 'MTEXT') P[P.length - 1].value = e.groups.filter((x) => x.code === 3).map((x) => x.value).join('') + P[P.length - 1].value;
        xy('Position', 10);
        add('Height', 40);
        if (e.type === 'TEXT') add('Rotation', 50);
        break;
      case 'INSERT':
        add('Block', 2, 'ro');
        xy('Position', 10);
        add('Scale X', 41);
        add('Scale Y', 42);
        add('Rotation', 50);
        break;
      case 'LWPOLYLINE':
        P.push({ label: 'Vertices', code: 90, occ: 0, value: String(e.groups.filter((x) => x.code === 10).length), kind: 'ro' });
        P.push({ label: 'Closed', code: 70, occ: 0, value: num(e, 70) & 1 ? '1' : '0', kind: 'flag' });
        add('Width', 43);
        break;
      case 'POLYLINE':
        P.push({ label: 'Vertices', code: -1, occ: 0, value: String(e.children.filter((c) => c.type === 'VERTEX').length), kind: 'ro' });
        P.push({ label: 'Closed', code: 70, occ: 0, value: num(e, 70) & 1 ? '1' : '0', kind: 'flag' });
        break;
      case 'SPLINE':
        add('Degree', 71, 'ro');
        P.push({ label: 'Control points', code: -1, occ: 0, value: String(e.groups.filter((x) => x.code === 10).length), kind: 'ro' });
        break;
      case 'DIMENSION':
        add('Measurement', 42, 'ro');
        add('Text', 1, 'ro');
        break;
    }
    return { type: e.type, handle: e.handle, layer: e.layer, color: e.color, trueColor: e.trueColor, props: P, ...measure(e), editable: canTransform(e) };
  }

  /** Change one property value (inserting the group when the entity left it out). */
  setProp(i: number, code: number, occ: number, value: string) {
    const e = this.d.entities[i];
    if (!e) return;
    const patches: Patch[] = [];
    const g = e.groups.filter((x) => x.code === code)[occ];
    if (code === 70 && (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE')) {
      const flags = ((num(e, 70) || 0) & ~1) | (value === '1' ? 1 : 0);
      if (g) patches.push(this.setValue(g, String(flags)));
      else patches.push({ at: this.ownEnd(e), del: 0, ins: [this.code(70), String(flags)] });
    } else if (code === 1 && e.type === 'MTEXT') {
      for (const t of e.groups) if (t.code === 3) patches.push({ at: t.line, del: 2, ins: [] });
      const enc = value.replace(/\r?\n/g, '\\P');
      const chunks: string[] = [];
      for (let k = 0; k < enc.length; k += 250) chunks.push(enc.slice(k, k + 250));
      if (!chunks.length) chunks.push('');
      const last = chunks.pop()!;
      if (g) {
        patches.push({ at: g.line, del: 2, ins: [...chunks.flatMap((c) => [this.code(3), c]), this.code(1), last] });
      } else patches.push({ at: this.ownEnd(e), del: 0, ins: [...chunks.flatMap((c) => [this.code(3), c]), this.code(1), last] });
    } else if (g) {
      patches.push(this.setValue(g, code === 1 ? value.replace(/\r?\n/g, ' ') : fmtIfNum(code, value)));
    } else {
      const after =
        e.type === 'INSERT' ? (e.groups.find((x) => x.code === 30) ?? e.groups.find((x) => x.code === 20)) : e.type === 'TEXT' ? e.groups.find((x) => x.code === 40) : undefined;
      patches.push(after ? this.insertAfter(after, code, fmtIfNum(code, value)) : { at: this.ownEnd(e), del: 0, ins: [this.code(code), fmtIfNum(code, value)] });
    }
    this.commit(patches);
  }

  /** Summary per entity type, for the status bar. */
  counts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const e of this.d.entities) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }

  block(name: string) {
    return this.d.blocks.get(name);
  }
}

/** Reals (codes 10–59, 110–149, 210–239) are written in DXF style. */
function fmtIfNum(code: number, v: string): string {
  const real = (code >= 10 && code <= 59) || (code >= 110 && code <= 149) || (code >= 210 && code <= 239);
  const n = Number(v);
  return real && v.trim() !== '' && Number.isFinite(n) ? fmt(n) : v;
}

