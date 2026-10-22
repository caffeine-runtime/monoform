import { describe, expect, it } from 'vitest';
import { countMarkdown, countText, formatCounts, headingAt, markdownHeadings, outlineTree } from './textStats';

describe('word and character counts', () => {
  it('counts words like Obsidian', () => {
    expect(countText('Hello, world!  Don’t stop — well-known 3.14 test_case').words).toBe(7);
    expect(countText('').words).toBe(0);
    expect(countText('Zażółć gęślą jaźń').words).toBe(3);
    expect(countText('日本語のテキスト and English').words).toBe(8 + 2);
  });

  it('counts characters without line breaks, emoji as one', () => {
    expect(countText('ab\ncd').chars).toBe(4);
    expect(countText('ab\r\ncd').chars).toBe(4);
    expect(countText('a 😀').chars).toBe(3);
  });

  it('leaves Markdown markup out', () => {
    const md = '---\ntags: [a, b]\n---\n# Title here\n\n- [x] Done [[Some note|alias]] and [link](https://example.com/very/long)\n```js\ncode\n```';
    expect(countMarkdown(md)).toEqual(countText('Title here\n\nDone alias and link\n\ncode\n'));
  });

  it('formats totals and a selection', () => {
    expect(formatCounts({ words: 1234, chars: 1 })).toBe('1,234 words · 1 character');
    expect(formatCounts({ words: 10, chars: 50 }, { words: 1, chars: 5 })).toBe('1 of 10 words · 5 of 50 characters');
    expect(formatCounts({ words: 10, chars: 50 }, { words: 0, chars: 0 })).toBe('10 words · 50 characters');
  });
});

describe('outline', () => {
  const md = '---\ntitle: x\n---\n# One\ntext\n## Two *b*\n```\n# not a heading\n```\n### Three [[Link|shown]]\nSetext\n======\n## Four\nSub\n---\n#nospace';
  it('finds ATX and setext headings outside code and front matter', () => {
    expect(markdownHeadings(md)).toEqual([
      { level: 1, text: 'One', line: 4 },
      { level: 2, text: 'Two b', line: 6 },
      { level: 3, text: 'Three shown', line: 10 },
      { level: 1, text: 'Setext', line: 11 },
      { level: 2, text: 'Four', line: 13 },
      { level: 2, text: 'Sub', line: 14 },
    ]);
  });

  it('nests headings and finds the one a line is under', () => {
    const items = markdownHeadings(md);
    const tree = outlineTree(items);
    expect(tree.map((n) => n.text)).toEqual(['One', 'Setext']);
    expect(tree[0].children[0].children[0].text).toBe('Three shown');
    expect(tree[1].children.map((n) => n.text)).toEqual(['Four', 'Sub']);
    // A deeper heading first: still a root.
    expect(outlineTree([{ level: 3, text: 'a', line: 1 }, { level: 1, text: 'b', line: 2 }]).length).toBe(2);
    expect(headingAt(items, 1)).toBe(-1);
    expect(headingAt(items, 7)).toBe(1);
    expect(headingAt(items, 99)).toBe(5);
  });
});
