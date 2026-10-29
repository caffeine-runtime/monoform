import { describe, expect, it } from 'vitest';
import { sidebarDrag } from './sidebarDrag';

describe('sidebarDrag', () => {
  it('narrows, then becomes the strip, then hides', () => {
    expect(sidebarDrag(300, 1, 'full')).toEqual({ mode: 'full', width: 300 });
    expect(sidebarDrag(150, 1, 'full')).toEqual({ mode: 'full', width: 180 });
    expect(sidebarDrag(100, 1, 'full').mode).toBe('compact');
    expect(sidebarDrag(40, 1, 'compact').mode).toBe('compact');
    expect(sidebarDrag(10, 1, 'compact').mode).toBe('hidden');
    expect(sidebarDrag(10, 1, 'full').mode).toBe('hidden');
  });

  it('takes a little further to come back out, so the edge holds still', () => {
    expect(sidebarDrag(130, 1, 'compact').mode).toBe('compact');
    expect(sidebarDrag(130, 1, 'full').mode).toBe('full');
    expect(sidebarDrag(160, 1, 'compact')).toEqual({ mode: 'full', width: 180 });
    expect(sidebarDrag(30, 1, 'hidden').mode).toBe('compact');
    expect(sidebarDrag(400, 1, 'hidden')).toEqual({ mode: 'full', width: 400 });
  });

  it('keeps the width within limits and follows the interface scale', () => {
    expect(sidebarDrag(900, 1, 'full').width).toBe(560);
    expect(sidebarDrag(170, 1.5, 'full')).toEqual({ mode: 'compact', width: 270 });
    expect(sidebarDrag(300, 1.5, 'full')).toEqual({ mode: 'full', width: 300 });
    expect(sidebarDrag(30, 1.5, 'compact').mode).toBe('hidden');
    expect(sidebarDrag(700, 2, 'full').width).toBe(560);
    expect(sidebarDrag(300, 2, 'full').width).toBe(360);
  });
});
