import { describe, expect, it } from 'vitest';
import { addRow, count, deleteRows, display, empty, isDeleted, override, parseInput, setCell, setInsertCell, toChanges } from './edits';

describe('pending database edits', () => {
  it('collects cell edits, new rows and deletions in order', () => {
    let p = empty();
    p = setCell(p, 'people', 3, 'name', 'Ala');
    p = setCell(p, 'people', 3, 'city', null);
    p = addRow(p, 'people');
    p = setInsertCell(p, 'people', 0, 'name', 'New');
    p = deleteRows(p, 'people', [7]);
    expect(count(p)).toBe(4);
    expect(override(p, 'people', 3, 'name')).toEqual({ set: true, value: 'Ala' });
    expect(override(p, 'people', 3, 'age').set).toBe(false);
    expect(isDeleted(p, 'people', 7)).toBe(true);
    expect(toChanges(p)).toEqual([
      { table: 'people', rowid: 3, kind: 'update', values: { name: 'Ala', city: null } },
      { table: 'people', kind: 'insert', values: { name: 'New' } },
      { table: 'people', rowid: 7, kind: 'delete' },
    ]);
  });
  it('deleting drops pending edits of that row and new rows by index', () => {
    let p = setCell(empty(), 't', 1, 'a', 'x');
    p = addRow(addRow(p, 't'), 't');
    p = deleteRows(p, 't', [1], [0]);
    expect(toChanges(p).map((c) => c.kind)).toEqual(['insert', 'delete']);
  });
  it('keeps history snapshots independent', () => {
    const a = setCell(empty(), 't', 1, 'a', 'x');
    const b = setCell(a, 't', 1, 'a', 'y');
    expect(override(a, 't', 1, 'a').value).toBe('x');
    expect(override(b, 't', 1, 'a').value).toBe('y');
  });
  it('reads "NULL" as SQL NULL', () => {
    expect(parseInput('NULL')).toBeNull();
    expect(parseInput('null')).toBe('null');
    expect(display(null)).toBe('NULL');
    expect(display(3)).toBe('3');
  });
});
