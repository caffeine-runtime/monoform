import { describe, expect, it } from 'vitest';
import { showWelcome } from './firstrun';

describe('first-run welcome', () => {
  const base = { settings: { welcomeDone: false }, testScript: '', launchMode: '', launchFiles: [] as string[] };
  it('shows once, on a plain first start', () => {
    expect(showWelcome(base)).toBe(true);
    expect(showWelcome({ ...base, settings: { welcomeDone: true } })).toBe(false);
  });
  it('stays out of the way', () => {
    expect(showWelcome({ ...base, launchFiles: ['/a.pdf'] })).toBe(false);
    expect(showWelcome({ ...base, launchMode: 'peek' })).toBe(false);
    expect(showWelcome({ ...base, testScript: 'm1' })).toBe(false);
    expect(showWelcome({ ...base, launchFiles: null })).toBe(true);
  });
});
