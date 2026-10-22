// "New file of a type": Markdown, Word, Excel, CSV, image, SVG, HTML… Go
// writes a valid starter file (internal/newfile); this asks for the kind,
// image size and name, then opens the result.
import { api } from './backend';
import { join, extname } from './paths';
import { tree } from './tree.svelte';
import { workspace } from './tabs.svelte';
import { toastError, ui } from './ui.svelte';
import { t } from './i18n';

export interface NewKind {
  kind: string;
  label: string;
  /** "New Markdown note": the title of the name dialog. */
  title: string;
  ext: string;
  detail: string;
}

export const NEW_KINDS: NewKind[] = [
  { kind: 'markdown', label: t('Markdown note'), title: t('New Markdown note'), ext: 'md', detail: `.md — ${t('formatted notes, plain text')}` },
  { kind: 'docx', label: t('Word document'), title: t('New Word document'), ext: 'docx', detail: `.docx — ${t('opens in Word, LibreOffice, Pages')}` },
  { kind: 'xlsx', label: t('Spreadsheet'), title: t('New spreadsheet'), ext: 'xlsx', detail: `.xlsx — ${t('opens in Excel, LibreOffice, Numbers')}` },
  { kind: 'csv', label: t('CSV table'), title: t('New CSV table'), ext: 'csv', detail: `.csv — ${t('plain-text table')}` },
  { kind: 'image', label: t('Image'), title: t('New image'), ext: 'png', detail: `.png — ${t('blank canvas to draw on')}` },
  { kind: 'svg', label: t('SVG drawing'), title: t('New SVG drawing'), ext: 'svg', detail: `.svg — ${t('vector graphic')}` },
  { kind: 'html', label: t('Web page'), title: t('New web page'), ext: 'html', detail: `.html — ${t('page with a basic template')}` },
  { kind: 'json', label: t('JSON file'), title: t('New JSON file'), ext: 'json', detail: '.json' },
  { kind: 'text', label: t('Plain text'), title: t('New text file'), ext: 'txt', detail: '.txt' },
];

const SIZES = [
  { id: '1920x1080', label: '1920 × 1080', detail: t('Full HD, landscape') },
  { id: '1080x1080', label: '1080 × 1080', detail: t('Square') },
  { id: '1080x1920', label: '1080 × 1920', detail: t('Portrait (phone)') },
  { id: '1280x720', label: '1280 × 720', detail: 'HD' },
  { id: '2480x3508', label: '2480 × 3508', detail: t('A4 at 300 dpi') },
  { id: '512x512', label: '512 × 512', detail: t('Icon') },
  { id: 'custom', label: t('Custom size…'), detail: t('Width × height in pixels') },
];

async function imageOptions(): Promise<{ width: number; height: number; background: string } | null> {
  let size = await ui.pick(t('Image size'), SIZES);
  if (!size) return null;
  if (size === 'custom') {
    size = await ui.prompt(t('Size in pixels (width × height)'), '1600x900', t('Next'));
    if (!size) return null;
  }
  const m = /^\s*(\d+)\s*[x×*,]\s*(\d+)\s*$/i.exec(size);
  if (!m || +m[1] < 1 || +m[2] < 1 || +m[1] > 8192 || +m[2] > 8192) {
    ui.toast(t('Enter a size like 1600x900 (up to 8192 per side).'), 'error');
    return null;
  }
  const background = await ui.pick(t('Background'), [
    { id: 'transparent', label: t('Transparent') },
    { id: 'white', label: t('White') },
    { id: 'black', label: t('Black') },
  ]);
  if (!background) return null;
  return { width: +m[1], height: +m[2], background };
}

/** A free "Untitled.ext", "Untitled 2.ext", … name in dir. */
async function freeName(dir: string, ext: string): Promise<string> {
  const names = Array.from({ length: 100 }, (_, i) => (i === 0 ? `${t('Untitled')}.${ext}` : `${t('Untitled {n}', { n: String(i + 1) })}.${ext}`));
  const taken = await api.Exists(names.map((n) => join(dir, n)));
  return names[taken.indexOf(false)] ?? `${t('Untitled')}.${ext}`;
}

/**
 * Create a new file. Without dir it goes into the open folder, or asks
 * where to save when no folder is open. Returns the new path.
 */
export async function newFileOfKind(dir?: string, kindId?: string): Promise<string | null> {
  const id = kindId ?? (await ui.pick(t('New file'), NEW_KINDS.map((k) => ({ id: k.kind, label: k.label, detail: k.detail }))));
  const kind = NEW_KINDS.find((k) => k.kind === id);
  if (!kind) return null;
  const opts = kind.kind === 'image' ? await imageOptions() : { width: 0, height: 0, background: '' };
  if (!opts) return null;
  const target = dir ?? workspace.folder;
  let path: string | null;
  if (target) {
    let name = await ui.prompt(kind.title, await freeName(target, kind.ext), t('Create'), true);
    if (!name) return null;
    if (extname(name) !== kind.ext) name += `.${kind.ext}`;
    path = join(target, name);
  } else {
    path = await api.SaveFileDialog(kind.title, `${t('Untitled')}.${kind.ext}`, [{ name: kind.label, patterns: `*.${kind.ext}` }]);
    if (!path) return null;
    if (extname(path) !== kind.ext) path += `.${kind.ext}`;
  }
  try {
    await api.CreateFromTemplate(path, kind.kind, opts);
  } catch (e) {
    toastError(e, t('Could not create {path}', { path }));
    return null;
  }
  if (target) await tree.refreshDir(target);
  await workspace.openPath(path);
  return path;
}
