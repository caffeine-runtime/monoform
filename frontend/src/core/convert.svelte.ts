// Save and convert: write the open file in another format next to it
// (internal/convert does the work), once or again on every save.
import { api } from './backend';
import { jobs } from './jobs.svelte';
import { basename, dirname, extname, join, stem } from './paths';
import { settings } from './settings.svelte';
import { afterSave, workspace, type Tab } from './tabs.svelte';
import { toastError, ui } from './ui.svelte';
import { t } from './i18n';

let table: Record<string, string[]> | null = null;

/** The formats a file converts to (extensions, in the order offered). */
export async function targetsFor(path: string): Promise<string[]> {
  table ??= (await api.ConvertFormats()) ?? {};
  return table[extname(path)] ?? [];
}

/** Same, once the table is loaded (menus are built synchronously). */
export function knownTargets(path: string | undefined): string[] {
  if (!table) void targetsFor('');
  return path ? (table?.[extname(path)] ?? []) : [];
}

type Family = 'image' | 'audio' | 'table' | 'document';

export function familyOf(path: string): Family {
  const e = extname(path);
  if (['mp3', 'wav', 'flac', 'ogg', 'oga'].includes(e)) return 'audio';
  if (['csv', 'tsv', 'xlsx', 'xlsm', 'xls', 'ods', 'json'].includes(e)) return 'table';
  if (['md', 'markdown', 'txt', 'docx', 'doc', 'odt'].includes(e)) return 'document';
  return 'image';
}

/** A format's name and what it is good for, for the list in the dialog. */
export function formatInfo(ext: string, from: Family, src = ''): { label: string; hint: string } {
  switch (ext) {
    case 'pdf': {
      // A Word file's PDF is laid out from its text, not its pages: say so.
      const word = ['docx', 'doc', 'odt'].includes(extname(src));
      return {
        label: 'PDF', // i18n-ignore: format name
        hint:
          from === 'image'
            ? t('The picture on a page of its own size')
            : from === 'table'
              ? t('The table laid out for printing')
              : word
                ? t('Text, tables and pictures laid out anew, not Word’s page layout')
                : t('Looks the same everywhere: for printing and sending'),
      };
    }
    case 'docx':
      return { label: t('Word document'), hint: t('Edit it in Word, LibreOffice or Pages') };
    case 'html':
      return { label: t('Web page'), hint: t('Opens in any browser, pictures included') };
    case 'md':
      return { label: 'Markdown', hint: t('Plain text with light formatting') }; // i18n-ignore: format name
    case 'txt':
      return { label: t('Plain text'), hint: t('Just the words') };
    case 'png':
      return { label: 'PNG', hint: t('Lossless, keeps transparency') }; // i18n-ignore: format name
    case 'jpg':
      return { label: 'JPEG', hint: t('Small files, for photos') }; // i18n-ignore: format name
    case 'webp':
      return { label: 'WebP', hint: t('Lossless, smaller than PNG') }; // i18n-ignore: format name
    case 'gif':
      return { label: 'GIF', hint: t('256 colours, for simple graphics') }; // i18n-ignore: format name
    case 'bmp':
      return { label: 'BMP', hint: t('Uncompressed, for old programs') }; // i18n-ignore: format name
    case 'tiff':
      return { label: 'TIFF', hint: t('Lossless, for print and archives') }; // i18n-ignore: format name
    case 'ico':
      return { label: t('Windows icon'), hint: t('Every size from 16 to 256 pixels') };
    case 'icns':
      return { label: t('macOS icon'), hint: t('Every size from 16 to 1024 pixels') };
    case 'flac':
      return { label: 'FLAC', hint: t('Lossless and about half the size of WAV') }; // i18n-ignore: format name
    case 'wav':
      return { label: 'WAV', hint: t('Uncompressed, plays everywhere') }; // i18n-ignore: format name
    case 'xlsx':
      return { label: t('Excel workbook'), hint: t('Opens in Excel, LibreOffice and Numbers') };
    case 'csv':
      return { label: 'CSV', hint: t('Values separated by commas; the first sheet') }; // i18n-ignore: format name
    case 'tsv':
      return { label: 'TSV', hint: t('Values separated by tabs; the first sheet') }; // i18n-ignore: format name
    case 'json':
      return { label: 'JSON', hint: t('A list of records named by the first row') }; // i18n-ignore: format name
  }
  return { label: ext.toUpperCase(), hint: '' };
}

/** The copies of a file written again on every save. */
export function companions(src: string): string[] {
  return settings.value.convertOnSave?.[src] ?? [];
}

function setCompanion(src: string, dst: string, on: boolean) {
  settings.update((s) => {
    const all = { ...(s.convertOnSave ?? {}) };
    const list = (all[src] ?? []).filter((d) => extname(d) !== extname(dst) && d !== dst);
    if (on) list.push(dst);
    if (list.length) all[src] = list;
    else delete all[src];
    s.convertOnSave = all;
  });
}

/** Stop updating one copy (or all copies) of a file on save. */
export function stopCompanion(src: string, dst?: string) {
  settings.update((s) => {
    const all = { ...(s.convertOnSave ?? {}) };
    const list = dst ? (all[src] ?? []).filter((d) => d !== dst) : [];
    if (list.length) all[src] = list;
    else delete all[src];
    s.convertOnSave = all;
  });
}

export interface ConvertChoice {
  ext: string;
  dst: string;
  always: boolean;
}

export interface ConvertRequest {
  src: string;
  targets: string[];
  /** Offer "also on every save" (the file is open in an editor). */
  canRepeat: boolean;
  resolve: (r: ConvertChoice | null) => void;
}

class ConvertUI {
  request = $state<ConvertRequest | null>(null);

  choose(src: string, targets: string[], canRepeat: boolean): Promise<ConvertChoice | null> {
    this.request?.resolve(null);
    return new Promise((resolve) => {
      this.request = {
        src,
        targets,
        canRepeat,
        resolve: (r) => {
          this.request = null;
          resolve(r);
        },
      };
    });
  }
}

export const convertUI = new ConvertUI();

/** The converted copy's default place: next to the file, same name. */
export function defaultTarget(src: string, ext: string): string {
  return join(dirname(src), `${stem(src)}.${ext}`);
}

/** Saves the tab (when it has changes or isn't on disk yet), then asks for a format and converts. */
export async function saveAndConvert(tab: Tab | null = workspace.active): Promise<string | undefined> {
  if (!tab) return;
  if (tab.dirty || tab.source.kind === 'untitled') {
    if (!(await workspace.save(tab))) return;
  }
  const src = tab.filePath;
  if (!src) {
    ui.toast(t('Only files saved on this computer can be converted.'), 'info');
    return;
  }
  const targets = await targetsFor(src);
  if (!targets.length) {
    ui.toast(t('.{ext} files can’t be converted to other formats here.', { ext: extname(src) }), 'info');
    return;
  }
  const choice = await convertUI.choose(src, targets, true);
  if (!choice) return;
  setCompanion(src, choice.dst, choice.always);
  return convertFile(src, choice.dst);
}

/** Converts src into dst's format as a job; says so when it is done. */
export async function convertFile(src: string, dst: string, quiet = false): Promise<string | undefined> {
  const done = await jobs.run<{ note: string; code: string; arg: string }>(t('Converting {name}', { name: basename(src) }), () => api.ConvertFile(src, dst));
  if (done.cancelled) return;
  if (done.error) {
    toastError(done.error, t('Couldn’t convert {name}', { name: basename(src) }));
    return;
  }
  const note = noteText(done.result?.code, done.result?.arg);
  const open = { label: t('Open'), run: () => void workspace.openPath(dst) };
  if (note) ui.toast(t('Saved {name}: {note}', { name: basename(dst), note }), 'warning', open, 6000);
  else if (quiet) ui.toast(t('Also saved {name}', { name: basename(dst) }), 'success', open, 2000);
  else ui.toast(t('Saved {name}', { name: basename(dst) }), 'success', open);
  return dst;
}

function noteText(code?: string, arg = ''): string {
  switch (code) {
    case 'firstSheet':
      return t('only the first sheet, “{sheet}”, fits in this format', { sheet: arg });
    case 'firstRows':
      return t('only the first {count} rows', { count: arg });
    case 'missingGlyphs':
      return t('the PDF’s fonts have no letters for some of the text ({chars})', { chars: arg });
  }
  return '';
}

// Every save also writes the file's chosen copies again (a little later, so
// an editor that clears its changes flag before the write lands is covered).
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<unknown>>();

afterSave.push((tab) => {
  const src = tab.filePath;
  if (!src || !companions(src).length) return;
  clearTimeout(pending.get(src));
  pending.set(
    src,
    setTimeout(async () => {
      pending.delete(src);
      await running.get(src);
      const work = (async () => {
        for (const dst of companions(src)) await convertFile(src, dst, true);
      })();
      running.set(src, work);
      await work;
      running.delete(src);
    }, 500),
  );
});
