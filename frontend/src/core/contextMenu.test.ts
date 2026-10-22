import { afterEach, describe, expect, it } from 'vitest';
import { CONTEXT_LISTS, commandItems } from './contextMenu';
import { commands, type Command } from './commands';
import type { MenuItem } from './ui.svelte';

let off: (() => void)[] = [];
const reg = (...cs: Partial<Command>[]) => off.push(commands.register(...cs.map((c) => ({ run: () => {}, ...c }) as Command)));
afterEach(() => (off.forEach((f) => f()), (off = [])));
const labels = (items: MenuItem[]): string[] => items.map((i) => (i.separator ? '—' : i.items ? `${i.label} › ${labels(i.items).join(', ')}` : (i.label ?? '')));

describe('context menu', () => {
  it('lists the commands available now, without empty submenus or stray separators', () => {
    reg(
      { id: 'a.one', title: 'One', shortcut: 'Mod+1' },
      { id: 'a.two', title: 'Two', when: () => false },
      { id: 'a.three', title: 'Three' },
      { id: 'a.four', title: 'Four (Ctrl+4)' },
    );
    const m = commandItems(['-', 'a.one', '-', '-', 'a.two', { label: 'Sub', items: ['a.two'] }, { label: 'More', items: ['a.three', '-'] }, '-', 'a.missing', '-']);
    expect(labels(m)).toEqual(['One', '—', 'More › Three']);
    expect(m[0].shortcut).toBeTruthy();
    // Keys written in a command's name go to the shortcut column.
    expect(commandItems(['a.four']).map((i) => `${i.label}|${i.shortcut}`)).toEqual(['Four|Ctrl+4']);
  });

  it('names only commands that exist', () => {
    // Every command id registered anywhere in the app's source.
    const ids = new Set<string>();
    const sources = import.meta.glob(['../**/*.ts', '../**/*.svelte', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const src of Object.values(sources)) for (const m of src.matchAll(/['`]([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)['`]/g)) ids.add(m[1]);
    const used: string[] = [];
    const collect = (es: unknown[]) => es.forEach((e) => (typeof e === 'string' ? e !== '-' && used.push(e) : collect((e as { items: unknown[] }).items)));
    CONTEXT_LISTS.forEach(collect);
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });
});
