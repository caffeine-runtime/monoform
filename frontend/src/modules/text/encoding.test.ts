import { describe, expect, it } from 'vitest';
import { classifyEol, countEol, decode, detectEncoding, encode, hasUtf16Bom, UnencodableError } from './encoding';

const bytes = (...b: number[]) => new Uint8Array(b);

function roundTrip(b: Uint8Array) {
  const enc = detectEncoding(b);
  const text = decode(b, enc);
  const out = encode(text, enc, hasUtf16Bom(b));
  expect(Array.from(out)).toEqual(Array.from(b));
  return { enc, text };
}

describe('encoding', () => {
  it('detects and round-trips UTF-8', () => {
    const { enc, text } = roundTrip(new TextEncoder().encode('zażółć\r\ngęślą\n'));
    expect(enc).toBe('utf-8');
    expect(text).toBe('zażółć\r\ngęślą\n');
  });
  it('keeps the UTF-8 BOM', () => {
    const b = bytes(0xef, 0xbb, 0xbf, 0x68, 0x69);
    const { enc, text } = roundTrip(b);
    expect(enc).toBe('utf-8-bom');
    expect(text).toBe('hi');
  });
  it('round-trips UTF-16 LE/BE with BOM', () => {
    expect(roundTrip(bytes(0xff, 0xfe, 0x68, 0x00, 0x7c, 0x01)).text).toBe('hż');
    expect(roundTrip(bytes(0xfe, 0xff, 0x00, 0x68, 0x01, 0x7c)).enc).toBe('utf-16be');
  });
  it('detects BOM-less UTF-16', () => {
    const b = encode('plain ascii text that is long enough\n'.repeat(4), 'utf-16le', false);
    expect(detectEncoding(b)).toBe('utf-16le');
    expect(Array.from(encode(decode(b, 'utf-16le'), 'utf-16le', false))).toEqual(Array.from(b));
  });
  it('falls back to Windows-1252 losslessly for every byte', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    // Make it invalid UTF-8 for sure.
    const { enc } = roundTrip(all);
    expect(enc).toBe('windows-1252');
  });
  it('round-trips ISO-8859-2', () => {
    const b = bytes(0xb1, 0xe6, 0xea); // ą ć ę
    const text = decode(b, 'iso-8859-2');
    expect(text).toBe('ąćę');
    expect(Array.from(encode(text, 'iso-8859-2'))).toEqual([0xb1, 0xe6, 0xea]);
  });
  it('rejects unencodable characters', () => {
    expect(() => encode('€ and 日本', 'iso-8859-1')).toThrow(UnencodableError);
  });
});

describe('line endings', () => {
  it('classifies', () => {
    expect(classifyEol(countEol('a\nb\n'))).toBe('lf');
    expect(classifyEol(countEol('a\r\nb\r\n'))).toBe('crlf');
    expect(classifyEol(countEol('a\rb'))).toBe('cr');
    expect(classifyEol(countEol('a\r\nb\n'))).toBe('mixed');
    expect(classifyEol(countEol('no newline'))).toBe('lf');
  });
});
