import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './shell/App.svelte';
import { api, errorMessage, on, setToken } from './core/backend';
import { boot } from './core/boot';
import { commands } from './core/commands';
import { registerAppCommands } from './core/appCommands';
import { settings } from './core/settings.svelte';
import { workspace } from './core/tabs.svelte';
import { theme } from './core/theme.svelte';
import { tree } from './core/tree.svelte';
import { ui } from './core/ui.svelte';
import { dropHandlers } from './core/drop';
import { registerBuiltinModules } from './modules/registry';
import { registerArchiveIntegration } from './core/archives';
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
  on<string[]>('app:open-files', (paths) => {
    for (const p of paths) void workspace.openPath(p);
  });
  on<number>('app:confirm-quit', async (n) => {
    const r = await ui.ask({
      title: n === 1 ? 'You have unsaved changes' : `You have unsaved changes in ${n} tabs`,
      message: 'Quit anyway and lose them?',
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'quit', label: 'Quit without saving', danger: true },
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

async function start() {
  const tScript = performance.now();
  const info = await api.Boot();
  const tBoot = performance.now();
  setToken(info.token);
  Object.assign(boot, { platform: info.platform, home: info.home, version: info.version, token: info.token });
  settings.init(info.settings);
  theme.apply();

  registerBuiltinModules();
  registerAppCommands();
  registerArchiveIntegration();
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
  await workspace.restore(info.settings.session);
  for (const p of info.launchFiles ?? []) await workspace.openPath(p);

  if (info.testScript) {
    const { runSelfTest } = await import('./test/selftest');
    void runSelfTest(info.testScript);
  }
  window.addEventListener('beforeunload', () => void settings.flush());
}

start().catch((e) => {
  document.body.textContent = `Hold It All failed to start: ${errorMessage(e)}`;
  console.error(e);
});
