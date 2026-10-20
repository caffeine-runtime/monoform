// Pending grid edits for a database table: changed cells, new rows and
// deleted rows, kept until Save writes them in one transaction (like "Write
// changes" in DB Browser for SQLite) or Revert drops them. Pure; unit-tested.

export type Value = string | number | null;

/** One statement's result from the SQL console. */
export interface Result {
  sql: string;
  columns?: string[];
  rows?: Value[][];
  more?: boolean;
  affected: number;
  millis: number;
  error?: string;
}

export interface Change {
  table: string;
  kind: 'update' | 'insert' | 'delete';
  rowid?: number | string;
  values?: Record<string, Value>;
}

export interface Pending {
  /** "table\0rowid" → column → new value */
  updates: Map<string, Record<string, Value>>;
  /** new rows per table, in order (shown after the table's rows) */
  inserts: Map<string, Record<string, Value>[]>;
  /** "table\0rowid" */
  deletes: Set<string>;
}

export const empty = (): Pending => ({ updates: new Map(), inserts: new Map(), deletes: new Set() });

export function clone(p: Pending): Pending {
  return {
    updates: new Map([...p.updates].map(([k, v]) => [k, { ...v }])),
    inserts: new Map([...p.inserts].map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    deletes: new Set(p.deletes),
  };
}

const key = (table: string, rowid: number | string) => `${table}\u0000${rowid}`;

/** What a typed cell value means: "NULL" is SQL NULL, numbers stay text (SQLite's column affinity converts). */
export function parseInput(text: string): Value {
  return text === 'NULL' ? null : text;
}

export function display(v: Value | undefined): string {
  return v === null || v === undefined ? 'NULL' : String(v);
}

export function setCell(p: Pending, table: string, rowid: number | string, col: string, value: Value): Pending {
  const n = clone(p);
  const k = key(table, rowid);
  n.updates.set(k, { ...(n.updates.get(k) ?? {}), [col]: value });
  return n;
}

export function setInsertCell(p: Pending, table: string, index: number, col: string, value: Value): Pending {
  const n = clone(p);
  const rows = n.inserts.get(table) ?? [];
  if (!rows[index]) return p;
  rows[index] = { ...rows[index], [col]: value };
  n.inserts.set(table, rows);
  return n;
}

export function addRow(p: Pending, table: string): Pending {
  const n = clone(p);
  n.inserts.set(table, [...(n.inserts.get(table) ?? []), {}]);
  return n;
}

/** Delete existing rows (by rowid) and/or pending new rows (by index). */
export function deleteRows(p: Pending, table: string, rowids: (number | string)[], newRows: number[] = []): Pending {
  const n = clone(p);
  for (const id of rowids) {
    n.deletes.add(key(table, id));
    n.updates.delete(key(table, id));
  }
  if (newRows.length) n.inserts.set(table, (n.inserts.get(table) ?? []).filter((_, i) => !newRows.includes(i)));
  return n;
}

export function override(p: Pending, table: string, rowid: number | string, col: string): { set: boolean; value: Value } {
  const u = p.updates.get(key(table, rowid));
  return u && col in u ? { set: true, value: u[col] } : { set: false, value: null };
}

export const isDeleted = (p: Pending, table: string, rowid: number | string) => p.deletes.has(key(table, rowid));
export const isChanged = (p: Pending, table: string, rowid: number | string) => p.updates.has(key(table, rowid));

export function count(p: Pending): number {
  let n = p.deletes.size;
  for (const u of p.updates.values()) n += Object.keys(u).length;
  for (const rows of p.inserts.values()) n += rows.length;
  return n;
}

/** Changes to send: updates, then inserts, then deletes. */
export function toChanges(p: Pending): Change[] {
  const out: Change[] = [];
  const split = (k: string) => {
    const i = k.indexOf('\u0000');
    const id = k.slice(i + 1);
    return { table: k.slice(0, i), rowid: /^-?\d+$/.test(id) ? Number(id) : id };
  };
  for (const [k, values] of p.updates) out.push({ ...split(k), kind: 'update', values });
  for (const [table, rows] of p.inserts) for (const values of rows) out.push({ table, kind: 'insert', values });
  for (const k of p.deletes) out.push({ ...split(k), kind: 'delete' });
  return out;
}
