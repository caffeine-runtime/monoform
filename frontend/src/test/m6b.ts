// M6b: omnisearch (commands, file names, text in files) and the optional
// search by meaning: consent, verified download, background indexing,
// queries without shared words, incremental updates, idle unload, turning off.
// Run with MF_MODEL_DIR=<empty dir>, MF_MODEL_URL=<server with the model>,
// MF_CACHE=<empty dir> (see docs/TESTING.md).
import { api } from '../core/backend';
import { commands } from '../core/commands';
import { basename, join } from '../core/paths';
import { semantic } from '../core/semantic/semantic.svelte';
import { settings } from '../core/settings.svelte';
import { workspace } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { assert, assertEq, log, measureJank, sleep, waitFor } from './harness';

const headings = () => [...document.querySelectorAll('.palette .heading')].map((h) => h.textContent);

function rowsUnder(heading: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let on = false;
  for (const el of document.querySelectorAll<HTMLElement>('.palette .list > *')) {
    if (el.classList.contains('heading')) on = el.textContent === heading;
    else if (on && el.classList.contains('item')) out.push(el);
  }
  return out;
}

async function closePalette() {
  ui.paletteOpen = false;
  await sleep(50);
}

export default async function m6b(dir: string) {
  const M = join(dir, 'meaning');
  await workspace.openFolder(M);

  // Off by default: the search box still finds text inside files.
  assert(!semantic.enabled, 'search by meaning is off by default');
  ui.openPalette('ListenAndServe');
  await waitFor(() => rowsUnder('In files').length > 0, '"In files" results');
  assert(rowsUnder('In files')[0].textContent!.includes('server.go'), 'text match in server.go');
  await sleep(500);
  assert(!headings().includes('By meaning'), 'no "By meaning" while off');
  await closePalette();
  ui.openPalette('>search by meaning');
  await waitFor(() => document.querySelector('.palette .item')?.textContent?.includes('Search by meaning'), 'command listed');
  await closePalette();

  // Consent, then a verified download.
  commands.execute('semantic.settings');
  const tab = await waitFor(() => (workspace.active?.moduleId === 'semantic' && (workspace.active as any).semanticTest ? workspace.active : null), 'settings page');
  const st = (tab as any).semanticTest;
  await semantic.refresh();
  assert(semantic.info && !semantic.info.installed, 'model not installed in a fresh model dir');
  void st.turnOn();
  await waitFor(() => st.consenting(), 'consent shown');
  const consent = document.querySelector('.consent')?.textContent ?? '';
  assert(consent.includes('Apache-2.0') && consent.includes('huggingface.co') && /1 GB/.test(consent), 'consent names license, source and memory');
  assert(!semantic.enabled, 'not enabled before agreeing');
  st.agree();
  const t0 = performance.now();
  void st.turnOn();
  await waitFor(() => semantic.enabled, 'enabled after download', 180_000);
  assert(semantic.info?.installed, 'installed');
  log(`model download + verify: ${Math.round(performance.now() - t0)} ms`);

  // Background indexing of the open folder (lock file skipped).
  const t1 = performance.now();
  await waitFor(() => semantic.index && semantic.index.total === 7 && semantic.index.files === 7, 'every file has a passage (pass 1)', 600_000);
  log(`pass 1 (one passage per file) done after ${Math.round(performance.now() - t1)} ms`);
  const jank = await measureJank(() =>
    waitFor(async () => !semantic.indexing && ((await api.SemanticPending(M)).files?.length ?? 0) === 0, 'folder fully indexed (pass 2)', 600_000),
  );
  assert(semantic.index!.passages > 7, 'second pass added passages');
  log(`indexed 7 files / ${semantic.index!.passages} passages in ${Math.round(performance.now() - t1)} ms (incl. 2 s start delay and model load); ${semantic.tokensPerSec} tokens/s; longest UI frame while indexing ${Math.round(jank.maxGap)} ms`);
  assertEq(semantic.model, 'ready', 'model loaded');

  // Queries that share no words with the files.
  const cases: [string, string][] = [
    ['why does the night sky glow near the north pole', 'aurora.md'],
    ['how do I run a web server', 'server.go'],
    ['growing vegetables at home', 'garden.txt'],
    ['how much money do I owe and by when', 'invoice.txt'],
    ['baking a loaf', 'sourdough.md'],
    ['my pet animal', 'cats.md'],
    ['tips for the beginning of a board game', 'notes.md'],
  ];
  for (const [q, want] of cases) {
    const t = performance.now();
    const hits = (await semantic.search(q, 3))!;
    log(`"${q}" → ${hits.map((h) => `${basename(h.path)} ${h.score.toFixed(2)}`).join(', ')} (${Math.round(performance.now() - t)} ms)`);
    assertEq(basename(hits[0].path), want, `top hit for "${q}"`);
  }
  // The hit points at the matching passage, not the top of the file.
  const deep = (await semantic.search('tips for the beginning of a board game', 1))![0];
  assert(deep.line > 10 && deep.snippet.startsWith('White should'), `hit line ${deep.line}: ${deep.snippet.slice(0, 30)}`);

  // The search box shows them under "By meaning"; Enter opens the file.
  ui.openPalette('lights dancing in the sky');
  await waitFor(() => rowsUnder('By meaning').length > 0, '"By meaning" results', 30_000);
  assert(rowsUnder('By meaning')[0].textContent!.includes('aurora.md'), 'aurora first in palette');
  rowsUnder('By meaning')[0].click();
  await waitFor(() => (workspace.active?.title === 'aurora.md' ? true : null), 'opened aurora.md');

  // Incremental: only the changed file is embedded again.
  await api.TestWriteFile(join(M, 'cats.md'), '# Our cat\n\nMiso now sleeps in a cardboard box by the window.\n');
  const pend = await api.SemanticPending(M);
  assertEq(pend.files?.length ?? 0, 1, 'one file pending after an edit');
  const steady = await measureJank(() => semantic.indexFolder(M));
  assertEq((await api.SemanticPending(M)).files?.length ?? 0, 0, 'nothing pending after update');
  log(`re-indexing one file: longest UI frame ${Math.round(steady.maxGap)} ms`);

  // Idle unload frees the worker; the next query loads it again.
  settings.update((s) => (s.semantic = { ...s.semantic, unloadAfter: 10 }));
  await semantic.search('cat', 1);
  await waitFor(() => semantic.model === 'unloaded', 'model unloaded when idle', 20_000);
  const t2 = performance.now();
  const reload = await measureJank(() => semantic.search('a sleepy kitten', 1));
  assertEq(basename(reload.result![0].path), 'cats.md', 'query after reload');
  log(`query with model reload: ${Math.round(performance.now() - t2)} ms, longest UI frame ${Math.round(reload.maxGap)} ms`);

  // Turning it off unloads the model and hides the section.
  await semantic.disable();
  assertEq(semantic.model, 'unloaded', 'unloaded when turned off');
  ui.openPalette('lights dancing in the sky');
  await sleep(800);
  assert(!headings().includes('By meaning'), 'no "By meaning" after turning off');
  await closePalette();
}
