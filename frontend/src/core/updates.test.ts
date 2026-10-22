import { describe, expect, it } from 'vitest';
import { noteLines } from './updates.svelte';

describe('release notes in the update popup', () => {
  it('are a few plain lines without the downloads table', () => {
    const md = '## Downloads\n\n| System | File |\n|---|---|\n| Windows | x.exe |\n\n## What\'s new\n- **Polish** and Spanish\n- [Paste](https://x) into an empty tab\n\n**Full Changelog**: https://github.com/x';
    expect(noteLines(md)).toEqual(["What's new", '• Polish and Spanish', '• Paste into an empty tab']);
  });

  it('are cut to a few lines', () => {
    const md = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n');
    const lines = noteLines(md, 5);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe('…');
  });
});
