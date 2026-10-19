// Diagnostics for webview data-channel behaviour.
import { endpoint, saveFile, type Body } from '../core/backend';
import { join } from '../core/paths';
import { log } from './harness';

export default async function probe(dir: string) {
  const which = (await import('../core/backend')).api;
  void which;
  const kinds: [string, () => Body][] = [
    ['string', () => 'hello string'],
    ['uint8array', () => new Uint8Array([1, 2, 3, 4])],
    ['arraybuffer', () => new Uint8Array([5, 6, 7]).buffer],
    ['blob', () => new Blob(['blob body'])],
    ['empty-string', () => ''],
    ['empty-blob', () => new Blob([])],
  ];
  const only = new URLSearchParams(location.search).get('k');
  for (const [name, body] of kinds) {
    if (only && only !== name) continue;
    log(`probe ${name} ...`);
    try {
      const e = await saveFile(join(dir, `probe-${name}.bin`), body());
      log(`probe ${name} ok size=${e.size}`);
    } catch (err) {
      log(`probe ${name} error ${err}`);
    }
  }
  void endpoint;
}
