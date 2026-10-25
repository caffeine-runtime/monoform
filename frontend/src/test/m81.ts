// M81: Save and convert. A Markdown note with unsaved changes: the command
// saves it first, the dialog lists what a document becomes (PDF first),
// "Also update it every time I save" plus Convert writes a PDF that the
// next Ctrl+S writes again. A digit picks Word (the .docx holds the new
// text); a file that is already there is named before it is replaced. A
// picture becomes a JPEG (its editor's Save menu has the command too), a CSV becomes
// an Excel workbook, and "Stop converting this file on save" ends the
// updates.
import { EditorView } from '@codemirror/view';
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { companions } from '../core/convert.svelte';
import { settings } from '../core/settings.svelte';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, log, measureJank, press, sleep, waitFor } from './harness';

const pane = (tab: Tab) => document.querySelector<HTMLElement>(`.tabview[data-tab-id="${tab.id}"]`);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Save and convert"]');
const formats = (d: HTMLElement) => [...d.querySelectorAll('.fmt .name')].map((e) => e.textContent?.trim());
const selected = (d: HTMLElement) => d.querySelector('.fmt.sel .name')?.textContent?.trim();
const exists = async (p: string) => (await api.Exists([p]))[0];

async function append(tab: Tab, text: string) {
  const el = await waitFor(() => pane(tab)?.querySelector<HTMLElement>('.cm-editor'), 'editor');
  const view = EditorView.findFromDOM(el)!;
  await sleep(200);
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
  await waitFor(() => (tab.dirty ? true : null), 'unsaved changes');
}

export default async function m81(dir: string) {
  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
  const c = `${dir}/convert`;

  // 1. A note with unsaved changes → PDF, kept up to date.
  const note = (await workspace.openPath(`${c}/trip.md`))!;
  await append(note, '\n\nAdded before converting.\n');
  const pdf = `${c}/trip.pdf`;
  const { maxGap } = await measureJank(async () => {
    commands.execute('file.saveConvert');
    const d = await waitFor(dialog, 'Save and convert dialog');
    assert(!note.dirty, 'the note was saved first');
    assertEq(formats(d).join(', '), 'PDF, Word document, Web page, Plain text', 'formats for a document');
    assertEq(selected(d), 'PDF', 'PDF selected');
    assert(d.textContent!.includes('Saves trip.pdf next to the original'), 'says where the copy goes');
    d.querySelector<HTMLInputElement>('.always input')!.click();
    d.querySelector<HTMLButtonElement>('button.primary')!.click();
    await waitFor(() => exists(pdf).then((e) => e || null), 'trip.pdf');
  });
  assert((await api.PdfPageCount(pdf)) >= 1, 'a PDF with pages');
  assertEq(companions(note.filePath!).join(), pdf, 'kept up to date on save');
  log(`note → PDF (longest frame while converting: ${Math.round(maxGap)} ms)`);

  const first = await api.Stat(pdf);
  await append(note, '\n' + 'A longer paragraph written after the first conversion. '.repeat(30) + '\n');
  await workspace.save(note);
  await waitFor(async () => ((await api.Stat(pdf)).size > first.size ? true : null), 'the PDF written again on save');
  log('Ctrl+S wrote the PDF again');

  // 2. A digit picks Word; the .docx has the text.
  commands.execute('file.saveConvert');
  const d2 = await waitFor(dialog, 'dialog again');
  assertEq(selected(d2), 'PDF', 'the kept-up-to-date format comes first');
  assert(d2.querySelector<HTMLInputElement>('.always input')!.checked, 'its box is ticked');
  press('2', d2);
  await sleep(50);
  assertEq(selected(d2), 'Word document', '2 picks Word');
  assert(!d2.querySelector<HTMLInputElement>('.always input')!.checked, 'Word not kept up to date');
  press('Enter', d2);
  const docx = `${c}/trip.docx`;
  await waitFor(() => exists(docx).then((e) => e || null), 'trip.docx');
  const doc = await api.DocOpen(docx);
  assert(doc.document.includes('Added before converting.') && doc.document.includes('Trip plan'), 'the .docx has the note');
  assertEq(companions(note.filePath!).join(), pdf, 'still only the PDF kept up to date');
  log('2 + Enter → Word document with the note');

  // 3. A file that is there is named before it is replaced; Escape cancels.
  commands.execute('file.saveConvert');
  const d3 = await waitFor(dialog, 'dialog a third time');
  press('2', d3);
  const warn = await waitFor(() => d3.querySelector('.warn'), 'replace warning');
  assert(warn.textContent!.includes('trip.docx'), 'names the file it replaces');
  press('Escape', d3);
  await waitFor(() => (dialog() ? null : true), 'dialog closed');
  log('replacing trip.docx is announced; Escape cancels');

  // 4. A picture → JPEG; the image editor's Save menu offers it.
  const pic = (await workspace.openPath(`${c}/photo.png`))!;
  const saveButton = await waitFor(() => pane(pic)?.querySelector<HTMLButtonElement>('button[title="Save options"]'), 'image Save menu button');
  saveButton.click();
  const item = await waitFor(() => [...document.querySelectorAll<HTMLElement>('.menu button.mi')].find((e) => e.textContent?.includes('Save and convert…')), 'Save and convert… in the Save menu');
  item.click();
  const d4 = await waitFor(dialog, 'dialog for the picture');
  assert(formats(d4).includes('JPEG') && formats(d4).includes('Windows icon') && !formats(d4).includes('PNG'), `picture formats: ${formats(d4)}`);
  [...d4.querySelectorAll<HTMLElement>('.fmt')].find((e) => e.querySelector('.name')?.textContent === 'JPEG')!.click();
  d4.querySelector<HTMLButtonElement>('button.primary')!.click();
  await waitFor(() => exists(`${c}/photo.jpg`).then((e) => e || null), 'photo.jpg');
  assert(!pic.dirty, 'the picture is unchanged');
  log('picture → JPEG');

  // 5. A CSV → Excel workbook.
  await workspace.openPath(`${c}/sales.csv`);
  await sleep(400);
  commands.execute('file.saveConvert');
  const d5 = await waitFor(dialog, 'dialog for the table');
  assertEq(formats(d5)[0], 'Excel workbook', 'tables offer Excel first');
  press('Enter', d5);
  const xlsx = `${c}/sales.xlsx`;
  await waitFor(() => exists(xlsx).then((e) => e || null), 'sales.xlsx');
  const book = await api.SheetOpen(xlsx);
  const rows = await api.SheetRows(book.id, book.sheets[0].name, 0, 3, 3);
  api.SheetClose(book.id);
  assertEq(JSON.stringify(rows), JSON.stringify([['region', 'q1', 'q2'], ['North', '10', '12'], ['South', '7', '9']]), 'the workbook has the table');
  log('CSV → Excel workbook');

  // 6. Stop the updates: the next save leaves the PDF as it is.
  workspace.activate(note);
  await sleep(100);
  assert(commands.execute('file.stopConvert'), 'stop command available');
  await waitFor(() => (companions(note.filePath!).length === 0 ? true : null), 'no copies kept up to date');
  assert(!settings.value.convertOnSave?.[note.filePath!], 'setting cleared');
  const kept = await api.Stat(pdf);
  await append(note, '\nOne more line.\n');
  await workspace.save(note);
  await sleep(1500);
  assertEq((await api.Stat(pdf)).modTime, kept.modTime, 'the PDF is no longer written');
  log('stop converting on save');

  for (const t of [...workspace.tabs]) await workspace.close(t, { force: true });
}
