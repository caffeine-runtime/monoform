import { afterEach, describe, expect, it } from 'vitest';
import { appMenuItems } from './appMenu';
import { commands, type Command } from './commands';
import type { MenuItem } from './ui.svelte';

let off: (() => void)[] = [];
const reg = (...cs: Partial<Command>[]) => off.push(commands.register(...cs.map((c) => ({ run: () => {}, ...c }) as Command)));
afterEach(() => (off.forEach((f) => f()), (off = [])));

const labels = (items: MenuItem[]) => items.map((i) => (i.separator ? '—' : i.control ? `[${i.control}]` : i.items ? `${i.label} ›` : i.label));
const sub = (items: MenuItem[], name: string) => items.find((i) => i.label === name)?.items ?? [];

describe('app menu', () => {
  it('keeps everyday actions on top and groups the rest', () => {
    reg(
      { id: 'file.quickOpen', title: 'Go to file…', category: 'File', shortcut: 'Mod+P' },
      { id: 'file.save', title: 'Save', category: 'File' },
      { id: 'file.new', title: 'New text file', category: 'File' },
      { id: 'file.newMarkdown', title: 'New Markdown note', category: 'File' },
      { id: 'view.splitColumns', title: 'Split view: two side by side', category: 'View' },
      { id: 'view.splitGrid', title: 'Split view: four (grid)', category: 'View' },
      { id: 'app.settings', title: 'Settings', category: 'View' },
      { id: 'view.brandNew', title: 'Something new', category: 'View' },
      { id: 'tab.close', title: 'Close tab', category: 'Tabs' },
    );
    const m = appMenuItems();
    expect(labels(m)).toEqual(['Go to file…', 'New ›', '—', 'Save', '—', 'View ›', '[fontSize]', 'Settings', '—', 'Tabs ›']);
    expect(m[0].shortcut).toBeTruthy();
    expect(labels(sub(m, 'New'))).toEqual(['New text file', 'New Markdown note']);
    // The split layouts are one row of buttons; a command not placed is still listed under its category.
    expect(labels(sub(m, 'View'))).toEqual(['[split]', '—', 'Something new']);
  });

  it('shows options as checked items and families of commands as one control row', () => {
    reg(
      { id: 'view.toggleSidebar', title: 'Toggle sidebar', category: 'View' },
      { id: 'view.togglePathBar', title: 'Show / hide the path bar', category: 'View' },
      { id: 'view.themeDark', title: 'Theme: dark', category: 'View' },
      { id: 'view.themeLight', title: 'Theme: light', category: 'View' },
      { id: 'view.uiBigger', title: 'Interface: larger', category: 'View' },
      { id: 'app.settings', title: 'Settings', category: 'View' },
    );
    const m = appMenuItems();
    expect(labels(m)).toEqual(['View ›', '[theme]', '[uiScale]', '[fontSize]', 'Settings']); // text size: a setting, always there
    const v = sub(m, 'View');
    expect(labels(v)).toEqual(['Sidebar', 'Path bar']);
    expect(v.every((i) => typeof i.checked === 'boolean')).toBe(true);
  });

  it('adds the open file’s commands as their own submenu, tools grouped', () => {
    reg(
      { id: 'tools.hash', title: 'Compute file hash…', category: 'Tools' },
      { id: 'image.rotateCW', title: 'Rotate clockwise', category: 'Image' },
      { id: 'image.toolBrush', title: 'Tool: brush', category: 'Image' },
      { id: 'image.toolText', title: 'Tool: text', category: 'Image' },
      { id: 'image.hiddenThing', title: 'Hidden', category: 'Image', hidden: true },
    );
    const m = appMenuItems();
    expect(labels(m)).toEqual(['Image ›', 'Tools ›', '—', '[fontSize]']); // no theme/size rows: their commands aren't there
    const img = sub(m, 'Image');
    expect(labels(img)).toEqual(['Tools ›', '—', 'Rotate clockwise']);
    expect(labels(sub(img, 'Tools'))).toEqual(['Brush', 'Text']);
  });

  it('leaves out commands that are not available and their empty groups', () => {
    reg({ id: 'file.save', title: 'Save', category: 'File', when: () => false }, { id: 'file.new', title: 'New text file', category: 'File', when: () => false });
    expect(appMenuItems()).toEqual([{ control: 'fontSize' }]);
  });
});

describe('app menu: long file-type lists', () => {
  it('groups editing and viewing commands of a long list', () => {
    const cs: Partial<Command>[] = [
      'Undo', 'Redo', 'Copy selection', 'Paste as new layer', 'Select all', 'Zoom in', 'Zoom out', 'Fit to window',
      'Next image in folder', 'Rotate clockwise', 'Resize…', 'New layer', 'Flatten image', 'Remove background', 'Flip horizontally',
    ].map((title, i) => ({ id: `image.c${i}`, title, category: 'Image' }));
    reg(...cs, { id: 'image.toolBrush', title: 'Tool: brush', category: 'Image' });
    const img = sub(appMenuItems(), 'Image');
    expect(labels(img)).toEqual(['Tools ›', 'Edit ›', 'View ›', '—', 'Rotate clockwise', 'Resize…', 'New layer', 'Flatten image', 'Remove background', 'Flip horizontally']);
    expect(labels(sub(img, 'Edit'))).toEqual(['Undo', 'Redo', 'Copy selection', 'Paste as new layer', 'Select all']);
    expect(labels(sub(img, 'View'))).toEqual(['Zoom in', 'Zoom out', 'Fit to window', 'Next image in folder']);
  });
});
