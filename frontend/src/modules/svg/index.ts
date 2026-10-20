import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { svgViews, type SvgView, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? svgViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);
const inDesign = () => active()?.get() === 'design';
const op = (o: Parameters<SvgView['design']>[0]) => () => active()?.design(o);

commands.register(
  { id: 'svg.togglePreview', title: 'Toggle preview', category: 'SVG', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(({ design: 'source', source: 'split', split: 'preview', preview: 'design' } as const)[active()!.get()]) },
  { id: 'svg.split', title: 'Source and preview', category: 'SVG', when: () => !!active(), run: set('split') },
  { id: 'svg.source', title: 'Source only', category: 'SVG', when: () => !!active(), run: set('source') },
  { id: 'svg.preview', title: 'Preview only', category: 'SVG', when: () => !!active(), run: set('preview') },
  { id: 'svg.design', title: 'Design (edit visually)', category: 'SVG', when: () => !!active(), run: set('design') },
  { id: 'svg.delete', title: 'Delete selected shape', category: 'SVG', shortcut: ['Delete', 'Backspace'], inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op('delete') },
  { id: 'svg.duplicate', title: 'Duplicate selected shape', category: 'SVG', shortcut: 'Mod+D', inInputs: false, when: () => !!active()?.hasSelection(), run: op('duplicate') },
  { id: 'svg.deselect', title: 'Deselect', category: 'SVG', shortcut: 'Escape', hidden: true, when: () => !!active()?.hasSelection(), run: op('deselect') },
  { id: 'svg.undo', title: 'Undo', category: 'SVG', shortcut: 'Mod+Z', inInputs: false, hidden: true, when: inDesign, run: op('undo') },
  { id: 'svg.redo', title: 'Redo', category: 'SVG', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: inDesign, run: op('redo') },
  ...(
    [
      ['ArrowLeft', -1, 0],
      ['ArrowRight', 1, 0],
      ['ArrowUp', 0, -1],
      ['ArrowDown', 0, 1],
    ] as const
  ).flatMap(([key, dx, dy]) => [
    { id: `svg.nudge.${key}`, title: `Nudge ${key.slice(5).toLowerCase()}`, category: 'SVG', shortcut: key, inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op(`nudge:${dx},${dy}`) },
    { id: `svg.nudge10.${key}`, title: `Nudge ${key.slice(5).toLowerCase()} by 10`, category: 'SVG', shortcut: `Shift+${key}`, inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op(`nudge:${dx * 10},${dy * 10}`) },
  ]),
  ...(
    [
      ['V', 'select'],
      ['H', 'hand'],
      ['R', 'rect'],
      ['E', 'ellipse'],
      ['L', 'line'],
      ['P', 'pen'],
      ['T', 'text'],
    ] as const
  ).map(([key, tool]) => ({ id: `svg.tool.${tool}`, title: `Tool: ${tool}`, category: 'SVG', shortcut: key, inInputs: false, hidden: true, when: inDesign, run: op(`tool:${tool}`) })),
  { id: 'svg.exportPng', title: 'Export as PNG…', category: 'SVG', when: () => !!active(), run: () => active()?.exportPng() },
);

export { default } from './SvgModule.svelte';
