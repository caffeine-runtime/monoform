import { commands, type Command } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { cadViews, type CadOp, type CadTool, type CadView } from './views';

const active = (): CadView | undefined => (workspace.active ? cadViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const edit = () => !!active()?.editable();
const op = (o: CadOp) => () => active()?.op(o);
const tool = (t: CadTool) => () => active()?.tool(t);

const TOOLS: [CadTool, string, string, boolean][] = [
  ['select', 'select', 'V', false],
  ['pan', 'pan', 'H', false],
  ['measure', 'measure distance', 'D', false],
  ['line', 'line', 'L', true],
  ['polyline', 'polyline', 'P', true],
  ['rect', 'rectangle', 'B', true],
  ['circle', 'circle', 'C', true],
  ['arc', 'arc (3 points)', 'A', true],
  ['text', 'text', 'T', true],
  ['move', 'move', 'M', true],
  ['copy', 'copy', 'O', true],
  ['rotate', 'rotate', 'R', true],
  ['scale', 'scale', 'S', true],
];

const cmds: Command[] = [
  ...TOOLS.map(([t, title, key, needsEdit]): Command => ({ id: `cad.tool.${t}`, title: `Tool: ${title}`, category: 'CAD', shortcut: key, when: needsEdit ? edit : has, run: tool(t) })),
  { id: 'cad.undo', title: 'Undo', category: 'CAD', shortcut: 'Mod+Z', inInputs: false, hidden: true, when: edit, run: op('undo') },
  { id: 'cad.redo', title: 'Redo', category: 'CAD', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: edit, run: op('redo') },
  { id: 'cad.delete', title: 'Delete selected objects', category: 'CAD', shortcut: 'Delete', when: edit, run: op('delete') },
  { id: 'cad.duplicate', title: 'Duplicate selected objects', category: 'CAD', shortcut: 'Mod+D', inInputs: false, when: edit, run: op('duplicate') },
  { id: 'cad.selectAll', title: 'Select all', category: 'CAD', shortcut: 'Mod+A', inInputs: false, when: has, run: op('selectAll') },
  { id: 'cad.escape', title: 'Cancel / deselect', category: 'CAD', shortcut: 'Escape', hidden: true, when: has, run: op('escape') },
  { id: 'cad.enter', title: 'Finish the current command', category: 'CAD', shortcut: 'Enter', hidden: true, when: has, run: op('enter') },
  { id: 'cad.backspace', title: 'Remove the last point', category: 'CAD', shortcut: 'Backspace', hidden: true, when: has, run: op('backspace') },
  { id: 'cad.fit', title: 'Zoom to drawing', category: 'CAD', shortcut: ['Mod+0', 'Home'], when: has, run: op('fit') },
  { id: 'cad.zoomIn', title: 'Zoom in', category: 'CAD', shortcut: ['Mod+=', 'Mod++'], when: has, run: op('zoomIn') },
  { id: 'cad.zoomOut', title: 'Zoom out', category: 'CAD', shortcut: 'Mod+-', when: has, run: op('zoomOut') },
  { id: 'cad.snap', title: 'Toggle object snap', category: 'CAD', shortcut: 'F3', when: has, run: op('snap') },
  { id: 'cad.grid', title: 'Toggle grid', category: 'CAD', shortcut: 'F7', when: has, run: op('grid') },
  { id: 'cad.ortho', title: 'Toggle ortho (horizontal/vertical only)', category: 'CAD', shortcut: 'F8', when: has, run: op('ortho') },
  { id: 'cad.exportSvg', title: 'Export drawing as SVG…', category: 'CAD', when: has, run: op('exportSvg') },
  { id: 'cad.exportPng', title: 'Export drawing as PNG…', category: 'CAD', when: has, run: op('exportPng') },
];
commands.register(...cmds);

export { default } from './CadModule.svelte';
