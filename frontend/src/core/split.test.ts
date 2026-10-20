import { describe, expect, it } from 'vitest';
import { dividers, dropInto, makeSplit, paneRect, without, type Split } from './split';

const s = (layout: Split['layout'], panes: string[], x = 0.5, y = 0.5): Split => ({ layout, panes, x, y });

describe('split view', () => {
  it('lays panes out without gaps or overlap', () => {
    for (const sp of [s('columns', ['a', 'b'], 0.3), s('rows', ['a', 'b', 'c']), s('grid', ['a', 'b', 'c'], 0.6, 0.4), s('grid', ['a', 'b', 'c', 'd'], 0.6, 0.4)]) {
      const area = sp.panes.reduce((n, _, i) => {
        const r = paneRect(sp, i);
        return n + r.width * r.height;
      }, 0);
      expect(area).toBeCloseTo(1);
    }
    expect(paneRect(s('columns', ['a', 'b'], 0.3), 1)).toEqual({ left: 0.3, top: 0, width: 0.7, height: 1 });
    expect(paneRect(s('grid', ['a', 'b', 'c', 'd']), 3)).toEqual({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 });
    expect(dividers(s('grid', ['a', 'b', 'c']))).toEqual({ x: true, y: true });
    expect(dividers(s('columns', ['a', 'b', 'c']))).toEqual({ x: false, y: false });
  });

  it('dropping a tab on an edge splits or adds a pane', () => {
    expect(dropInto(null, 'b', 'a', 'right')).toEqual(s('columns', ['a', 'b']));
    expect(dropInto(null, 'b', 'a', 'top')).toEqual(s('rows', ['b', 'a']));
    expect(dropInto(null, 'b', 'a', 'center')).toBeNull();
    const two = s('columns', ['a', 'b']);
    expect(dropInto(two, 'c', 'b', 'bottom')!.panes).toEqual(['a', 'b', 'c']);
    expect(dropInto(two, 'c', 'b', 'bottom')!.layout).toBe('grid');
    expect(dropInto(two, 'c', 'a', 'center')!.panes).toEqual(['c', 'b']);
    const four = s('grid', ['a', 'b', 'c', 'd']);
    expect(dropInto(four, 'e', 'c', 'left')!.panes).toEqual(['a', 'b', 'e', 'd']);
    // Moving a tab that is already shown doesn't duplicate it.
    expect(dropInto(s('grid', ['a', 'b', 'c']), 'a', 'c', 'right')!.panes).toEqual(['b', 'c', 'a']);
  });

  it('closing a pane collapses the split', () => {
    expect(without(s('columns', ['a', 'b']), 'a')).toBeNull();
    expect(without(s('grid', ['a', 'b', 'c']), 'b')).toEqual(s('columns', ['a', 'c']));
    expect(without(s('grid', ['a', 'b', 'c']), 'z')).toEqual(s('grid', ['a', 'b', 'c']));
  });

  it('makes splits from the focused tab and the next ones', () => {
    expect(makeSplit('columns', 2, 'b', null, ['c', 'a'])).toEqual(s('columns', ['b', 'c']));
    expect(makeSplit('grid', 4, 'a', s('columns', ['a', 'b'], 0.3), ['b', 'c', 'd', 'e'])).toEqual(s('grid', ['a', 'b', 'c', 'd'], 0.3));
    expect(makeSplit('columns', 2, 'a', null, [])).toBeNull();
  });
});
