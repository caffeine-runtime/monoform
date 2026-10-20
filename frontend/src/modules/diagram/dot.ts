// A parser for Graphviz's DOT language: graphs, subgraphs and clusters,
// node/edge/graph attributes with their scoping, edge chains, edges to
// subgraphs, ports, quoted/HTML/concatenated IDs and comments. Graphviz
// itself (EPL) isn't used; dotLayout.ts lays the result out with dagre.

export type Attrs = Record<string, string>;

export interface DotNode {
  id: string;
  attrs: Attrs;
  line: number;
  cluster?: string;
}

export interface DotEdge {
  from: string;
  to: string;
  attrs: Attrs;
  line: number;
  fromPort?: string;
  toPort?: string;
}

export interface DotCluster {
  id: string;
  attrs: Attrs;
  parent?: string;
  line: number;
}

export interface DotGraph {
  directed: boolean;
  strict: boolean;
  name: string;
  attrs: Attrs;
  nodes: Map<string, DotNode>;
  edges: DotEdge[];
  clusters: DotCluster[];
}

export class DotError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
  }
}

type Tok = { t: 'id' | 'html' | 'punct' | 'edgeop' | 'eof'; v: string; line: number; quoted?: boolean };

const KEYWORDS = new Set(['graph', 'digraph', 'subgraph', 'node', 'edge', 'strict']);

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿') {
      i++;
      continue;
    }
    // A line starting with '#' is a C preprocessor line: ignored.
    if (c === '#' && lineStart) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    lineStart = false;
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    const at = line;
    if (c === '"') {
      let v = '';
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '"') {
          v += '"';
          i += 2;
          continue;
        }
        if (src[i] === '\\' && src[i + 1] === '\n') {
          // Line continuation inside a string.
          line++;
          i += 2;
          continue;
        }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      if (i >= n) throw new DotError('unterminated string', at);
      i++;
      // "a" + "b" concatenation.
      const prev = out[out.length - 1];
      const prev2 = out[out.length - 2];
      if (prev?.t === 'punct' && prev.v === '+' && prev2?.t === 'id' && prev2.quoted) {
        out.pop();
        prev2.v += v;
        continue;
      }
      out.push({ t: 'id', v, line: at, quoted: true });
      continue;
    }
    if (c === '<') {
      let depth = 0;
      let k = i;
      for (; k < n; k++) {
        if (src[k] === '<') depth++;
        else if (src[k] === '>' && --depth === 0) break;
        else if (src[k] === '\n') line++;
      }
      if (k >= n) throw new DotError('unterminated HTML label', at);
      out.push({ t: 'html', v: src.slice(i + 1, k), line: at });
      i = k + 1;
      continue;
    }
    if (c === '-' && (src[i + 1] === '>' || src[i + 1] === '-')) {
      out.push({ t: 'edgeop', v: src.slice(i, i + 2), line: at });
      i += 2;
      continue;
    }
    if ('{}[]=;,:+'.includes(c)) {
      out.push({ t: 'punct', v: c, line: at });
      i++;
      continue;
    }
    const num = /^-?(?:\.\d+|\d+(?:\.\d*)?)/.exec(src.slice(i, i + 40));
    if (num && !/[A-Za-z_\u0080-￿]/.test(src[i + num[0].length] ?? '')) {
      out.push({ t: 'id', v: num[0], line: at });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_\u0080-￿][A-Za-z_0-9\u0080-￿]*/.exec(src.slice(i, i + 4096));
    if (id) {
      out.push({ t: 'id', v: id[0], line: at });
      i += id[0].length;
      continue;
    }
    throw new DotError(`unexpected character “${c}”`, at);
  }
  out.push({ t: 'eof', v: '', line });
  return out;
}

interface Scope {
  node: Attrs;
  edge: Attrs;
  graph: Attrs;
  cluster?: string;
  members: Set<string>;
}

export function parseDot(src: string): DotGraph {
  const toks = tokenize(src);
  let p = 0;
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const next = () => toks[Math.min(p++, toks.length - 1)];
  const isKw = (t: Tok, kw: string) => t.t === 'id' && !t.quoted && t.v.toLowerCase() === kw;
  const expect = (v: string) => {
    const t = next();
    if (t.t !== 'punct' || t.v !== v) throw new DotError(`expected “${v}” but found “${t.v || 'end of file'}”`, t.line);
  };

  const g: DotGraph = { directed: false, strict: false, name: '', attrs: {}, nodes: new Map(), edges: [], clusters: [] };
  if (isKw(peek(), 'strict')) {
    next();
    g.strict = true;
  }
  const head = next();
  if (isKw(head, 'digraph')) g.directed = true;
  else if (!isKw(head, 'graph')) throw new DotError('a DOT file starts with “graph” or “digraph”', head.line);
  if (peek().t === 'id' || peek().t === 'html') g.name = next().v;
  let anon = 0;

  const id = (): Tok => {
    const t = next();
    if (t.t !== 'id' && t.t !== 'html') throw new DotError(`expected a name but found “${t.v || 'end of file'}”`, t.line);
    return t;
  };

  const attrList = (): Attrs => {
    const a: Attrs = {};
    while (peek().t === 'punct' && peek().v === '[') {
      next();
      while (!(peek().t === 'punct' && peek().v === ']')) {
        if (peek().t === 'eof') throw new DotError('unclosed “[”', peek().line);
        const k = id();
        if (peek().t === 'punct' && peek().v === '=') {
          next();
          const v = id();
          a[k.v] = v.t === 'html' ? `<${v.v}>` : v.v;
        } else a[k.v] = 'true';
        if (peek().t === 'punct' && (peek().v === ',' || peek().v === ';')) next();
      }
      next();
    }
    return a;
  };

  const addNode = (name: string, scope: Scope, line: number, attrs?: Attrs) => {
    let node = g.nodes.get(name);
    if (!node) {
      node = { id: name, attrs: { ...scope.node }, line, cluster: scope.cluster };
      g.nodes.set(name, node);
    } else if (scope.cluster && !node.cluster) node.cluster = scope.cluster;
    if (attrs) Object.assign(node.attrs, attrs);
    scope.members.add(name);
    return node;
  };

  // An operand of an edge: a node (with optional port) or a subgraph.
  const operand = (scope: Scope): { nodes: string[]; port?: string } => {
    const t = peek();
    if ((t.t === 'punct' && t.v === '{') || isKw(t, 'subgraph')) return { nodes: [...subgraph(scope)] };
    const name = id();
    let port: string | undefined;
    if (peek().t === 'punct' && peek().v === ':') {
      next();
      port = id().v;
      if (peek().t === 'punct' && peek().v === ':') {
        next();
        port += ':' + id().v;
      }
    }
    addNode(name.v, scope, name.line);
    return { nodes: [name.v], port };
  };

  const subgraph = (outer: Scope): Set<string> => {
    let name = '';
    const line = peek().line;
    if (isKw(peek(), 'subgraph')) {
      next();
      if (peek().t === 'id' || peek().t === 'html') name = next().v;
    }
    if (!name) name = `__anon${++anon}`;
    const isCluster = name.startsWith('cluster');
    const scope: Scope = { node: { ...outer.node }, edge: { ...outer.edge }, graph: {}, cluster: outer.cluster, members: new Set() };
    let cluster: DotCluster | undefined;
    if (isCluster) {
      cluster = g.clusters.find((c) => c.id === name);
      if (!cluster) {
        cluster = { id: name, attrs: {}, parent: outer.cluster, line };
        g.clusters.push(cluster);
      }
      scope.cluster = name;
      scope.graph = cluster.attrs;
    }
    expect('{');
    stmts(scope);
    expect('}');
    for (const m of scope.members) outer.members.add(m);
    return scope.members;
  };

  const stmts = (scope: Scope) => {
    while (!(peek().t === 'punct' && peek().v === '}') && peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'punct' && t.v === ';') {
        next();
        continue;
      }
      if (isKw(t, 'graph') || isKw(t, 'node') || isKw(t, 'edge')) {
        next();
        const a = attrList();
        const kind = t.v.toLowerCase();
        if (kind === 'node') Object.assign(scope.node, a);
        else if (kind === 'edge') Object.assign(scope.edge, a);
        else Object.assign(scope.cluster ? scope.graph : g.attrs, a);
        continue;
      }
      if ((t.t === 'id' || t.t === 'html') && peek(1).t === 'punct' && peek(1).v === '=' && !(t.t === 'id' && KEYWORDS.has(t.v.toLowerCase()) && !t.quoted)) {
        next();
        next();
        const v = id();
        (scope.cluster ? scope.graph : g.attrs)[t.v] = v.t === 'html' ? `<${v.v}>` : v.v;
        continue;
      }
      const line = t.line;
      const first = operand(scope);
      if (peek().t === 'edgeop') {
        const chain = [first];
        while (peek().t === 'edgeop') {
          const op = next();
          if (op.v === '->' && !g.directed) throw new DotError('“->” in an undirected graph (use “--”)', op.line);
          if (op.v === '--' && g.directed) throw new DotError('“--” in a directed graph (use “->”)', op.line);
          chain.push(operand(scope));
        }
        const a = attrList();
        for (let k = 0; k + 1 < chain.length; k++) {
          for (const from of chain[k].nodes) {
            for (const to of chain[k + 1].nodes) {
              if (g.strict && g.edges.some((e) => (e.from === from && e.to === to) || (!g.directed && e.from === to && e.to === from))) continue;
              g.edges.push({ from, to, attrs: { ...scope.edge, ...a }, line, fromPort: chain[k].port, toPort: chain[k + 1].port });
            }
          }
        }
      } else {
        const a = attrList();
        if (first.nodes.length === 1 && !(t.t === 'punct' || isKw(t, 'subgraph'))) addNode(first.nodes[0], scope, line, a);
      }
    }
  };

  expect('{');
  const root: Scope = { node: {}, edge: {}, graph: g.attrs, members: new Set() };
  stmts(root);
  expect('}');
  if (peek().t !== 'eof') throw new DotError(`unexpected “${peek().v}” after the graph`, peek().line);
  return g;
}

/** A node's label text: \N (name), \G (graph), \n \l \r line breaks; HTML labels lose their tags. */
export function labelText(raw: string | undefined, nodeId: string, graphName: string): string {
  if (raw === undefined) return nodeId;
  if (raw.startsWith('<') && raw.endsWith('>')) {
    return raw
      .slice(1, -1)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(tr|td|p)>/gi, (m) => (m.toLowerCase() === '</td>' ? ' ' : '\n'))
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim();
  }
  return raw
    .replace(/\\N/g, nodeId)
    .replace(/\\G/g, graphName)
    .replace(/\\[nlr]/g, '\n')
    .replace(/\\(.)/g, '$1')
    .replace(/\n$/, '');
}
