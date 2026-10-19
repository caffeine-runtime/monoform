// Parses 3D files off the main thread and hands back a transferable scene.
import { fetchBytes } from '../../core/fetchbytes';
import { loadModel } from './load';
import { pack, type Packed } from './transfer';

export type LoadIn = { url: string; ext: string; base: string; name: string };
export type LoadOut = { ok: true; packed: Packed; millis: number; bytes: number } | { ok: false; error: string } | { progress: number };

self.onmessage = async (e: MessageEvent<LoadIn>) => {
  const { url, ext, base, name } = e.data;
  const t0 = performance.now();
  try {
    const bytes = await fetchBytes(url, (done, total) => (self as unknown as Worker).postMessage({ progress: done / total } satisfies LoadOut));
    const { scene, animations } = await loadModel(ext, bytes.buffer as ArrayBuffer, base, name);
    const { packed, transfer } = pack(scene, animations);
    (self as unknown as Worker).postMessage({ ok: true, packed, millis: Math.round(performance.now() - t0), bytes: bytes.byteLength } satisfies LoadOut, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies LoadOut);
  }
};
