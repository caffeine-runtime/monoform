// Lays out a parsed DOT graph with dagre and draws it as SVG in Graphviz's
// style: its node shapes (box, ellipse, circle, diamond, record, cylinder,
// note, …), edge arrowheads, clusters, labels, colours and rank direction.
// Every node, edge and cluster carries data-line (its line in the source) so
// the preview can jump to it.
import dagre from '@dagrejs/dagre';
import { labelText, type Attrs, type DotGraph } from './dot';

export type Measure = (text: string, font: string) => number;

export interface DotLayout {
  svg: string;
  width: number;
  height: number;
  nodes: number;
  edges: number;
}

const PT = 1; // 1 point = 1 SVG unit, as Graphviz writes it
const INCH = 72 * PT;

interface Box {
  id: string;
  label: string;
  lines: string[];
  fields?: string[];
  shape: string;
  attrs: Attrs;
  font: string;
  fontSize: number;
  width: number;
  height: number;
  line: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A Graphviz colour as CSS: names, #rgb(a), "H S V" / "H,S,V" (0–1), "grayNN", and the first of a "a:b" list. */
export function cssColor(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  let c = v.split(':')[0].split(';')[0].trim();
  if (!c) return fallback;
  if (c.startsWith('/')) c = c.split('/').pop() ?? c; // "/scheme/name"
  const hsv = /^([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)$/.exec(c);
  if (hsv) {
    const [h, s, val] = [Number(hsv[1]), Number(hsv[2]), Number(hsv[3])];
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = val * (1 - s);
    const q = val * (1 - f * s);
    const t = val * (1 - (1 - f) * s);
    const [r, g, b] = [
      [val, t, p],
      [q, val, p],
      [p, val, t],
      [p, q, val],
      [t, p, val],
      [val, p, q],
    ][((i % 6) + 6) % 6];
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
  const gray = /^gr[ae]y(\d{1,3})$/i.exec(c);
  if (gray) {
    const n = Math.round((Math.min(100, Number(gray[1])) / 100) * 255);
    return `rgb(${n},${n},${n})`;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]+$/i.test(c)) return c.toLowerCase() === 'transparent' ? 'none' : c;
  return fallback;
}

function fontOf(attrs: Attrs, g: Attrs): { font: string; size: number; family: string } {
  const size = Number(attrs.fontsize ?? g.fontsize) || 14;
  const name = attrs.fontname ?? g.fontname ?? 'Times-Roman';
  const lower = name.toLowerCase();
  const family = /helvetica|arial|sans/.test(lower) ? 'Helvetica, Arial, sans-serif' : /courier|mono/.test(lower) ? '"Courier New", monospace' : /times/.test(lower) ? '"Times New Roman", Times, serif' : `"${name}", sans-serif`;
  const weight = /bold/.test(lower) ? 'bold ' : '';
  const style = /italic|oblique/.test(lower) ? 'italic ' : '';
  return { font: `${style}${weight}${size}px ${family}`, size, family };
}

function styles(a: Attrs): Set<string> {
  return new Set((a.style ?? '').split(',').map((s) => s.trim().toLowerCase()));
}

/** Record labels: "<p0> a | { b | c } | d" -> fields (one level). */
function recordFields(label: string): string[] {
  return label
    .replace(/^\{|\}$/g, '')
    .split(/(?<!\\)\|/)
    .map((f) =>
      f
        .replace(/<[^>]*>/g, '')
        .replace(/[{}]/g, '')
        .replace(/\\([|{}<> ])/g, '$1')
        .replace(/\\[nlr]/g, '\n')
        .trim(),
    );
}

export function layoutDot(g: DotGraph, measure: Measure): DotLayout {
  const ga = g.attrs;
  const rankdir = (ga.rankdir ?? 'TB').toUpperCase();
  const horizontal = rankdir === 'LR' || rankdir === 'RL';
  const dg = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  dg.setGraph({
    rankdir,
    nodesep: (Number(ga.nodesep) || 0.25) * INCH,
    ranksep: (Number(ga.ranksep) || 0.5) * INCH,
    edgesep: 10,
    marginx: 8,
    marginy: 8,
  });
  dg.setDefaultEdgeLabel(() => ({}));

  const boxes = new Map<string, Box>();
  for (const n of g.nodes.values()) {
    const a = n.attrs;
    const shape = (a.shape ?? 'ellipse').toLowerCase();
    const { font, size } = fontOf(a, {});
    const isRecord = shape === 'record' || shape === 'mrecord';
    const label = isRecord ? '' : labelText(a.label, n.id, g.name);
    const fields = isRecord ? recordFields(a.label ?? n.id) : undefined;
    const lines = label.split('\n');
    const lh = size * 1.2;
    let tw = 0;
    let th = 0;
    if (fields) {
      const fw = fields.map((f) => Math.max(...f.split('\n').map((l) => measure(l, font))) + 16);
      const fh = fields.map((f) => f.split('\n').length * lh + 8);
      tw = horizontal ? Math.max(...fw) : fw.reduce((s, w) => s + w, 0);
      th = horizontal ? fh.reduce((s, h) => s + h, 0) : Math.max(...fh);
    } else {
      tw = Math.max(...lines.map((l) => measure(l, font)));
      th = lines.length * lh;
    }
    let w: number;
    let h: number;
    const minW = (Number(a.width) || 0.75) * INCH;
    const minH = (Number(a.height) || 0.5) * INCH;
    switch (shape) {
      case 'ellipse':
      case 'oval':
        w = tw * 1.42 + 12;
        h = th * 1.42 + 6;
        break;
      case 'circle':
      case 'doublecircle':
      case 'doubleoctagon':
        w = h = Math.max(tw, th) * 1.25 + 14 + (shape === 'circle' ? 0 : 8);
        break;
      case 'point':
        w = h = (Number(a.width) || 0.05) * INCH;
        break;
      case 'diamond':
      case 'mdiamond':
        w = tw * 2 + 16;
        h = th * 2 + 8;
        break;
      case 'plaintext':
      case 'plain':
      case 'none':
        w = tw + 8;
        h = th + 6;
        break;
      default:
        w = tw + 18;
        h = th + 10;
    }
    if (shape !== 'point' && shape !== 'plain') {
      if (a.fixedsize === 'true') {
        w = minW;
        h = minH;
      } else {
        w = Math.max(w, shape === 'circle' || shape === 'doublecircle' ? Math.max(minW, minH) : minW);
        h = Math.max(h, shape === 'circle' || shape === 'doublecircle' ? w : minH);
      }
    }
    if (shape === 'square') h = w = Math.max(w, h);
    const box: Box = { id: n.id, label, lines, fields, shape, attrs: a, font, fontSize: size, width: w, height: h, line: n.line };
    boxes.set(n.id, box);
    dg.setNode(n.id, { width: w, height: h });
  }

  for (const c of g.clusters) {
    dg.setNode(c.id, {});
    if (c.parent) dg.setParent(c.id, c.parent);
  }
  for (const n of g.nodes.values()) if (n.cluster) dg.setParent(n.id, n.cluster);

  const edgeLabels: { text: string; font: string; size: number }[] = [];
  g.edges.forEach((e, i) => {
    const a = e.attrs;
    const { font, size } = fontOf(a, {});
    const text = a.label ? labelText(a.label, '', g.name) : '';
    edgeLabels.push({ text, font, size });
    const lines = text ? text.split('\n') : [];
    dg.setEdge(
      e.from,
      e.to,
      {
        minlen: Math.max(0, Math.round(Number(a.minlen ?? 1))),
        weight: Number(a.weight) || 1,
        width: lines.length ? Math.max(...lines.map((l) => measure(l, font))) + 4 : 0,
        height: lines.length * size * 1.2,
        labelpos: 'c',
      },
      String(i),
    );
  });

  dagre.layout(dg);
  const graph = dg.graph() as { width?: number; height?: number };
  let W = Math.ceil(graph.width ?? 0);
  let H = Math.ceil(graph.height ?? 0);

  const out: string[] = [];
  const nodeColor = (a: Attrs) => cssColor(a.color, '#000');

  // Clusters (outermost first).
  const depth = (id: string): number => {
    const c = g.clusters.find((x) => x.id === id);
    return c?.parent ? 1 + depth(c.parent) : 0;
  };
  const clusterOut: string[] = [];
  for (const c of [...g.clusters].sort((x, y) => depth(x.id) - depth(y.id))) {
    const n = dg.node(c.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!n || !n.width) continue;
    const a = c.attrs;
    const st = styles(a);
    if (st.has('invis')) continue;
    const { font, size } = fontOf(a, ga);
    const label = a.label ? labelText(a.label, c.id, g.name) : '';
    const lh = label ? label.split('\n').length * size * 1.2 + 4 : 0;
    const x = n.x - n.width / 2;
    const y = n.y - n.height / 2 - lh;
    const filled = st.has('filled') || a.bgcolor;
    const fill = filled ? cssColor(a.fillcolor ?? a.bgcolor ?? a.color, '#d3d3d3') : 'none';
    const stroke = cssColor(a.pencolor ?? a.color, '#000');
    const dash = st.has('dashed') ? ' stroke-dasharray="5,2"' : st.has('dotted') ? ' stroke-dasharray="1,5"' : '';
    const r = st.has('rounded') ? ' rx="8"' : '';
    clusterOut.push(`<g class="cluster" data-line="${c.line}" data-id="${esc(c.id)}"><rect x="${x}" y="${y}" width="${n.width}" height="${n.height + lh}" fill="${fill}" stroke="${stroke}"${r}${dash} stroke-width="${Number(a.penwidth) || 1}"/>`);
    if (label) {
      const just = (a.labeljust ?? 'c').toLowerCase();
      const tx = just === 'l' ? x + 8 : just === 'r' ? x + n.width - 8 : n.x;
      const anchor = just === 'l' ? 'start' : just === 'r' ? 'end' : 'middle';
      clusterOut.push(textLines(label.split('\n'), tx, y + 4 + size, size, font, anchor, cssColor(a.fontcolor, '#000')));
    }
    clusterOut.push('</g>');
    W = Math.max(W, Math.ceil(x + n.width + 8));
    if (y < 0) H += Math.ceil(-y);
  }
  out.push(...clusterOut);

  // Edges.
  dg.edges().forEach((ed) => {
    const i = Number(ed.name);
    const e = g.edges[i];
    const d = dg.edge(ed) as { points: { x: number; y: number }[]; x?: number; y?: number };
    if (!e || !d?.points?.length) return;
    const a = e.attrs;
    const st = styles(a);
    if (st.has('invis')) return;
    const color = cssColor(a.color, '#000');
    const pw = Number(a.penwidth) || (st.has('bold') ? 2 : 1);
    const dir = (a.dir ?? (g.directed ? 'forward' : 'none')).toLowerCase();
    const head = dir === 'forward' || dir === 'both' ? (a.arrowhead ?? 'normal').toLowerCase() : 'none';
    const tail = dir === 'back' || dir === 'both' ? (a.arrowtail ?? 'normal').toLowerCase() : 'none';
    const pts = d.points.map((p) => ({ ...p }));
    const parts: string[] = [];
    const AL = 10;
    const trim = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: to.x - (dx / len) * AL * Math.min(1, pw), y: to.y - (dy / len) * AL * Math.min(1, pw), tip: { ...to }, ux: dx / len, uy: dy / len };
    };
    let headArrow: ReturnType<typeof trim> | null = null;
    let tailArrow: ReturnType<typeof trim> | null = null;
    if (head !== 'none' && pts.length >= 2) {
      headArrow = trim(pts[pts.length - 2], pts[pts.length - 1]);
      pts[pts.length - 1] = { x: headArrow.x, y: headArrow.y };
    }
    if (tail !== 'none' && pts.length >= 2) {
      tailArrow = trim(pts[1], pts[0]);
      pts[0] = { x: tailArrow.x, y: tailArrow.y };
    }
    const dash = st.has('dashed') ? ' stroke-dasharray="5,2"' : st.has('dotted') ? ' stroke-dasharray="1,5"' : '';
    parts.push(`<path d="${basis(pts)}" fill="none" stroke="${color}" stroke-width="${pw}"${dash}/>`);
    if (headArrow) parts.push(arrow(head, headArrow, color, pw));
    if (tailArrow) parts.push(arrow(tail, tailArrow, color, pw));
    const lab = edgeLabels[i];
    if (lab?.text && d.x !== undefined && d.y !== undefined) {
      const lines = lab.text.split('\n');
      parts.push(textLines(lines, d.x, d.y - ((lines.length - 1) * lab.size * 1.2) / 2 + lab.size * 0.35, lab.size, lab.font, 'middle', cssColor(a.fontcolor, '#000')));
    }
    out.push(`<g class="edge" data-line="${e.line}">${parts.join('')}</g>`);
  });

  // Nodes.
  for (const b of boxes.values()) {
    const n = dg.node(b.id) as { x: number; y: number } | undefined;
    if (!n) continue;
    const st = styles(b.attrs);
    if (st.has('invis')) continue;
    out.push(`<g class="node" data-line="${b.line}" data-id="${esc(b.id)}">${drawNode(b, n.x, n.y, st, horizontal, nodeColor(b.attrs))}</g>`);
  }

  // Graph label at the bottom (Graphviz's default for the root graph).
  if (ga.label) {
    const { font, size } = fontOf({}, ga);
    const lines = labelText(ga.label, '', g.name).split('\n');
    const top = (ga.labelloc ?? 'b').toLowerCase() === 't';
    const lh = lines.length * size * 1.2 + 8;
    if (top) out.unshift(`<g transform="translate(0 ${lh})">`), out.push('</g>');
    const y = top ? size + 4 : H + size;
    out.push(textLines(lines, W / 2, y, size, font, 'middle', cssColor(ga.fontcolor, '#000')));
    H += lh;
  }

  const bg = cssColor(ga.bgcolor, '#ffffff');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${bg}"/>${out.join('')}</svg>`;
  return { svg, width: W, height: H, nodes: boxes.size, edges: g.edges.length };
}

function textLines(lines: string[], x: number, y: number, size: number, font: string, anchor: string, color: string): string {
  const lh = size * 1.2;
  const fam = font.replace(/^(italic )?(bold )?\d+px /, '');
  const weight = font.includes('bold ') ? ' font-weight="bold"' : '';
  const style = font.startsWith('italic ') ? ' font-style="italic"' : '';
  return `<text x="${x}" y="${y}" font-family="${esc(fam)}" font-size="${size}"${weight}${style} text-anchor="${anchor}" fill="${color}">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
}

/** d3's curveBasis through the points (dagre's edge routes). */
function basis(p: { x: number; y: number }[]): string {
  if (p.length < 3) return `M${p.map((q) => `${q.x},${q.y}`).join('L')}`;
  let d = `M${p[0].x},${p[0].y}L${(5 * p[0].x + p[1].x) / 6},${(5 * p[0].y + p[1].y) / 6}`;
  const bez = (x0: number, y0: number, x1: number, y1: number, x: number, y: number) => `C${(2 * x0 + x1) / 3},${(2 * y0 + y1) / 3},${(x0 + 2 * x1) / 3},${(y0 + 2 * y1) / 3},${(x0 + 4 * x1 + x) / 6},${(y0 + 4 * y1 + y) / 6}`;
  for (let i = 2; i < p.length; i++) d += bez(p[i - 2].x, p[i - 2].y, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y);
  const n = p.length;
  d += bez(p[n - 2].x, p[n - 2].y, p[n - 1].x, p[n - 1].y, p[n - 1].x, p[n - 1].y);
  d += `L${p[n - 1].x},${p[n - 1].y}`;
  return d;
}

function arrow(kind: string, a: { tip: { x: number; y: number }; ux: number; uy: number }, color: string, pw: number): string {
  const L = 10 * Math.min(1, pw) + (pw > 1 ? pw : 0);
  const W = 3.5 + pw / 2;
  const { x, y } = a.tip;
  const bx = x - a.ux * L;
  const by = y - a.uy * L;
  const nx = -a.uy;
  const ny = a.ux;
  const empty = kind.startsWith('o') || kind === 'empty';
  const fill = empty ? 'white' : color;
  const base = kind.replace(/^o(?!w)/, '').replace(/^l|^r/, '');
  const poly = (pts: number[][]) => `<polygon points="${pts.map((q) => q.join(',')).join(' ')}" fill="${fill}" stroke="${color}" stroke-width="${pw}"/>`;
  switch (base) {
    case 'none':
      return '';
    case 'vee':
      return poly([
        [x, y],
        [bx + nx * W, by + ny * W],
        [x - a.ux * L * 0.6, y - a.uy * L * 0.6],
        [bx - nx * W, by - ny * W],
      ]);
    case 'dot':
      return `<circle cx="${x - (a.ux * L) / 2}" cy="${y - (a.uy * L) / 2}" r="${L / 2.5}" fill="${fill}" stroke="${color}"/>`;
    case 'diamond':
      return poly([
        [x, y],
        [x - (a.ux * L) / 2 + nx * W, y - (a.uy * L) / 2 + ny * W],
        [bx, by],
        [x - (a.ux * L) / 2 - nx * W, y - (a.uy * L) / 2 - ny * W],
      ]);
    case 'box':
      return poly([
        [x + nx * W, y + ny * W],
        [bx + nx * W, by + ny * W],
        [bx - nx * W, by - ny * W],
        [x - nx * W, y - ny * W],
      ]);
    case 'tee':
      return `<line x1="${x + nx * W * 1.4}" y1="${y + ny * W * 1.4}" x2="${x - nx * W * 1.4}" y2="${y - ny * W * 1.4}" stroke="${color}" stroke-width="${pw + 1}"/><line x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${pw}"/>`;
    case 'inv':
      return poly([
        [bx, by],
        [x + nx * W, y + ny * W],
        [x - nx * W, y - ny * W],
      ]);
    case 'crow':
      return `<path d="M${x + nx * W},${y + ny * W}L${bx},${by}L${x - nx * W},${y - ny * W}M${x},${y}L${bx},${by}" fill="none" stroke="${color}" stroke-width="${pw}"/>`;
    default:
      return poly([
        [x, y],
        [bx + nx * W, by + ny * W],
        [bx - nx * W, by - ny * W],
      ]);
  }
}

function polygonPts(cx: number, cy: number, w: number, h: number, pts: number[][]): string {
  return pts.map(([px, py]) => `${cx + (px * w) / 2},${cy + (py * h) / 2}`).join(' ');
}

const REGULAR: Record<string, number> = { triangle: 3, pentagon: 5, hexagon: 6, septagon: 7, octagon: 8, doubleoctagon: 8, tripleoctagon: 8 };

function drawNode(b: Box, x: number, y: number, st: Set<string>, horizontal: boolean, color: string): string {
  const a = b.attrs;
  const filled = st.has('filled');
  const fill = filled ? cssColor(a.fillcolor ?? a.color, '#d3d3d3') : 'none';
  const pw = Number(a.penwidth) || (st.has('bold') ? 2 : 1);
  const dash = st.has('dashed') ? ' stroke-dasharray="5,2"' : st.has('dotted') ? ' stroke-dasharray="1,5"' : '';
  const common = `fill="${fill}" stroke="${color}" stroke-width="${pw}"${dash}`;
  const w = b.width;
  const h = b.height;
  const l = x - w / 2;
  const t = y - h / 2;
  const fc = cssColor(a.fontcolor, '#000');
  const label = () => textLines(b.lines, x, y - ((b.lines.length - 1) * b.fontSize * 1.2) / 2 + b.fontSize * 0.35, b.fontSize, b.font, 'middle', fc);
  let shape = '';
  switch (b.shape) {
    case 'box':
    case 'rect':
    case 'rectangle':
    case 'square':
    case 'mrecord':
    case 'record':
    case 'mdiamond':
    case 'msquare': {
      const r = st.has('rounded') || b.shape === 'mrecord' ? ' rx="6"' : '';
      if (b.shape === 'mdiamond') break;
      shape = `<rect x="${l}" y="${t}" width="${w}" height="${h}"${r} ${common}/>`;
      if (b.fields) {
        const n = b.fields.length;
        const parts: string[] = [];
        b.fields.forEach((f, i) => {
          const lines = f.split('\n');
          if (horizontal) {
            const fy = t + (h / n) * i;
            if (i) parts.push(`<line x1="${l}" y1="${fy}" x2="${l + w}" y2="${fy}" stroke="${color}"/>`);
            parts.push(textLines(lines, x, fy + h / n / 2 - ((lines.length - 1) * b.fontSize * 1.2) / 2 + b.fontSize * 0.35, b.fontSize, b.font, 'middle', fc));
          } else {
            const fx = l + (w / n) * i;
            if (i) parts.push(`<line x1="${fx}" y1="${t}" x2="${fx}" y2="${t + h}" stroke="${color}"/>`);
            parts.push(textLines(lines, fx + w / n / 2, y - ((lines.length - 1) * b.fontSize * 1.2) / 2 + b.fontSize * 0.35, b.fontSize, b.font, 'middle', fc));
          }
        });
        return shape + parts.join('');
      }
      break;
    }
    case 'circle':
      shape = `<circle cx="${x}" cy="${y}" r="${w / 2}" ${common}/>`;
      break;
    case 'doublecircle':
      shape = `<circle cx="${x}" cy="${y}" r="${w / 2}" ${common}/><circle cx="${x}" cy="${y}" r="${w / 2 - 4}" fill="none" stroke="${color}" stroke-width="${pw}"/>`;
      break;
    case 'point':
      return `<circle cx="${x}" cy="${y}" r="${w / 2}" fill="${filled ? fill : color}" stroke="${color}"/>`;
    case 'plaintext':
    case 'plain':
    case 'none':
      return label();
    case 'underline':
      return `<line x1="${l}" y1="${t + h}" x2="${l + w}" y2="${t + h}" stroke="${color}" stroke-width="${pw}"/>${label()}`;
    case 'diamond':
      shape = `<polygon points="${polygonPts(x, y, w, h, [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])}" ${common}/>`;
      break;
    case 'parallelogram':
      shape = `<polygon points="${polygonPts(x, y, w, h, [
        [-0.7, -1],
        [1, -1],
        [0.7, 1],
        [-1, 1],
      ])}" ${common}/>`;
      break;
    case 'trapezium':
    case 'invtrapezium': {
      const s = b.shape === 'trapezium' ? 1 : -1;
      shape = `<polygon points="${polygonPts(x, y, w, h, [
        [-0.7, -s],
        [0.7, -s],
        [1, s],
        [-1, s],
      ])}" ${common}/>`;
      break;
    }
    case 'invtriangle':
      shape = `<polygon points="${polygonPts(x, y, w, h, [
        [-1, -1],
        [1, -1],
        [0, 1],
      ])}" ${common}/>`;
      break;
    case 'house':
    case 'invhouse': {
      const s = b.shape === 'house' ? 1 : -1;
      shape = `<polygon points="${polygonPts(x, y, w, h, [
        [0, -s],
        [1, -0.3 * s],
        [1, s],
        [-1, s],
        [-1, -0.3 * s],
      ])}" ${common}/>`;
      break;
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.15, 8);
      shape = `<path d="M${l},${t + ry}A${w / 2},${ry} 0 0 1 ${l + w},${t + ry}V${t + h - ry}A${w / 2},${ry} 0 0 1 ${l},${t + h - ry}Z" ${common}/><path d="M${l},${t + ry}A${w / 2},${ry} 0 0 0 ${l + w},${t + ry}" fill="none" stroke="${color}" stroke-width="${pw}"/>`;
      break;
    }
    case 'note': {
      const f = 8;
      shape = `<path d="M${l},${t}H${l + w - f}L${l + w},${t + f}V${t + h}H${l}Z" ${common}/><path d="M${l + w - f},${t}V${t + f}H${l + w}" fill="none" stroke="${color}" stroke-width="${pw}"/>`;
      break;
    }
    case 'tab':
    case 'folder': {
      shape = `<path d="M${l},${t + 5}H${l + w * 0.35}V${t}H${l + w * 0.55}V${t + 5}H${l + w}V${t + h}H${l}Z" ${common}/>`;
      break;
    }
    case 'component':
      shape = `<rect x="${l}" y="${t}" width="${w}" height="${h}" ${common}/><rect x="${l - 4}" y="${t + h * 0.2}" width="8" height="5" ${common}/><rect x="${l - 4}" y="${t + h * 0.6}" width="8" height="5" ${common}/>`;
      break;
    case 'box3d':
      shape = `<path d="M${l},${t + 4}L${l + 4},${t}H${l + w}V${t + h - 4}L${l + w - 4},${t + h}H${l}Z" ${common}/><path d="M${l},${t + 4}H${l + w - 4}V${t + h}M${l + w - 4},${t + 4}L${l + w},${t}" fill="none" stroke="${color}"/>`;
      break;
    case 'star': {
      const pts: number[][] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.45 : 1;
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
      shape = `<polygon points="${polygonPts(x, y, w, h, pts)}" ${common}/>`;
      break;
    }
    default: {
      const sides = REGULAR[b.shape];
      if (sides) {
        const pts: number[][] = [];
        for (let i = 0; i < sides; i++) {
          const ang = (sides === 3 ? -Math.PI / 2 : Math.PI / sides) + (i * 2 * Math.PI) / sides;
          pts.push([Math.cos(ang), Math.sin(ang)]);
        }
        shape = `<polygon points="${polygonPts(x, y, w, h, pts)}" ${common}/>`;
        if (b.shape === 'doubleoctagon') shape += `<polygon points="${polygonPts(x, y, w - 8, h - 8, pts)}" fill="none" stroke="${color}"/>`;
      } else {
        // ellipse / oval and anything unknown
        shape = `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
      }
    }
  }
  if (b.shape === 'mdiamond' || b.shape === 'msquare') {
    shape =
      b.shape === 'mdiamond'
        ? `<polygon points="${polygonPts(x, y, w, h, [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ])}" ${common}/>`
        : shape;
  }
  return shape + label();
}
