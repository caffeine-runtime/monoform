// Pasting and dropping images/files into a markdown note.
import { EditorView } from '@codemirror/view';
import { api, endpoint, postBytes } from '../../core/backend';
import { dropHandlers } from '../../core/drop';
import { basename, extname } from '../../core/paths';
import type { Tab } from '../../core/tabs.svelte';
import type { Accepts } from '../../core/transfer.svelte';
import { workspace } from '../../core/tabs.svelte';
import { toastError, ui } from '../../core/ui.svelte';
import { t } from '../../core/i18n';
import { controllers } from '../text/controllers';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };

function linkFor(rel: string, name: string, image: boolean): string {
  const target = /[\s()<>]/.test(rel) ? `<${rel}>` : rel;
  return image ? `![${name}](${target})` : `[${name}](${target})`;
}

function insertAt(view: EditorView, pos: number, text: string) {
  const line = view.state.doc.lineAt(pos);
  // Images get their own line unless we're at a line start.
  const prefix = pos > line.from && IMAGE_EXT.some(() => text.startsWith('!')) ? '\n' : '';
  view.dispatch({ changes: { from: pos, insert: prefix + text }, selection: { anchor: pos + prefix.length + text.length } });
  view.focus();
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function noteOrWarn(tab: Tab): Promise<string | null> {
  if (tab.filePath && !tab.readOnly) return tab.filePath;
  ui.toast(t('Save the note first — images are stored in an assets/ folder next to it.'), 'warning');
  return null;
}

/** Upload image blobs (paste or browser drop) into assets/ and insert links. */
async function insertBlobs(tab: Tab, view: EditorView, pos: number, files: File[]) {
  const note = await noteOrWarn(tab);
  if (!note) return;
  const links: string[] = [];
  for (const f of files) {
    const ext = MIME_EXT[f.type] ?? (extname(f.name) || 'png');
    const name = f.name && f.name !== 'image.png' ? f.name : `pasted-${stamp()}.${ext}`;
    try {
      const res = await postBytes<{ rel: string; path: string }>(endpoint('asset', { note, name }), f);
      links.push(linkFor(res.rel, basename(name).replace(/\.[^.]+$/, ''), true));
    } catch (e) {
      toastError(e, t('Could not save image'));
    }
  }
  if (links.length) insertAt(view, pos, links.join('\n'));
}

/** Insert links for files on disk: images are copied into assets/, others linked. */
async function insertPaths(tab: Tab, view: EditorView, pos: number, paths: string[], copyImages: boolean) {
  const note = await noteOrWarn(tab);
  if (!note) return;
  const links: string[] = [];
  for (const p of paths) {
    const image = IMAGE_EXT.includes(extname(p));
    const name = basename(p).replace(/\.[^.]+$/, '');
    try {
      const rel = image && copyImages ? (await api.CopyAsset(note, p)).rel : await api.RelPath(note, p);
      links.push(linkFor(rel, name, image));
    } catch (e) {
      toastError(e, t('Could not link {name}', { name: basename(p) }));
    }
  }
  if (links.length) insertAt(view, pos, links.join('\n'));
}

/**
 * What a note takes from other tabs: an image is saved into assets/ and
 * linked, files are linked where they are (images copied), text is inserted —
 * at the drop point or the cursor.
 */
export function noteAccepts(tab: Tab, view: EditorView): Accepts {
  return {
    kinds: ['image', 'text', 'files'],
    take: async (t, at) => {
      if (tab.readOnly || view.state.readOnly) return false;
      const pos = (at && view.posAtCoords(at)) ?? view.state.selection.main.head;
      if (t.kind === 'text') insertAt(view, pos, t.text);
      else if (t.kind === 'files') await insertPaths(tab, view, pos, t.paths, false);
      else {
        const blob = await new Promise<Blob | null>((r) => t.image.toBlob(r, 'image/png'));
        if (!blob) return false;
        const name = `${(t.name || 'image').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)}-${stamp()}.png`;
        await insertBlobs(tab, view, pos, [new File([blob], name, { type: 'image/png' })]);
      }
      return true;
    },
  };
}

export function assetHandlers(tab: Tab) {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return false;
      e.preventDefault();
      void insertBlobs(tab, view, view.state.selection.main.head, files);
      return true;
    },
    drop(e, view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
      const internal = e.dataTransfer?.getData('application/x-mf-path');
      if (internal) {
        e.preventDefault();
        // Files from the sidebar are linked where they are, not copied.
        void insertPaths(tab, view, pos, [internal], false);
        return true;
      }
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void insertBlobs(tab, view, pos, files);
        return true;
      }
      return false;
    },
  });
}

// Files dropped from the OS (Wails gives us paths and window coordinates).
dropHandlers.push((x, y, paths) => {
  const tab = workspace.active;
  if (!tab || tab.moduleId !== 'markdown') return false;
  const el = document.elementFromPoint(x, y);
  const ctl = controllers.get(tab.id);
  if (!ctl || !el || !ctl.view.dom.contains(el)) return false;
  const pos = ctl.view.posAtCoords({ x, y }) ?? ctl.view.state.selection.main.head;
  void insertPaths(tab, ctl.view, pos, paths, true);
  return true;
});
