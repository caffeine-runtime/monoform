// Reports whether the webview is cross-origin isolated (threads for WebAssembly).
import { log } from './harness';

export default async function coi() {
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const h = (await fetch("/")).headers;
  log(`coi headers: coop=${h.get("cross-origin-opener-policy")} coep=${h.get("cross-origin-embedder-policy")}`);
  log(`coi: href=${location.href} secure=${isSecureContext} isolated=${(globalThis as any).crossOriginIsolated} SAB=${typeof SharedArrayBuffer} simd=${simd} cores=${navigator.hardwareConcurrency}`);
}
