import { commands, type Command } from '../../core/commands';
import { t } from '../../core/i18n';
import { workspace } from '../../core/tabs.svelte';
import { cadViews, type CadOp, type CadTool, type CadView } from './views';

const active = (): CadView | undefined => (workspace.active ? cadViews.get(workspace.active.id) : undefined);
const has = () => !!active();
const edit = () => !!active()?.editable();
const op = (o: CadOp) => () => active()?.op(o);
const tool = (id: CadTool) => () => active()?.tool(id);

const TOOLS: [CadTool, string, string, boolean][] = [
  ['select', t('Tool: select'), 'V', false],
  ['pan', t('Tool: pan'), 'H', false],
  ['measure', t('Tool: measure distance'), 'D', false],
  ['line', t('Tool: line'), 'L', true],
  ['polyline', t('Tool: polyline'), 'P', true],
  ['rect', t('Tool: rectangle'), 'B', true],
  ['circle', t('Tool: circle'), 'C', true],
  ['arc', t('Tool: arc (3 points)'), 'A', true],
  ['text', t('Tool: text'), 'T', true],
  ['move', t('Tool: move'), 'M', true],
  ['copy', t('Tool: copy'), 'O', true],
  ['rotate', t('Tool: rotate'), 'R', true],
  ['scale', t('Tool: scale'), 'S', true],
];

const cmds: Command[] = [
  ...TOOLS.map(([id, title, key, needsEdit]): Command => ({ id: `cad.tool.${id}`, title, category: 'CAD', shortcut: key, when: needsEdit ? edit : has, run: tool(id) })),
  { id: 'cad.undo', title: t('Undo'), category: 'CAD', shortcut: 'Mod+Z', inInputs: false, hidden: true, when: edit, run: op('undo') },
  { id: 'cad.redo', title: t('Redo'), category: 'CAD', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: edit, run: op('redo') },
  { id: 'cad.delete', title: t('Delete selected objects'), category: 'CAD', shortcut: 'Delete', when: edit, run: op('delete') },
  { id: 'cad.duplicate', title: t('Duplicate selected objects'), category: 'CAD', shortcut: 'Mod+D', inInputs: false, when: edit, run: op('duplicate') },
  { id: 'cad.selectAll', title: t('Select all'), category: 'CAD', shortcut: 'Mod+A', inInputs: false, when: has, run: op('selectAll') },
  { id: 'cad.escape', title: t('Cancel / deselect'), category: 'CAD', shortcut: 'Escape', hidden: true, when: has, run: op('escape') },
  { id: 'cad.enter', title: t('Finish the current command'), category: 'CAD', shortcut: 'Enter', hidden: true, when: has, run: op('enter') },
  { id: 'cad.backspace', title: t('Remove the last point'), category: 'CAD', shortcut: 'Backspace', hidden: true, when: has, run: op('backspace') },
  { id: 'cad.fit', title: t('Zoom to drawing'), category: 'CAD', shortcut: ['Mod+0', 'Home'], when: has, run: op('fit') },
  { id: 'cad.zoomIn', title: t('Zoom in'), category: 'CAD', shortcut: ['Mod+=', 'Mod++'], when: has, run: op('zoomIn') },
  { id: 'cad.zoomOut', title: t('Zoom out'), category: 'CAD', shortcut: 'Mod+-', when: has, run: op('zoomOut') },
  { id: 'cad.snap', title: t('Toggle object snap'), category: 'CAD', shortcut: 'F3', when: has, run: op('snap') },
  { id: 'cad.grid', title: t('Toggle grid'), category: 'CAD', shortcut: 'F7', when: has, run: op('grid') },
  { id: 'cad.ortho', title: t('Toggle ortho (horizontal/vertical only)'), category: 'CAD', shortcut: 'F8', when: has, run: op('ortho') },
  { id: 'cad.exportSvg', title: t('Export drawing as SVG…'), category: 'CAD', when: has, run: op('exportSvg') },
  { id: 'cad.exportPng', title: t('Export drawing as PNG…'), category: 'CAD', when: has, run: op('exportPng') },
];
commands.register(...cmds);

export { default } from './CadModule.svelte';
