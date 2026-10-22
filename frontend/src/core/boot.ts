// Startup info from Go (platform, home dir...). Filled in app.ts before mount.
export const boot = {
  platform: 'linux',
  home: '',
  version: '',
  token: '',
  /** A window a tab was moved to (--new-window): it leaves the session alone. */
  extraWindow: false,
  /** The system's languages, most preferred first ("pl-PL", …). */
  systemLanguages: [] as string[],
};
