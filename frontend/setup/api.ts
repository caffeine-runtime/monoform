// The Go side (cmd/setup, bound as "Setup") through Wails' window globals.
export interface Installed {
  dir: string;
  version: string;
  everyone: boolean;
  defaults: boolean;
  desktop: boolean;
  command: boolean;
}
export interface Info {
  mode: 'install' | 'uninstall';
  version: string;
  userDir: string;
  everyoneDir: string;
  installed: Installed | null;
  old: { uninstall: string; everyone: boolean } | null;
  running: boolean;
  demo: boolean;
  test: boolean;
}
export interface Options {
  dir: string;
  everyone: boolean;
  desktop: boolean;
  defaults: boolean;
  command: boolean;
  version: string;
}
export interface Progress {
  step: string;
  done: number;
  total: number;
}

type Go = { main: { Setup: Record<string, (...a: unknown[]) => Promise<unknown>> } };
type Rt = { EventsOn: (name: string, cb: (d: unknown) => void) => () => void; Quit: () => void; WindowMinimise: () => void };
const go = () => (window as unknown as { go: Go }).go.main.Setup;
const rt = () => (window as unknown as { runtime: Rt }).runtime;

export const api = {
  info: () => go().Info() as Promise<Info>,
  browse: (dir: string) => go().Browse(dir) as Promise<string>,
  install: (o: Options) => go().Install(o) as Promise<void>,
  uninstall: (removeData: boolean) => go().Uninstall(removeData) as Promise<void>,
  closeApp: () => go().CloseApp() as Promise<boolean>,
  launch: () => go().Launch() as Promise<void>,
  log: (msg: string) => go().Log(msg) as Promise<void>,
  onProgress: (cb: (p: Progress) => void) => rt().EventsOn('progress', (d) => cb(d as Progress)),
  quit: () => rt().Quit(),
  minimise: () => rt().WindowMinimise(),
};
