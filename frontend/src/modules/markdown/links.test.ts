import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { backlinks, headingLine, linkAt, newNotePath, parseLinks, resolveLink, wikiLinks, type IndexedNote } from './links';

const V = '/vault';
const notes = ['/vault/Home.md', '/vault/Ideas.md', '/vault/projects/Roadmap.md', '/vault/archive/Ideas.md', '/vault/projects/sub/Plan.md'];

describe('parsing links (same rules as the Go indexer)', () => {
  it('finds wiki, embed and Markdown links outside code', () => {
    const text = '---\nx: [[no]]\n---\nSee [[Ideas]], [[projects/Roadmap#Q3|roadmap]] ![[pic.png]]\n[md](Other%20note.md#Intro) [web](https://a.md) `[[code]]`\n```\n[[fenced]]\n```\n[[#Local]]';
    expect(parseLinks(text).map((l) => [l.target, l.heading, l.wiki, !!l.embed, l.line])).toEqual([
      ['Ideas', undefined, true, false, 4],
      ['projects/Roadmap', 'Q3', true, false, 4],
      ['pic.png', undefined, true, true, 4],
      ['Other note.md', 'Intro', false, false, 5],
      ['', 'Local', true, false, 9],
    ]);
  });
});

describe('resolving links', () => {
  it('matches wiki links by name, nearest note first', () => {
    expect(resolveLink({ target: 'Ideas', wiki: true }, '/vault/Home.md', notes)).toBe('/vault/Ideas.md');
    expect(resolveLink({ target: 'ideas', wiki: true }, '/vault/archive/Old.md', notes)).toBe('/vault/archive/Ideas.md');
    expect(resolveLink({ target: 'archive/Ideas', wiki: true }, '/vault/Home.md', notes)).toBe('/vault/archive/Ideas.md');
    expect(resolveLink({ target: 'Roadmap.md', wiki: true }, '/vault/Home.md', notes)).toBe('/vault/projects/Roadmap.md');
    expect(resolveLink({ target: 'Plan', wiki: true }, '/vault/Home.md', notes)).toBe('/vault/projects/sub/Plan.md');
    expect(resolveLink({ target: 'Missing', wiki: true }, '/vault/Home.md', notes)).toBeNull();
    expect(resolveLink({ target: 'jects/Roadmap', wiki: true }, '/vault/Home.md', notes)).toBeNull();
  });

  it('resolves Markdown links relative to the note', () => {
    expect(resolveLink({ target: '../Home.md', wiki: false }, '/vault/projects/Roadmap.md', notes)).toBe('/vault/Home.md');
    expect(resolveLink({ target: 'sub/Plan.md', wiki: false }, '/vault/projects/Roadmap.md', notes)).toBe('/vault/projects/sub/Plan.md');
  });

  it('puts new notes next to the linking one', () => {
    expect(newNotePath('New idea', '/vault/projects/Roadmap.md')).toBe('/vault/projects/New idea.md');
    expect(newNotePath('later/Thing.md', '/vault/Home.md')).toBe('/vault/later/Thing.md');
  });
});

describe('backlinks', () => {
  const idx: IndexedNote[] = [
    { path: '/vault/Home.md', links: [{ target: 'Ideas', wiki: true, line: 3, text: 'see [[Ideas]]' }, { target: 'Roadmap', wiki: true, line: 4, text: '[[Roadmap]]' }], headings: [{ level: 2, text: 'Plan', line: 7 }] },
    { path: '/vault/archive/Ideas.md', links: [{ target: '../Ideas.md', wiki: false, line: 1, text: '[new](../Ideas.md)' }], headings: [] },
    { path: '/vault/Ideas.md', links: [{ target: 'Ideas', wiki: true, line: 2, text: 'self [[Ideas]]' }, { target: 'Home', heading: 'Plan', wiki: true, line: 5, text: '[[Home#Plan]]' }], headings: [] },
    { path: '/vault/projects/Roadmap.md', links: [], headings: [] },
  ];
  it('lists the notes linking to a note, not itself', () => {
    expect(backlinks('/vault/Ideas.md', idx).map((b) => [b.path, b.links.map((l) => l.line)])).toEqual([
      ['/vault/Home.md', [3]],
      ['/vault/archive/Ideas.md', [1]],
    ]);
    expect(backlinks('/vault/Home.md', idx).map((b) => b.path)).toEqual(['/vault/Ideas.md']);
    expect(headingLine(idx[0], 'plan')).toBe(7);
  });
});

describe('Ctrl+click and the preview', () => {
  it('finds the link under the cursor', () => {
    const line = 'a [[Note#H|x]] b [t](sub/My%20Note.md) c https://example.com/x d';
    expect(linkAt(line, 5)).toEqual({ link: { target: 'Note', heading: 'H', wiki: true } });
    expect(linkAt(line, 20)).toEqual({ link: { target: 'sub/My Note.md', heading: undefined, wiki: false } });
    expect(linkAt(line, 45)).toEqual({ url: 'https://example.com/x' });
    expect(linkAt(line, 0)).toBeNull();
  });

  it('renders [[links]] for the preview to follow', () => {
    const md = new MarkdownIt().use(wikiLinks);
    expect(md.renderInline('[[Ideas]] [[Home#Plan|the plan]] [[#Top]] [[a]b]]')).toBe(
      '<a class="wikilink" data-wiki="Ideas" title="Ideas">Ideas</a> <a class="wikilink" data-wiki="Home" data-heading="Plan" title="Home#Plan">the plan</a> <a class="wikilink" data-wiki="" data-heading="Top" title="#Top">Top</a> [[a]b]]',
    );
  });
});

void V;
