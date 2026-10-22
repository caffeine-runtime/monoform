// The app, loaded by main.ts once the interface language is set.
import { mount } from 'svelte';
import App from './shell/App.svelte';
import { api, errorMessage, on, setToken, type BootInfo } from './core/backend';
import { t, tn } from './core/i18n';
import { boot } from './core/boot';
import { commands } from './core/commands';
import { registerAppCommands } from './core/appCommands';
import { settings } from './core/settings.svelte';
import { peek } from './core/peek.svelte';
import { workspace } from './core/tabs.svelte';
import { theme } from './core/theme.svelte';
import { tree } from './core/tree.svelte';
import { ui, menu } from './core/ui.svelte';
import { showWelcome } from './core/firstrun';
import { checkAtStartup } from './core/updates.svelte';
import { dropHandlers } from './core/drop';
import { registerBuiltinModules } from './modules/registry';
import { registerArchiveIntegration } from './core/archives';
import { registerTools } from './core/tools';
import { registerCompare } from './core/compare';
import { semantic } from './core/semantic/semantic.svelte';
import { OnFileDrop } from './wailsjs/runtime/runtime';

function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function wireEvents() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (ui.dialog) return; // dialogs handle their own keys
      if (ui.picker) return;
      if (ui.firstRun) return; // the welcome handles its own keys
      if (menu.open) return; // menus handle their own keys (arrows, Enter, Esc)
      if (ui.paletteOpen && !(e.key === 'k' && (e.ctrlKey || e.metaKey))) return;
      commands.handleKey(e, inEditable(e.target));
    },
    { capture: true },
  );
  // Never let the webview navigate away (e.g. a dropped file or a stray link).
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && !a.dataset.internal) e.preventDefault();
  });

  commands.onError = (e, c) => ui.toast(`${c.title}: ${errorMessage(e)}`, 'error');

  on<{ path: string; op: string; dir: boolean }>('fs:changed', (ev) => {
    if (ev.dir) void tree.refreshDir(ev.path);
    else workspace.onExternalChange(ev.path, ev.op);
  });
  on<string[] | { paths: string[]; preview: boolean }>('app:open-files', (req) => {
    const { paths, preview } = Array.isArray(req) ? { paths: req, preview: false } : req;
    for (const p of paths ?? []) void workspace.openPath(p, preview ? { preview: true } : {});
  });
  on<number>('app:confirm-quit', async (n) => {
    const r = await ui.ask({
      title: tn('You have unsaved changes', 'You have unsaved changes in {n} tabs', n),
      message: t('Quit anyway and lose them?'),
      buttons: [
        { id: 'cancel', label: t('Cancel') },
        { id: 'quit', label: t('Quit without saving'), danger: true },
      ],
    });
    if (r.button === 'quit') {
      await settings.flush();
      void api.ConfirmQuit();
    }
  });
  OnFileDrop((x, y, paths) => {
    for (const h of dropHandlers) if (h(x, y, paths)) return;
    for (const p of paths) void workspace.openPath(p);
  }, false);
}

export async function start(info: BootInfo, tScript: number, tBoot: number) {
  setToken(info.token);
  Object.assign(boot, { platform: info.platform, home: info.home, version: info.version, token: info.token, extraWindow: info.launchMode === 'window', systemLanguages: info.systemLanguages ?? [] });
  settings.init(info.settings);
  theme.apply();

  registerBuiltinModules();
  registerAppCommands();
  registerArchiveIntegration();
  registerTools();
  registerCompare();
  wireEvents();

  mount(App, { target: document.getElementById('app')! });
  const tMount = performance.now();

  // The shell is interactive after the first frame; report that, then
  // restore the previous session: tabs appear at once, only the active tab
  // loads its contents (others load when first shown).
  requestAnimationFrame(() =>
    setTimeout(() => {
      const t = performance.now();
      void api.MarkReady(t);
      void api.Log(`startup breakdown: script ${tScript.toFixed(0)} ms, boot ${tBoot.toFixed(0)}, mounted ${tMount.toFixed(0)}, first frame ${t.toFixed(0)}`);
    }),
  );
  if (info.launchMode === 'peek' && info.launchFiles?.length) {
    // Quick peek: just the file, read-only; the session is left alone.
    peek.on = true;
    for (const p of info.launchFiles) await workspace.openPath(p, { preview: true, quiet: true });
  } else if (boot.extraWindow) {
    // A tab moved to its own window: just its file; the main window keeps the session.
    for (const p of info.launchFiles ?? []) await workspace.openPath(p, { quiet: true });
  } else {
    await workspace.restore(info.settings.session);
    for (const p of info.launchFiles ?? []) await workspace.openPath(p, info.launchMode === 'preview' ? { preview: true } : {});
  }
  // Search by meaning indexes from the main window only (one writer per index).
  if (!boot.extraWindow) semantic.start();
  // First start: a short welcome.
  if (showWelcome(info)) ui.firstRun = true;
  // A new version? (asked a few seconds later; Settings › About turns it off)
  checkAtStartup(info, !peek.on && !boot.extraWindow);

  if (info.testScript) {
    const { runSelfTest } = await import('./test/selftest');
    void runSelfTest(info.testScript);
  }
  window.addEventListener('beforeunload', () => void settings.flush());
}

