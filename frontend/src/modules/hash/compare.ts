// Expected-hash comparison (unit-tested).

export const ALGOS = [
  { id: 'md5', label: 'MD5', hex: 32 },
  { id: 'sha1', label: 'SHA-1', hex: 40 },
  { id: 'sha256', label: 'SHA-256', hex: 64 },
  { id: 'sha512', label: 'SHA-512', hex: 128 },
  { id: 'blake3', label: 'BLAKE3', hex: 64 },
] as const;

/** Normalize pasted text: drop whitespace, "sha256:" prefixes and a trailing file name. */
export function normalizeExpected(s: string): string {
  let t = s.trim();
  const m = /^([0-9a-fA-F]{32,128})\b/.exec(t) ?? /([0-9a-fA-F]{32,128})\s*$/.exec(t);
  if (m) t = m[1];
  t = t.replace(/^(md5|sha1|sha-1|sha256|sha-256|sha512|sha-512|blake3)[:=]\s*/i, '');
  return t.replace(/\s+/g, '').toLowerCase();
}

export type Verdict = { kind: 'empty' } | { kind: 'match'; algo: string } | { kind: 'mismatch'; candidates: string[] } | { kind: 'invalid' } | { kind: 'pending'; algo: string };

/**
 * Compare an expected digest with computed results. `selected` are the algos
 * being computed; if the expected digest's length implies an algorithm that
 * isn't selected, the verdict is "pending" with that algorithm so the UI can
 * compute it.
 */
export function compare(expectedRaw: string, results: Record<string, string>, selected: string[]): Verdict {
  const e = normalizeExpected(expectedRaw);
  if (!e) return { kind: 'empty' };
  if (!/^[0-9a-f]+$/.test(e)) return { kind: 'invalid' };
  const candidates = ALGOS.filter((a) => a.hex === e.length).map((a) => a.id as string);
  if (!candidates.length) return { kind: 'invalid' };
  for (const c of candidates) if (results[c] === e) return { kind: 'match', algo: c };
  const computed = candidates.filter((c) => results[c]);
  const missing = candidates.find((c) => !results[c] && !selected.includes(c));
  if (!computed.length && missing) return { kind: 'pending', algo: missing };
  if (computed.length < candidates.length && missing) return { kind: 'pending', algo: missing };
  if (!computed.length) return { kind: 'pending', algo: candidates[0] };
  return { kind: 'mismatch', candidates: computed };
}
