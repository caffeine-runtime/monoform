import { describe, expect, it } from 'vitest';
import { pickLayers, type LayerPick } from './layerPick';

const order = ['bg', 'a', 'b', 'c'];
const one = (id: string): LayerPick => ({ ids: [id], active: id, anchor: id });

describe('pickLayers', () => {
  it('Shift+click takes every layer from the anchor to the clicked one, bottom first', () => {
    expect(pickLayers(order, one('a'), 'b', 'range')).toEqual({ ids: ['a', 'b'], active: 'b', anchor: 'a' });
    expect(pickLayers(order, one('c'), 'bg', 'range')).toEqual({ ids: ['bg', 'a', 'b', 'c'], active: 'bg', anchor: 'c' });
  });

  it('a second Shift+click starts again from the same anchor', () => {
    const s = pickLayers(order, one('b'), 'c', 'range')!;
    expect(pickLayers(order, s, 'a', 'range')).toEqual({ ids: ['a', 'b'], active: 'a', anchor: 'b' });
  });

  it('Ctrl+click adds a layer, also one that is not next to the others', () => {
    expect(pickLayers(order, one('bg'), 'b', 'toggle')).toEqual({ ids: ['bg', 'b'], active: 'b', anchor: 'b' });
  });

  it('Ctrl+click on a selected layer takes it off; the active one goes to the top of the rest', () => {
    const s: LayerPick = { ids: ['a', 'b', 'c'], active: 'c', anchor: 'c' };
    expect(pickLayers(order, s, 'a', 'toggle')).toEqual({ ids: ['b', 'c'], active: 'c', anchor: 'a' });
    expect(pickLayers(order, s, 'c', 'toggle')).toEqual({ ids: ['a', 'b'], active: 'b', anchor: 'c' });
  });

  it('the last selected layer stays, and unknown layers change nothing', () => {
    expect(pickLayers(order, one('a'), 'a', 'toggle')).toBeNull();
    expect(pickLayers(order, one('a'), 'gone', 'range')).toBeNull();
  });

  it('an anchor that was deleted: Shift+click selects just the clicked layer', () => {
    expect(pickLayers(order, { ids: ['a'], active: 'a', anchor: 'gone' }, 'b', 'range')).toEqual({ ids: ['b'], active: 'b', anchor: 'b' });
  });
});
