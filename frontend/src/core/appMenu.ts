// The app menu (☰ in the sidebar): the everyday actions at the top, the rest
// grouped into submenus. Built from the command registry each time it opens,
// so only commands available right now appear; a command not placed below
// still shows up in a submenu named after its category, so nothing is lost.
import { commands } from './commands';
import { formatShortcut } from './keys';
import { settings } from './settings.svelte';
import type { MenuControl, MenuItem } from './ui.svelte';
import { t } from './i18n';

// A control row stands for the commands it covers (they stay in the palette).
// `always`: shown even when none of them is available now (a setting, not an action on the open file).
type Entry = string | '-' | { label: string; items: Entry[] } | { control: MenuControl; covers: string[]; always?: boolean };

/** On/off options: shown as the thing's name with a check mark when it's on. */
const CHECKS: Record<string, [string, () => boolean]> = {
  'view.toggleSidebar': [t('Sidebar'), () => settings.value.sidebarVisible],
  'view.togglePanels': [t('Side panels'), () => !settings.value.panelsHidden],
  'view.togglePathBar': [t('Path bar'), () => !settings.value.pathBarOff],
  'view.toggleHidden': [t('Hidden files'), () => settings.value.showHidden],
  'view.previewByDefault': [t('Open files in preview mode'), () => !!settings.value.openInPreview],
  'text.toggleWrap': [t('Word wrap'), () => settings.value.wordWrap],
  'text.toggleMinimap': [t('Minimap'), () => !settings.value.minimapOff],
  'text.toggleWhitespace': [t('Spaces and tabs'), () => settings.value.showWhitespace],
};

const LAYOUT: Entry[] = [
  'file.quickOpen',
  'app.palette',
  'file.open',
  'file.openFolder',
  {
    label: t('New'),
    items: ['file.new', 'file.newMarkdown', 'file.newDocx', 'file.newXlsx', 'file.newImage', '-', 'file.newOf', 'file.imagesToPdf', 'archive.create'],
  },
  '-',
  'file.save',
  'file.saveAs',
  'file.saveConvert',
  'file.saveAll',
  {
    label: t('This file'),
    items: [
      'file.history',
      'file.compareWith',
      'view.togglePreview',
      '-',
      'file.revert',
      'file.stopConvert',
      'file.pin',
      'file.copyPath',
      'file.showInFolder',
      'file.reveal',
      '-',
      'text.reopenEncoding',
      'text.saveEncoding',
      'text.lineEndings',
    ],
  },
  { label: t('Folder'), items: ['search.inFolder', 'folder.refresh', 'folder.close'] },
  '-',
  { label: t('Edit'), items: ['edit.find', 'text.replace', 'text.gotoLine', 'text.gotoSymbol'] },
  // (the open file's own commands — Image, PDF, … — are added here)
  {
    label: t('Tools'),
    items: [
      'file.compare',
      'history.all',
      '-',
      'tools.hash',
      'tools.verify',
      '-',
      'screenshot.region',
      'screenshot.screen',
      'screenshot.delayed',
      'tools.pickColour',
      '-',
      'semantic.settings',
      'semantic.toggle',
      'semantic.reindex',
    ],
  },
  '-',
  {
    label: t('View'),
    items: [
      'view.toggleSidebar',
      'view.togglePanels',
      'view.togglePathBar',
      'view.toggleHidden',
      '-',
      'view.previewByDefault',
      'text.toggleWrap',
      'text.toggleMinimap',
      'text.toggleWhitespace',
      '-',
      { control: 'split', covers: ['view.splitColumns', 'view.splitRows', 'view.splitThree', 'view.splitGrid', 'view.unsplit'] },
      'view.nextPane',
      'view.prevPane',
      '-',
      'view.showFiles',
    ],
  },
  { control: 'theme', covers: ['view.toggleTheme', 'view.themeSystem', 'view.themeDark', 'view.themeLight'] },
  { control: 'uiScale', covers: ['view.uiBigger', 'view.uiSmaller', 'view.uiReset'] },
  { control: 'fontSize', covers: ['text.zoomIn', 'text.zoomOut', 'text.zoomReset'], always: true },
  'app.settings',
  '-',
  { label: t('Tabs'), items: ['tab.new', 'tab.newWindow', '-', 'tab.close', 'tab.closeOthers', 'tab.closeAll', 'tab.reopen', '-', 'tab.next', 'tab.prev'] },
  { label: t('Help'), items: ['help.welcome', 'help.shortcuts', 'help.updates'] },
];

/** How long per-file-type lists are split: editing, then viewing and moving around. */
// The words are translated as a list of how such command names begin in the language.
const starts = (words: string) => new RegExp(`^(${words})(?![\\p{L}\\p{N}])`, 'u');
const SUBGROUPS: [string, RegExp][] = [
  [t('Edit'), starts(t('Undo|Redo|Cut|Copy|Paste|Delete|Duplicate|Select|Deselect|Invert selection|Clear selection'))],
  [t('View'), starts(t('Zoom|Fit|Actual size|Next|Previous|Go to|Back|Forward|Full screen|Show|Toggle'))],
];

/** Categories whose leftover commands get their own submenu at the end of the shell part. */
const SHELL = new Set([t('File'), t('Edit'), t('Go'), t('View'), t('Tabs'), t('Tools'), t('Search'), t('Help')]);

function placed(es: Entry[], out = new Set<string>()): Set<string> {
  for (const e of es) {
    if (typeof e === 'string') out.add(e);
    else if ('control' in e) e.covers.forEach((id) => out.add(id));
    else placed(e.items, out);
  }
  return out;
}

/** Drop empty submenus, separators at the ends and doubled ones (left by commands not available now). */
function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.items && !it.items.length) continue;
    if (it.separator && (!out.length || out[out.length - 1].separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

/** How a tool's command name begins ("Tool: brush"). */
const TOOL = t('Tool: {name}', { name: '' });

export function appMenuItems(): MenuItem[] {
  const avail = new Map(commands.available().map((c) => [c.id, c]));
  const item = (id: string): MenuItem | null => {
    const c = avail.get(id);
    if (!c) return null;
    const sc = commands.shortcutOf(id);
    const check = CHECKS[id];
    return { label: check?.[0] ?? c.title, checked: check?.[1](), shortcut: sc ? formatShortcut(sc) : undefined, run: () => commands.execute(id) };
  };
  const es = (list: Entry[]): MenuItem[] =>
    list.flatMap((e): MenuItem[] => {
      if (e === '-') return [{ separator: true }];
      if (typeof e === 'string') return [item(e)].filter((x): x is MenuItem => !!x);
      if ('control' in e) return e.always || e.covers.some((id) => avail.has(id)) ? [{ control: e.control }] : [];
      const items = es(e.items);
      // "Split view: two side by side" reads "Two side by side" inside Split view.
      const pre = `${e.label.toLowerCase()}: `;
      for (const it of items) if (it.label?.toLowerCase().startsWith(pre)) it.label = it.label.slice(pre.length).replace(/^./, (ch) => ch.toUpperCase());
      return [{ label: e.label, items }]; // kept even if empty until leftovers are placed
    });

  const top = es(LAYOUT);
  // Everything else, by category: the open file's commands (Image, PDF, …) go
  // before Tools, leftovers of the shell's own categories into their submenu.
  const known = placed(LAYOUT);
  const extra = new Map<string, MenuItem[]>();
  const tools = new Map<string, MenuItem[]>();
  for (const c of avail.values()) {
    if (known.has(c.id) || c.hidden) continue;
    const g = c.category ?? t('More');
    // "Tool: brush", "Tool: text"… of one file type: a Tools submenu of their own.
    const into = c.title.startsWith(TOOL) ? tools : extra;
    if (!into.has(g)) into.set(g, []);
    const it = item(c.id)!;
    if (into === tools) it.label = c.title.slice(TOOL.length).replace(/^./, (ch) => ch.toUpperCase());
    into.get(g)!.push(it);
  }
  for (const [g, items] of tools) {
    if (!extra.has(g)) extra.set(g, []);
    extra.get(g)!.unshift({ label: t('Tools'), items }, { separator: true });
  }
  // A long list for one file type gets its editing and viewing commands
  // grouped too, so what's particular to it (rotate, resize, layers…) stands out.
  for (const [g, items] of extra) {
    if (SHELL.has(g) || items.length <= 14) continue;
    const groups = SUBGROUPS.map(([label, re]) => ({ label, items: items.filter((it) => !it.items && re.test(it.label ?? '')) }));
    const rest = items.filter((it) => it.items || it.separator || !SUBGROUPS.some(([, re]) => re.test(it.label ?? '')));
    const subs = groups.filter((x) => x.items.length > 1);
    extra.set(g, tidy([...rest.filter((it) => it.items), ...subs, { separator: true }, ...rest.filter((it) => !it.items), ...groups.filter((x) => x.items.length === 1).flatMap((x) => x.items)]));
  }
  const fileKinds: MenuItem[] = [];
  for (const [g, items] of extra) {
    const sub = top.find((x) => x.label === g && x.items);
    if (sub) sub.items = tidy([...sub.items!, { separator: true }, ...items]);
    else if (SHELL.has(g)) top.push({ label: g, items });
    else fileKinds.push({ label: g, items });
  }
  const at = top.findIndex((x) => x.label === t('Tools'));
  top.splice(at < 0 ? top.length : at, 0, ...fileKinds);
  return tidy(top.map((x) => (x.items ? { ...x, items: tidy(x.items.map((u) => (u.items ? { ...u, items: tidy(u.items) } : u))) } : x)));
}
