// Shared onnxruntime-web setup for workers: single-threaded WASM (the
// webview isn't cross-origin isolated) with the runtime binary fetched in
// ranged pieces — one big response costs WebKitGTK main-thread time even
// when a worker makes the request.
import type * as Ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { fetchBytes } from './fetchbytes';

let ready: Promise<void> | null = null;

export function initOrtWasm(ort: typeof Ort): Promise<void> {
  if (!ready) {
    ready = (async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = await fetchBytes(new URL(wasmUrl, location.href).href);
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}
