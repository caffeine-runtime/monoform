// Upload bytes to a file, atomically. Small payloads go in one request;
// larger ones in 4 MB chunks (WebKitGTK copies request bodies on its main
// thread, so one huge POST would freeze the UI). Works in workers too: it only
// needs fetch and a URL builder.

export const CHUNK_BYTES = 4 << 20;

export type UrlFor = (path: string, params: Record<string, string>) => string;

async function post(url: string, body?: ArrayBuffer | Uint8Array): Promise<any> {
  const empty = !body || body.byteLength === 0;
  const res = await fetch(url, { method: 'POST', body: empty ? undefined : (body as BodyInit), headers: empty ? { 'X-Empty-Body': '1' } : {} });
  let j: any = null;
  try {
    j = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
  return j;
}

/** Write parts (in order) to `path`; returns the backend's file entry. */
export async function uploadParts(
  urlFor: UrlFor,
  path: string,
  parts: (ArrayBuffer | Uint8Array)[],
  onProgress?: (done: number, total: number) => void,
  extra: Record<string, string> = {},
): Promise<any> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  if (total <= CHUNK_BYTES) {
    const one = parts.length === 1 ? parts[0] : concat(parts, total);
    return post(urlFor('save', { ...extra, path }), one);
  }
  const { id } = await post(urlFor('upload/begin', { ...extra, path }));
  let done = 0;
  try {
    for (const chunk of rechunk(parts)) {
      await post(urlFor('upload/chunk', { id }), chunk);
      done += chunk.byteLength;
      onProgress?.(done, total);
    }
    return await post(urlFor('upload/commit', { id }));
  } catch (e) {
    await post(urlFor('upload/abort', { id })).catch(() => {});
    throw e;
  }
}

function concat(parts: (ArrayBuffer | Uint8Array)[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    const u = p instanceof Uint8Array ? p : new Uint8Array(p);
    out.set(u, o);
    o += u.byteLength;
  }
  return out;
}

/** Re-slice arbitrary parts into CHUNK_BYTES pieces (views, no big copies). */
function* rechunk(parts: (ArrayBuffer | Uint8Array)[]): Generator<Uint8Array> {
  let pending: Uint8Array[] = [];
  let size = 0;
  for (const p of parts) {
    let u = p instanceof Uint8Array ? p : new Uint8Array(p);
    while (u.byteLength) {
      const take = Math.min(u.byteLength, CHUNK_BYTES - size);
      pending.push(u.subarray(0, take));
      size += take;
      u = u.subarray(take);
      if (size === CHUNK_BYTES) {
        yield pending.length === 1 ? pending[0] : concat(pending, size);
        pending = [];
        size = 0;
      }
    }
  }
  if (size) yield pending.length === 1 ? pending[0] : concat(pending, size);
}
