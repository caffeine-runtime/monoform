import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zipWorker';

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('writes stored entries with a central directory', () => {
    const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const buf = new Uint8Array(zip([{ name: 'mimetype', data: enc('image/openraster') }, { name: 'a/b.txt', data: enc('hello') }]));
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    // mimetype must be the first entry, stored, right after its header.
    expect(new TextDecoder().decode(buf.subarray(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(buf.subarray(38, 54))).toBe('image/openraster');
    const eocd = buf.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    const cd = dv.getUint32(eocd + 16, true);
    expect(dv.getUint32(cd, true)).toBe(0x02014b50);
  });
});
