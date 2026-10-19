// Decodes and encodes text off the main thread so a 50 MB file never blocks
// the UI. Decoded text is streamed back in ~2 MB chunks that end at a line
// break, which the editor appends one per frame.
import { uploadParts } from '../../core/upload';
import { classifyEol, countEol, decode, detectEncoding, encode, hasUtf16Bom, UnencodableError, type Encoding } from './encoding';

const CHUNK = 2 << 20;

type In =
  | { type: 'decode'; id: number; url: string; encoding?: Encoding }
  | { type: 'encode-chunk'; id: number; text: string }
  | { type: 'encode-end'; id: number; encoding: Encoding; bom: boolean; path: string; token: string };

// Fetching in the worker matters: WebKitGTK assembles large responses on the
// main thread when the page itself calls fetch().arrayBuffer().
// Large files are fetched in Range pieces so each piece's main-thread cost
// stays small.
const PIECE = 4 << 20;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const first = await fetch(url, { headers: { Range: `bytes=0-${PIECE - 1}` } });
  if (first.status === 206) {
    const total = Number(first.headers.get('Content-Range')?.split('/')[1] ?? NaN);
    const head = new Uint8Array(await first.arrayBuffer());
    if (!Number.isFinite(total) || total <= head.byteLength) return head;
    const out = new Uint8Array(total);
    out.set(head);
    for (let off = head.byteLength; off < total; ) {
      const end = Math.min(total, off + PIECE) - 1;
      const res = await fetch(url, { headers: { Range: `bytes=${off}-${end}` } });
      if (res.status !== 206) throw new Error(`range request failed (${res.status})`);
      const part = new Uint8Array(await res.arrayBuffer());
      out.set(part, off);
      off += part.byteLength;
      if (!part.byteLength) throw new Error('short read');
    }
    return out;
  }
  // Server ignored Range (e.g. archive entries): use the whole response.
  return readWhole(first);
}

async function readWhole(res: Response): Promise<Uint8Array> {
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

const pending = new Map<number, string[]>();

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'decode') {
      const bytes = await fetchBytes(m.url);
      const encoding = m.encoding ?? detectEncoding(bytes);
      const text = decode(bytes, encoding);
      const eol = classifyEol(countEol(text));
      post({ type: 'meta', id: m.id, encoding, bom: hasUtf16Bom(bytes), eol, length: text.length, size: bytes.byteLength });
      for (let i = 0; i < text.length; ) {
        let end = Math.min(text.length, i + CHUNK);
        if (end < text.length) {
          const nl = text.indexOf('\n', end);
          end = nl < 0 ? text.length : nl + 1;
        }
        post({ type: 'chunk', id: m.id, text: text.slice(i, end) });
        i = end;
      }
      post({ type: 'done', id: m.id });
    } else if (m.type === 'encode-chunk') {
      let parts = pending.get(m.id);
      if (!parts) pending.set(m.id, (parts = []));
      parts.push(m.text);
    } else if (m.type === 'encode-end') {
      const parts = pending.get(m.id) ?? [];
      pending.delete(m.id);
      let offset = 0;
      const out: Uint8Array[] = [];
      parts.forEach((p, i) => {
        try {
          out.push(encode(p, m.encoding, i === 0 && m.bom));
        } catch (err) {
          if (err instanceof UnencodableError) err.index += offset;
          throw err;
        }
        offset += p.length;
      });
      const urlFor = (p: string, q: Record<string, string>) => `/__hia/${p}?${new URLSearchParams({ t: m.token, ...q })}`;
      const entry = await uploadParts(urlFor, m.path, out, (done, total) => post({ type: 'progress', id: m.id, done, total }));
      post({ type: 'saved', id: m.id, entry });
    }
  } catch (err) {
    if (m.type !== 'decode') pending.delete(m.id);
    const u = err instanceof UnencodableError ? { char: err.char, index: err.index } : undefined;
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err), unencodable: u });
  }
};

function post(msg: unknown) {
  (self as unknown as Worker).postMessage(msg);
}
