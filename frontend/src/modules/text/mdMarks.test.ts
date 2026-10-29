import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { highlightTree } from '@lezer/highlight';
import { highlight } from './setup';
import { mdMarkStyles } from './mdMarks';

/** The colour each piece of `doc` is drawn in, as [text, CSS variable] pairs. */
function colours(doc: string): [string, string][] {
  const tree = markdown({ base: markdownLanguage, extensions: mdMarkStyles }).language.parser.parse(doc);
  const rules = highlight.module?.getRules() ?? '';
  const out: [string, string][] = [];
  highlightTree(tree, highlight, (from, to, classes) => {
    // Of several, the rule written last wins, as in the page.
    const found = classes
      .split(' ')
      .map((c) => rules.match(new RegExp(`\\.${c} \\{[^}]*color: var\\((--[\\w-]+)\\)`)))
      .filter((m) => !!m)
      .sort((a, b) => b.index! - a.index!);
    if (found.length) out.push([doc.slice(from, to), found[0][1]]);
  });
  return out;
}

const of = (c: [string, string][], text: string) => c.filter(([s]) => s === text).map(([, v]) => v);

describe('markdown marks', () => {
  it('colours each kind of mark by what it does', () => {
    const c = colours('# Title\n\nSome **bold**, *slanted* and ~~gone~~ text with `code` and [a link](https://x.y).\n\n- item\n1. first\n\n> quoted\n');
    expect(of(c, '**')).toEqual(['--syn-md-strong', '--syn-md-strong']);
    expect(of(c, '*')).toEqual(['--syn-md-emphasis', '--syn-md-emphasis']);
    expect(of(c, '#')).toEqual(['--syn-heading']);
    expect(of(c, '`')).toEqual(['--syn-string', '--syn-string']);
    expect(of(c, '[')).toEqual(['--syn-link']);
    expect(of(c, '-')).toEqual(['--syn-number']);
    expect(of(c, '1.')).toEqual(['--syn-number']);
    expect(of(c, '>')).toEqual(['--syn-type']);
  });

  it('colours what GitHub adds: struck text, tasks and tables', () => {
    const c = colours('~~gone~~\n\n- [x] done\n- [ ] to do\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(of(c, '~~')).toEqual(['--syn-comment', '--syn-comment']);
    expect(of(c, '[x]')).toEqual(['--syn-number']);
    expect(of(c, '[ ]')).toEqual(['--syn-number']);
    expect(of(c, '|').every((v) => v === '--syn-punct')).toBe(true);
    expect(of(c, '|---|---|')).toEqual(['--syn-punct']);
  });

  it('tells bold marks from italic ones inside each other', () => {
    const c = colours('**bold _italic_ bold** and *slanted __bold__*\n');
    expect(of(c, '**')).toEqual(['--syn-md-strong', '--syn-md-strong']);
    expect(of(c, '_')).toEqual(['--syn-md-emphasis', '--syn-md-emphasis']);
    expect(of(c, '*')).toEqual(['--syn-md-emphasis', '--syn-md-emphasis']);
    expect(of(c, '__')).toEqual(['--syn-md-strong', '--syn-md-strong']);
  });
});
