// Pasting into an empty tab (the start page, or no tab at all) makes a new,
// unsaved document of the right kind, as if a file of that kind had been
// opened: a picture opens in the image editor, a table copied from a
// spreadsheet in the grid, JSON in the data view, SVG in the SVG editor,
// Excalidraw/draw.io drawings on the board, Markdown as a note, … Copied files
// open as themselves. The document lives in a temp file until it is saved
// (Save asks where; closing it asks first), see Workspace.saveScratch.
import { api, saveFile } from './backend';
import { t } from './i18n';
import { classifyText } from './pasteKind';
import { isAbsolute } from './paths';
import { workspace } from './tabs.svelte';
import { pngOf, type Transfer } from './transfer.svelte';
import { toastError } from './ui.svelte';

/** Lines that are all paths of existing files (copied in a file manager): those paths, else null. */
async function copiedFiles(text: string): Promise<string[] | null> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (!l.startsWith('file://')) return l;
      try {
        const p = decodeURIComponent(new URL(l).pathname);
        return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
      } catch {
        return l;
      }
    });
  if (!lines.length || lines.length > 50 || !lines.every(isAbsolute)) return null;
  const exists = await api.Exists(lines);
  return exists.every(Boolean) ? lines : null;
}

/** Make a new unsaved document from what was pasted (or dropped) into an empty tab. */
export async function pasteAsNew(tr: Transfer): Promise<boolean> {
  try {
    if (tr.kind === 'files') {
      for (const p of tr.paths) await workspace.openPath(p);
      return true;
    }
    if (tr.kind === 'text') {
      const files = await copiedFiles(tr.text);
      if (files) {
        for (const p of files) await workspace.openPath(p);
        return true;
      }
    }
    const kind = tr.kind === 'image' ? { ext: 'png', name: tr.name && tr.name !== t('Pasted image') ? tr.name.replace(/\.\w+$/, '') : t('Pasted image') } : classifyText(tr.text);
    const name = `${kind.name}.${kind.ext}`;
    const temp = await api.TempPath(name);
    await saveFile(temp, tr.kind === 'image' ? await pngOf(tr.image) : tr.text);
    return !!(await workspace.openScratch(temp, name));
  } catch (e) {
    toastError(e, t("Couldn't paste"));
    return false;
  }
}
