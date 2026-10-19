import { describe, expect, it } from 'vitest';
import { compare, normalizeExpected } from './compare';

const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const b3 = '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85';

describe('hash compare', () => {
  it('normalizes pasted digests', () => {
    expect(normalizeExpected(`  ${sha.toUpperCase()}  ubuntu.iso\n`)).toBe(sha);
    expect(normalizeExpected(`sha256:${sha}`)).toBe(sha);
    expect(normalizeExpected(`SHA256 (file.iso) = ${sha}`)).toBe(sha);
  });
  it('matches by length and value', () => {
    expect(compare(sha, { sha256: sha }, ['sha256'])).toEqual({ kind: 'match', algo: 'sha256' });
    expect(compare(b3, { sha256: sha, blake3: b3 }, ['sha256', 'blake3'])).toEqual({ kind: 'match', algo: 'blake3' });
  });
  it('reports mismatches', () => {
    expect(compare('0'.repeat(64), { sha256: sha, blake3: b3 }, ['sha256', 'blake3'])).toEqual({ kind: 'mismatch', candidates: ['sha256', 'blake3'] });
  });
  it('asks to compute the needed algorithm', () => {
    expect(compare('d41d8cd98f00b204e9800998ecf8427e', { sha256: sha }, ['sha256'])).toEqual({ kind: 'pending', algo: 'md5' });
    // 64 hex: sha256 computed and differs, blake3 not computed yet -> compute it before saying mismatch
    expect(compare('1'.repeat(64), { sha256: sha }, ['sha256'])).toEqual({ kind: 'pending', algo: 'blake3' });
  });
  it('rejects junk', () => {
    expect(compare('', {}, [])).toEqual({ kind: 'empty' });
    expect(compare('xyz', {}, [])).toEqual({ kind: 'invalid' });
    expect(compare('abc123', {}, [])).toEqual({ kind: 'invalid' });
  });
});
