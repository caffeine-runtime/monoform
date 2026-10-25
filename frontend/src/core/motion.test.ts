import { describe, expect, it } from 'vitest';
import { reducedMotion } from './motion';

const root = (motion?: string) => ({ dataset: motion === undefined ? {} : { motion } });

describe('reduced motion', () => {
  it('follows the setting, then the system', () => {
    expect(reducedMotion(root('reduce'), false)).toBe(true);
    expect(reducedMotion(root('auto'), false)).toBe(false);
    expect(reducedMotion(root('auto'), true)).toBe(true);
    expect(reducedMotion(root('full'), true)).toBe(false);
    expect(reducedMotion(root(), false)).toBe(false);
  });
});
