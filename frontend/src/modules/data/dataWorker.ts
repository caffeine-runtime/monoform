// Parses JSON/JSONC/YAML and serves tree nodes lazily, so huge documents never
// have to be materialized as DOM or cloned to the main thread.
import { parseAllDocuments, type Document } from 'yaml';
import { parseJson, lineCol, type JsonError } from './jsonparse';

export type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface TreeNode {
  key: string | number;
  path: (string | number)[];
  type: NodeType;
  /** Display text: value for primitives, "{n}" / "[n]" for containers. */
  preview: string;
  size: number;
}

let root: unknown = undefined;
let ok = false;

function typeOf(v: unknown): NodeType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

function preview(v: unknown, t: NodeType): string {
  switch (t) {
    case 'object':
      return `{${Object.keys(v as object).length}}`;
    case 'array':
      return `[${(v as unknown[]).length}]`;
    case 'string': {
      const s = String(v);
      return JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);
    }
    default:
      return String(v);
  }
}

function at(path: (string | number)[]): unknown {
  let v: unknown = root;
  for (const p of path) v = (v as Record<string | number, unknown>)[p];
  return v;
}

function node(key: string | number, path: (string | number)[], v: unknown): TreeNode {
  const t = typeOf(v);
  const size = t === 'object' ? Object.keys(v as object).length : t === 'array' ? (v as unknown[]).length : 0;
  return { key, path, type: t, preview: preview(v, t), size };
}

function children(path: (string | number)[], offset: number, limit: number): { nodes: TreeNode[]; total: number } {
  const v = at(path);
  if (Array.isArray(v)) {
    const nodes: TreeNode[] = [];
    for (let i = offset; i < Math.min(v.length, offset + limit); i++) nodes.push(node(i, [...path, i], v[i]));
    return { nodes, total: v.length };
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return { nodes: keys.slice(offset, offset + limit).map((k) => node(k, [...path, k], (v as Record<string, unknown>)[k])), total: keys.length };
  }
  return { nodes: [], total: 0 };
}

function yamlError(docs: Document.Parsed[], text: string): JsonError | null {
  for (const d of docs) {
    const e = d.errors[0];
    if (e) {
      const pos = e.linePos?.[0];
      const offset = e.pos[0];
      const lc = pos ? { line: pos.line, col: pos.col } : lineCol(text, offset);
      return { message: e.message.split('\n')[0], offset, ...lc };
    }
  }
  return null;
}

function parse(text: string, format: string): { ok: boolean; error?: JsonError; root?: TreeNode; documents?: number } {
  ok = false;
  root = undefined;
  if (format === 'yaml') {
    const docs = parseAllDocuments(text, { prettyErrors: true, uniqueKeys: true });
    const list = Array.isArray(docs) ? docs : [docs];
    const err = yamlError(list as Document.Parsed[], text);
    if (err) return { ok: false, error: err };
    const values = (list as Document.Parsed[]).map((d) => d.toJS({ maxAliasCount: 1000 }));
    root = values.length === 1 ? values[0] : values;
    ok = true;
    return { ok: true, root: node('$', [], root), documents: values.length };
  }
  const r = parseJson(text, format === 'jsonc');
  if (!r.ok) return { ok: false, error: r.error };
  root = r.value;
  ok = true;
  return { ok: true, root: node('$', [], root) };
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  const reply = (data: object) => (self as unknown as Worker).postMessage({ id: m.id, ...data });
  try {
    switch (m.type) {
      case 'parse':
        return reply(parse(m.text, m.format));
      case 'children':
        if (!ok) return reply({ nodes: [], total: 0 });
        return reply(children(m.path, m.offset, m.limit));
      case 'stringify': {
        if (!ok) return reply({ error: 'The document has errors' });
        const v = m.path ? at(m.path) : root;
        return reply({ text: JSON.stringify(v, null, m.indent || undefined) ?? 'null' });
      }
    }
  } catch (err) {
    reply({ error: err instanceof Error ? err.message : String(err) });
  }
};
