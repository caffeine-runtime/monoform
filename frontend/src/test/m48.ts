// M48: pasting into an empty tab makes a new document in the editor for
// its kind. A picture opens in the image editor as an unsaved "Pasted
// image"; text opens by what it is (JSON → data view, a table copied from a
// spreadsheet → grid, SVG → SVG editor, Excalidraw → board, Mermaid →
// diagram, Markdown → note, anything else → text). The document is unsaved
// (dot, "Not saved yet", not in the session) until Save, which asks where
// (the native dialog is stubbed here), writes it there and drops the temp
// copy — also from the image editor's own Save menu (Save, Save as…, Save a
// copy), with the tab taking the name typed in the dialog. Closing an
// unsaved one asks first. Copied file paths open the files.
import { api } from '../core/backend';
import { modules } from '../core/modules';
import { dirname, extname, join } from '../core/paths';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { give, pasteInto } from '../core/transfer.svelte';
import { menu, ui } from '../core/ui.svelte';
import { assert, assertEq, log, sleep, waitFor } from './harness';

type Go = { SaveFileDialog: (title: string, def: string, filters: unknown) => Promise<string> };
const go = () => (window as unknown as { go: { app: { App: Go } } }).go.app.App;

async function emptyTab(): Promise<Tab> {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const start = workspace.openTool('start');
  await sleep(50);
  return start;
}

async function pasted(): Promise<Tab> {
  return waitFor(() => (workspace.active?.scratch ? workspace.active : null), 'a new document from the paste');
}

export default async function m48(dir: string) {
  const out = dir;
  const realDialog = go().SaveFileDialog;
  let asked = '';
  go().SaveFileDialog = async (_title, def) => {
    asked = def;
    return join(out, 'saved-image'); // no extension typed: it is added
  };
  try {
    // A picture → the image editor.
    let start = await emptyTab();
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d33';
    g.fillRect(0, 0, 120, 80);
    assert(await give(start, { kind: 'image', image: c, name: 'Pasted image' }), 'the empty tab takes a picture');
    const img = await pasted();
    assertEq(img.moduleId, 'image', 'opens in the image editor');
    assertEq(img.title, 'Pasted image.png', 'named "Pasted image"');
    assert(img.dirty && img.subtitle === 'Not saved yet', 'unsaved until saved');
    const ed = await waitFor(() => (img as unknown as { imageTest?: { editor: () => { width: number; height: number } | null } }).imageTest?.editor() ?? null, 'the image editor with the picture');
    assertEq(`${ed.width}×${ed.height}`, '120×80', 'the pasted picture');
    assert(document.querySelector(`.tabview[data-tab-id="${img.id}"] .tools`), 'with the full editing tools');
    assert(!workspace.snapshot([]).tabs.some((s) => s.path === img.filePath), 'not kept in the session (its temp file goes on exit)');
    const temp = img.filePath!;
    // Save asks where (in the open folder when there is one), then writes it there.
    assert(await workspace.save(img), 'saved');
    assertEq(asked.split(/[\\/]/).pop(), 'Pasted image.png', 'the dialog suggests its name');
    const dest = join(out, 'saved-image.png');
    assertEq(img.filePath, dest, 'the tab is the saved file now');
    assert(!img.dirty && !img.scratch && img.title === 'saved-image.png', 'saved: no longer a new document');
    const [there, tempLeft] = await api.Exists([dest, temp]);
    assert(there && !tempLeft, 'written where chosen; the temp copy is gone');
    log(`picture pasted and saved to ${dest}`);

    // The image editor's own Save menu does the same, also with "Always keep
    // originals" on (a pasted picture has no original): it asks where, and the
    // tab takes the name typed in the dialog, saved.
    const keep = settings.value.imageKeepOriginal;
    settings.update((s) => (s.imageKeepOriginal = true));
    for (const item of ['Save', 'Save as…', 'Save a copy (keep original)']) {
      start = await emptyTab();
      assert(await give(start, { kind: 'image', image: c, name: 'Pasted image' }), `${item}: a picture pasted`);
      const pic = await pasted();
      await waitFor(() => (pic as unknown as { imageTest?: { editor: () => unknown } }).imageTest?.editor() ?? null, `${item}: the image editor`);
      const picTemp = pic.filePath!;
      const name = `renamed ${item.split(' ')[0].toLowerCase()}`;
      asked = '';
      go().SaveFileDialog = async (_title, def) => {
        asked = def;
        return join(out, `${name}.png`);
      };
      document.querySelector<HTMLButtonElement>(`.tabview[data-tab-id="${pic.id}"] button[title="Save options"]`)!.click();
      const items = await waitFor(() => menu.open?.items ?? null, `${item}: the Save menu`);
      items.find((i) => i.label === item)!.run!();
      await waitFor(() => (!pic.dirty ? true : null), `${item}: saved`, 8000);
      assertEq(asked.split(/[\\/]/).pop(), 'Pasted image.png', `${item}: asked where, suggesting its name`);
      assert(!asked.includes(dirname(picTemp)), `${item}: not in the temp folder (${asked})`);
      assert(pic.title === `${name}.png` && pic.filePath === join(out, `${name}.png`) && !pic.scratch, `${item}: the tab takes the name typed in the dialog (${pic.title})`);
      const [saved, picTempLeft] = await api.Exists([join(out, `${name}.png`), picTemp]);
      assert(saved && !picTempLeft, `${item}: written there; the temp copy is gone`);
    }
    settings.update((s) => (s.imageKeepOriginal = keep));
    go().SaveFileDialog = async (_title, def) => {
      asked = def;
      return join(out, 'saved-image');
    };
    log('the image editor’s Save, Save as… and Save a copy ask where for a pasted picture');

    // Text → the editor for its kind.
    const samples: [string, string, string][] = [
      ['{"name": "Ada", "langs": ["en", "pl"]}', 'json', 'Pasted data.json'],
      ['Item\tQty\tPrice\nApples\t3\t1.20\nPears\t5\t0.80\n', 'tsv', 'Pasted table.tsv'],
      ['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15"/></svg>', 'svg', 'Pasted drawing.svg'],
      ['{"type":"excalidraw","version":2,"elements":[],"appState":{}}', 'excalidraw', 'Pasted drawing.excalidraw'],
      ['flowchart LR\n  A --> B', 'mmd', 'Pasted diagram.mmd'],
      ['# Ideas\n\n- one\n- two', 'md', 'Pasted note.md'],
      ['just some words', 'txt', 'Pasted text.txt'],
    ];
    for (const [text, ext, title] of samples) {
      start = await emptyTab();
      assert(await give(start, { kind: 'text', text }), `takes ${ext}`);
      const tab = await pasted();
      assertEq(tab.title, title, `${ext}: named`);
      assertEq(tab.moduleId, modules.forPath(`x.${ext}`)?.id ?? 'text', `${ext}: opens in its editor`);
      assertEq(extname(tab.filePath!), ext, `${ext}: kept as .${ext}`);
      assertEq(new TextDecoder().decode(await tab.read()), text, `${ext}: the pasted text`);
      log(`${ext} → ${tab.moduleId}`);
    }

    // Closing an unsaved paste asks first; "Don't save" drops it and its temp file.
    const last = workspace.active!;
    const lastTemp = last.filePath!;
    const closing = workspace.close(last);
    const d = await waitFor(() => ui.dialog, 'asked before closing');
    assertEq(d.title, 'Save your changes?', d.title);
    assertEq(d.file?.name, 'Pasted text.txt', 'the paste named on its card');
    assertEq(d.file?.where, 'Not saved yet', 'not saved anywhere yet');
    d.resolve({ button: 'discard' });
    assert(await closing, 'closed');
    await sleep(100);
    assert(!(await api.Exists([lastTemp]))[0], 'its temp file is gone');

    // Copied file paths open the files themselves.
    start = await emptyTab();
    const file = join(dir, 'notes', 'index.md');
    assert(await give(start, { kind: 'text', text: file }), 'takes a copied path');
    const opened = await waitFor(() => (workspace.active?.filePath === file ? workspace.active : null), 'the copied file opened');
    assert(!opened.scratch, 'as itself, not a new document');

    // Ctrl+V on the empty tab goes the same way (clipboard read; our own copy as fallback).
    start = await emptyTab();
    await pasteInto(start);
    log('Ctrl+V on an empty tab handled');
  } finally {
    go().SaveFileDialog = realDialog;
    for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  }
}
