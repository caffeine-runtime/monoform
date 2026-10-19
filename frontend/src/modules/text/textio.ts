// Main-thread side of the text worker: streaming decode and chunked encode.
import type { Text } from '@codemirror/state';
import type { Encoding, Eol } from './encoding';
import TextWorker from './textWorker?worker';

let worker: Worker | null = null;
let seq = 0;
const handlers = new Map<number, (m: any) => void>();

function w(): Worker {
  if (!worker) {
    worker = new TextWorker();
    worker.onmessage = (e) => handlers.get(e.data.id)?.(e.data);
  }
  return worker;
}

export interface DecodeMeta {
  encoding: Encoding;
  bom: boolean;
  eol: Eol;
  length: number;
  size: number;
}

/** Fetch and decode in the worker; onChunk is called for each piece, in order. */
export function decodeStream(url: string, encoding: Encoding | undefined, onMeta: (m: DecodeMeta) => void, onChunk: (text: string) => Promise<void> | void): Promise<void> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    // Chunks are applied sequentially even if the worker is faster.
    let chain = Promise.resolve();
    handlers.set(id, (m) => {
      if (m.type === 'meta') onMeta(m);
      else if (m.type === 'chunk') chain = chain.then(() => onChunk(m.text));
      else if (m.type === 'done') {
        handlers.delete(id);
        chain.then(resolve, reject);
      } else if (m.type === 'error') {
        handlers.delete(id);
        reject(new Error(m.message));
      }
    });
    w().postMessage({ type: 'decode', id, url: new URL(url, location.href).href, encoding });
  });
}

export class EncodeError extends Error {
  constructor(
    message: string,
    public unencodable?: { char: string; index: number },
  ) {
    super(message);
  }
}

const yieldToMain = () => new Promise((r) => setTimeout(r, 0));

/**
 * Encode a CodeMirror document and save it to `path`. The text is sliced in
 * ~1 MB pieces (at line boundaries) with a yield between pieces; the worker
 * encodes and uploads, so even a huge document never blocks the main thread
 * for long. Resolves with the saved file's entry.
 */
export async function saveDoc(
  doc: Text,
  lineSep: string,
  encoding: Encoding,
  bom: boolean,
  path: string,
  token: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ size: number }> {
  const id = ++seq;
  const result = new Promise<{ size: number }>((resolve, reject) => {
    handlers.set(id, (m) => {
      if (m.type === 'progress') return onProgress?.(m.done, m.total);
      handlers.delete(id);
      if (m.type === 'saved') resolve(m.entry);
      else reject(new EncodeError(m.message, m.unencodable));
    });
  });
  const target = 1 << 20;
  let line = 1;
  let started = performance.now();
  while (line <= doc.lines) {
    const from = doc.line(line).from;
    let last = line;
    let to = doc.line(line).to;
    while (last < doc.lines && to - from < target) {
      last++;
      to = doc.line(last).to;
    }
    let text = doc.sliceString(from, to, lineSep);
    if (last < doc.lines) text += lineSep;
    w().postMessage({ type: 'encode-chunk', id, text });
    line = last + 1;
    if (performance.now() - started > 20) {
      await yieldToMain();
      started = performance.now();
    }
  }
  w().postMessage({ type: 'encode-end', id, encoding, bom, path, token });
  return result;
}
