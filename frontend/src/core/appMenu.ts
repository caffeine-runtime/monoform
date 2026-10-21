// The app menu (☰ in the sidebar): the everyday actions at the top, the rest
// grouped into submenus. Built from the command registry each time it opens,
// so only commands available right now appear; a command not placed below
// still shows up in a submenu named after its category, so nothing is lost.
import { commands } from './commands';
import { formatShortcut } from './keys';
import type { MenuItem } from './ui.svelte';

type Entry = string | '-' | { label: string; items: Entry[] };

const LAYOUT: Entry[] = [
  'file.quickOpen',
  'app.palette',
  'file.open',
  'file.openFolder',
  {
    label: 'New',
    items: ['file.new', 'file.newMarkdown', 'file.newDocx', 'file.newXlsx', 'file.newImage', '-', 'file.newOf', 'file.imagesToPdf', 'archive.create'],
  },
  '-',
  'file.save',
  'file.saveAs',
  'file.saveAll',
  {
    label: 'This file',
    items: [
      'file.history',
      'file.compareWith',
      'view.togglePreview',
      '-',
      'file.revert',
      'file.pin',
      'file.copyPath',
      'file.reveal',
      '-',
      'text.reopenEncoding',
      'text.saveEncoding',
      'text.lineEndings',
    ],
  },
  { label: 'Folder', items: ['search.inFolder', 'folder.refresh', 'folder.close'] },
  '-',
  { label: 'Edit', items: ['edit.find', 'text.replace', 'text.gotoLine', 'text.gotoSymbol'] },
  // (the open file's own commands — Image, PDF, … — are added here)
  {
    label: 'Tools',
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
    label: 'View',
    items: [
      'view.toggleSidebar',
      'view.showFiles',
      'view.toggleHidden',
      '-',
      'view.previewByDefault',
      'text.toggleWrap',
      'text.toggleMinimap',
      'text.toggleWhitespace',
      '-',
      'text.zoomIn',
      'text.zoomOut',
      'text.zoomReset',
    ],
  },
  {
    label: 'Split view',
    items: ['view.splitColumns', 'view.splitRows', 'view.splitThree', 'view.splitGrid', 'view.unsplit', '-', 'view.nextPane', 'view.prevPane'],
  },
  {
    label: 'Appearance',
    items: ['view.toggleTheme', 'view.themeSystem', 'view.themeDark', 'view.themeLight', '-', 'view.uiBigger', 'view.uiSmaller', 'view.uiReset'],
  },
  'app.settings',
  '-',
  { label: 'Tabs', items: ['tab.close', 'tab.closeOthers', 'tab.closeAll', 'tab.reopen', '-', 'tab.next', 'tab.prev'] },
  { label: 'Help', items: ['help.welcome', 'help.shortcuts'] },
];

/** How long per-file-type lists are split: editing, then viewing and moving around. */
const SUBGROUPS: [string, RegExp][] = [
  ['Edit', /^(Undo|Redo|Cut|Copy|Paste|Delete|Duplicate|Select|Deselect|Invert selection|Clear selection)\b/],
  ['View', /^(Zoom|Fit|Actual size|Next|Previous|Go to|Back|Forward|Full screen|Show|Toggle)\b/],
];

/** Categories whose leftover commands get their own submenu at the end of the shell part. */
const SHELL = new Set(['File', 'Edit', 'Go', 'View', 'Tabs', 'Tools', 'Search', 'Help']);

function placed(es: Entry[], out = new Set<string>()): Set<string> {
  for (const e of es) {
    if (typeof e === 'string') out.add(e);
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

export function appMenuItems(): MenuItem[] {
  const avail = new Map(commands.available().map((c) => [c.id, c]));
  const item = (id: string): MenuItem | null => {
    const c = avail.get(id);
    if (!c) return null;
    const sc = commands.shortcutOf(id);
    return { label: c.title, shortcut: sc ? formatShortcut(sc) : undefined, run: () => commands.execute(id) };
  };
  const es = (list: Entry[]): MenuItem[] =>
    list.flatMap((e): MenuItem[] => {
      if (e === '-') return [{ separator: true }];
      if (typeof e === 'string') return [item(e)].filter((x): x is MenuItem => !!x);
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
    const g = c.category ?? 'More';
    // "Tool: brush", "Tool: text"… of one file type: a Tools submenu of their own.
    const into = c.title.startsWith('Tool: ') ? tools : extra;
    if (!into.has(g)) into.set(g, []);
    const it = item(c.id)!;
    if (into === tools) it.label = c.title.slice(6).replace(/^./, (ch) => ch.toUpperCase());
    into.get(g)!.push(it);
  }
  for (const [g, items] of tools) {
    if (!extra.has(g)) extra.set(g, []);
    extra.get(g)!.unshift({ label: 'Tools', items }, { separator: true });
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
    const sub = top.find((t) => t.label === g && t.items);
    if (sub) sub.items = tidy([...sub.items!, { separator: true }, ...items]);
    else if (SHELL.has(g)) top.push({ label: g, items });
    else fileKinds.push({ label: g, items });
  }
  const at = top.findIndex((t) => t.label === 'Tools');
  top.splice(at < 0 ? top.length : at, 0, ...fileKinds);
  return tidy(top.map((t) => (t.items ? { ...t, items: tidy(t.items.map((u) => (u.items ? { ...u, items: tidy(u.items) } : u))) } : t)));
}
