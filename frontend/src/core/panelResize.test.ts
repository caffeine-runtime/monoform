import { describe, expect, it } from 'vitest';
import { panelDrag } from './panelResize.svelte';

describe('panelDrag', () => {
  it('follows the drag within limits', () => {
    expect(panelDrag(320, 1, 1400)).toEqual({ width: 320, collapse: false });
    expect(panelDrag(150, 1, 1400)).toEqual({ width: 180, collapse: false });
    expect(panelDrag(2000, 1, 2400)).toEqual({ width: 640, collapse: false });
  });

  it('leaves the content room beside it', () => {
    expect(panelDrag(600, 1, 700).width).toBe(480);
    expect(panelDrag(600, 1, 300).width).toBe(180);
  });

  it('hides when dragged well past its narrowest', () => {
    expect(panelDrag(120, 1, 1400)).toEqual({ width: 180, collapse: false });
    expect(panelDrag(100, 1, 1400)).toEqual({ width: 180, collapse: true });
  });

  it('remembers widths at interface scale 1', () => {
    expect(panelDrag(600, 2, 2000)).toEqual({ width: 300, collapse: false });
    expect(panelDrag(200, 2, 2000)).toEqual({ width: 180, collapse: true });
  });
});
