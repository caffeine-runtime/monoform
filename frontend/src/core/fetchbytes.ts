// Fetch a whole file from the data channel in 4 MB Range pieces. Meant for
// workers: WebKitGTK does main-thread work proportional to response size, so
// big single responses (and any big fetch on the page thread) cause jank.
export const PIECE = 4 << 20;

export async function fetchBytes(url: string, onProgress?: (done: number, total: number) => void, piece = PIECE): Promise<Uint8Array> {
  const first = await fetch(url, { headers: { Range: `bytes=0-${piece - 1}` } });
  if (first.status === 206) {
    const total = Number(first.headers.get('Content-Range')?.split('/')[1] ?? NaN);
    const head = new Uint8Array(await first.arrayBuffer());
    if (!Number.isFinite(total) || total <= head.byteLength) return head;
    const out = new Uint8Array(total);
    out.set(head);
    onProgress?.(head.byteLength, total);
    for (let off = head.byteLength; off < total; ) {
      const end = Math.min(total, off + piece) - 1;
      const res = await fetch(url, { headers: { Range: `bytes=${off}-${end}` } });
      if (res.status !== 206) throw new Error(`range request failed (${res.status})`);
      const part = new Uint8Array(await res.arrayBuffer());
      if (!part.byteLength) throw new Error('short read');
      out.set(part, off);
      off += part.byteLength;
      onProgress?.(off, total);
    }
    return out;
  }
  if (!first.ok) {
    let msg = first.statusText || `HTTP ${first.status}`;
    try {
      msg = (await first.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return new Uint8Array(await first.arrayBuffer());
}
