import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_BYTES, uploadParts } from './upload';

const urlFor = (p: string, q: Record<string, string>) => `/__hia/${p}?${new URLSearchParams(q)}`;

afterEach(() => vi.unstubAllGlobals());

function mockFetch() {
  const calls: { url: string; size: number }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const b = init.body as Uint8Array | undefined;
    calls.push({ url, size: b?.byteLength ?? 0 });
    const body = url.includes('begin') ? { id: 'u1' } : { size: 1 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe('uploadParts', () => {
  it('sends small payloads in one request', async () => {
    const calls = mockFetch();
    await uploadParts(urlFor, '/x', [new Uint8Array(10), new Uint8Array(5)]);
    expect(calls).toEqual([{ url: '/__hia/save?path=%2Fx', size: 15 }]);
  });
  it('chunks large payloads and commits', async () => {
    const calls = mockFetch();
    const big = new Uint8Array(CHUNK_BYTES * 2 + 100);
    const progress: number[] = [];
    await uploadParts(urlFor, '/x', [big.subarray(0, 300), big.subarray(300)], (d) => progress.push(d));
    expect(calls.map((c) => c.url.split('?')[0])).toEqual(['/__hia/upload/begin', '/__hia/upload/chunk', '/__hia/upload/chunk', '/__hia/upload/chunk', '/__hia/upload/commit']);
    expect(calls.slice(1, 4).map((c) => c.size)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 100]);
    expect(progress[progress.length - 1]).toBe(big.byteLength);
  });
});
