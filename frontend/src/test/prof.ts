// Profiling helpers for large-file paths.
import { fileUrl, saveFile } from '../core/backend';
import { join } from '../core/paths';
import { log, measureJank } from './harness';

export default async function prof(dir: string) {
  const p = join(dir, 'big.log');
  let buf!: ArrayBuffer;
  let r = await measureJank(async () => {
    const t = performance.now();
    const res = await fetch(fileUrl(p));
    buf = await res.arrayBuffer();
    log(`fetch 55MB: ${Math.round(performance.now() - t)} ms`);
  });
  log(`fetch gap ${Math.round(r.maxGap)}`);
  r = await measureJank(async () => {
    const t = performance.now();
    const w = new Worker(URL.createObjectURL(new Blob([`onmessage = async (e) => { const r = await fetch(e.data); const b = await r.arrayBuffer(); postMessage(b.byteLength); }`], { type: 'text/javascript' })));
    await new Promise((res) => {
      w.onmessage = (e) => {
        log(`worker fetch: ${e.data} bytes in ${Math.round(performance.now() - t)} ms`);
        res(null);
      };
      w.onerror = (e) => {
        log(`worker fetch error ${e.message}`);
        res(null);
      };
      w.postMessage(location.origin + fileUrl(p));
    });
  });
  log(`worker fetch gap ${Math.round(r.maxGap)}`);
  r = await measureJank(async () => {
    const t = performance.now();
    const s = new TextDecoder().decode(buf.slice(0, 2 << 20));
    log(`decode 2MB ${Math.round(performance.now() - t)} ms len ${s.length}`);
  });
  for (const size of [4 << 20, 16 << 20]) {
    const part = new Uint8Array(buf, 0, size).slice();
    r = await measureJank(async () => {
      const t = performance.now();
      await saveFile(join(dir, 'prof-out.bin'), part);
      log(`POST ${size >> 20} MB: ${Math.round(performance.now() - t)} ms`);
    });
    log(`POST ${size >> 20} MB gap ${Math.round(r.maxGap)}`);
  }
}
