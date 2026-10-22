// Startup: ask Go for the settings, load the interface language, then the
// app. The app is a separate chunk so that every string in it — including
// ones made when its modules load — is in the right language.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import { api, errorMessage } from './core/backend';
import { pickLanguage, setLanguage } from './core/i18n';

async function main() {
  const tScript = performance.now();
  const info = await api.Boot();
  const system = info.systemLanguages ?? [];
  await setLanguage(pickLanguage(info.settings.language, system), system);
  const tBoot = performance.now();
  // Only now: the app's modules may translate strings as they load.
  const app = await import('./app');
  await app.start(info, tScript, tBoot);
}

main().catch((e) => {
  document.body.textContent = `Monoform failed to start: ${errorMessage(e)}`;
  console.error(e);
});
