// When the first-run welcome shows: once, on a normal start — not over a
// file someone just opened, not in a quick peek, not in a self-test.
export function showWelcome(info: { settings: { welcomeDone?: boolean }; testScript?: string; launchMode?: string; launchFiles?: string[] | null }): boolean {
  return !info.settings.welcomeDone && !info.testScript && info.launchMode !== 'peek' && !info.launchFiles?.length;
}
