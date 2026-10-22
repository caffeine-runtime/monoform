import { commands } from '../../core/commands';
import { t } from '../../core/i18n';
import { workspace } from '../../core/tabs.svelte';
import { registerTextCommands } from '../text/commands';
import { svgViews, type SvgView, type ViewMode } from './views';

registerTextCommands();

const active = () => (workspace.active ? svgViews.get(workspace.active.id) : undefined);
const set = (v: ViewMode) => () => active()?.set(v);
const inDesign = () => active()?.get() === 'design';
const op = (o: Parameters<SvgView['design']>[0]) => () => active()?.design(o);

commands.register(
  { id: 'svg.togglePreview', title: t('Toggle preview'), category: 'SVG', shortcut: 'Mod+Shift+V', when: () => !!active(), run: () => active()?.set(({ design: 'source', source: 'split', split: 'preview', preview: 'design' } as const)[active()!.get()]) },
  { id: 'svg.split', title: t('Source and preview'), category: 'SVG', when: () => !!active(), run: set('split') },
  { id: 'svg.source', title: t('Source only'), category: 'SVG', when: () => !!active(), run: set('source') },
  { id: 'svg.preview', title: t('Preview only'), category: 'SVG', when: () => !!active(), run: set('preview') },
  { id: 'svg.design', title: t('Design (edit visually)'), category: 'SVG', when: () => !!active(), run: set('design') },
  { id: 'svg.delete', title: t('Delete selected shape'), category: 'SVG', shortcut: ['Delete', 'Backspace'], inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op('delete') },
  { id: 'svg.duplicate', title: t('Duplicate selected shape'), category: 'SVG', shortcut: 'Mod+D', inInputs: false, when: () => !!active()?.hasSelection(), run: op('duplicate') },
  { id: 'svg.deselect', title: t('Deselect'), category: 'SVG', shortcut: 'Escape', hidden: true, when: () => !!active()?.hasSelection(), run: op('deselect') },
  { id: 'svg.undo', title: t('Undo'), category: 'SVG', shortcut: 'Mod+Z', inInputs: false, hidden: true, when: inDesign, run: op('undo') },
  { id: 'svg.redo', title: t('Redo'), category: 'SVG', shortcut: ['Mod+Shift+Z', 'Mod+Y'], inInputs: false, hidden: true, when: inDesign, run: op('redo') },
  ...(
    [
      ['ArrowLeft', -1, 0, t('Nudge left'), t('Nudge left by 10')],
      ['ArrowRight', 1, 0, t('Nudge right'), t('Nudge right by 10')],
      ['ArrowUp', 0, -1, t('Nudge up'), t('Nudge up by 10')],
      ['ArrowDown', 0, 1, t('Nudge down'), t('Nudge down by 10')],
    ] as const
  ).flatMap(([key, dx, dy, title, title10]) => [
    { id: `svg.nudge.${key}`, title, category: 'SVG', shortcut: key, inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op(`nudge:${dx},${dy}`) },
    { id: `svg.nudge10.${key}`, title: title10, category: 'SVG', shortcut: `Shift+${key}`, inInputs: false, hidden: true, when: () => !!active()?.hasSelection(), run: op(`nudge:${dx * 10},${dy * 10}`) },
  ]),
  ...(
    [
      ['V', 'select', t('Tool: select')],
      ['H', 'hand', t('Tool: hand')],
      ['R', 'rect', t('Tool: rect')],
      ['E', 'ellipse', t('Tool: ellipse')],
      ['L', 'line', t('Tool: line')],
      ['P', 'pen', t('Tool: pen')],
      ['T', 'text', t('Tool: text')],
    ] as const
  ).map(([key, tool, title]) => ({ id: `svg.tool.${tool}`, title, category: 'SVG', shortcut: key, inInputs: false, hidden: true, when: inDesign, run: op(`tool:${tool}`) })),
  { id: 'svg.exportPng', title: t('Export as PNG…'), category: 'SVG', when: () => !!active(), run: () => active()?.exportPng() },
);

export { default } from './SvgModule.svelte';
