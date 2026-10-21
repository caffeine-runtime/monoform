import { describe, expect, it } from 'vitest';
import ttf from './testdata/test.ttf?inline';
import woff from './testdata/test.woff?inline';
import { blockOf, fontInfo } from './fontinfo';

const FILES: Record<string, string> = { 'test.ttf': ttf, 'test.woff': woff };
/** The test fonts as ArrayBuffers (Vite inlines them as data URLs). */
const load = (f: string) => {
  const b64 = FILES[f].slice(FILES[f].indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

describe('font info', () => {
  it('reads names, weight, glyphs and coverage from TrueType', async () => {
    const i = await fontInfo(load('test.ttf'));
    expect(i.format).toBe('TrueType');
    expect([i.family, i.style, i.version]).toEqual(['Mf Test Sans', 'Bold', 'Version 1.002']);
    expect(i.copyright).toContain('Monoform');
    expect(i.license).toContain('CC0');
    expect(i.weight).toBe(700);
    expect(i.glyphs).toBe(5);
    expect(i.chars).toEqual([0x20, 0x41, 0x42, 0x17e, 0x1f600]);
  });
  it('reads WOFF (inflating its tables)', async () => {
    const i = await fontInfo(load('test.woff'));
    expect(i.format).toBe('WOFF');
    expect(i.family).toBe('Mf Test Sans');
    expect(i.chars).toContain(0x17e);
  });
  it('rejects other files and names blocks', async () => {
    await expect(fontInfo(new TextEncoder().encode('hello world!').buffer)).rejects.toThrow(/Not a font/);
    expect(blockOf(0x17e)).toBe('Latin Extended');
    expect(blockOf(0x1f600)).toBe('Emoji');
  });
});
