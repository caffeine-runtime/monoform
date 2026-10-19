// Fuzzy matching for the command palette: the query must appear as a
// subsequence of the candidate. Matches at word starts, consecutive runs and
// early positions score higher.

export interface FuzzyMatch {
  score: number;
  /** Indices into the candidate string of matched characters. */
  positions: number[];
}

const WORD_SEP = /[\s\-_./\\:()[\]]/;

function isWordStart(s: string, i: number): boolean {
  if (i === 0) return true;
  const prev = s[i - 1];
  const cur = s[i];
  if (WORD_SEP.test(prev)) return true;
  // camelCase boundary
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

/**
 * Score `candidate` against `query`. Returns null when the query is not a
 * subsequence. Spaces in the query are ignored (they only help the user).
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return { score: 0, positions: [] };
  const c = candidate.toLowerCase();
  if (q.length > c.length) return null;

  // Quick reject: every query char must exist in order.
  let probe = 0;
  for (let i = 0; i < c.length && probe < q.length; i++) if (c[i] === q[probe]) probe++;
  if (probe < q.length) return null;

  // Dynamic programming over (query index, candidate index) choosing the best
  // alignment. Sizes are tiny (palette entries), so O(n*m) is fine.
  const n = q.length;
  const m = c.length;
  const NEG = -1e9;
  // best[i][j]: best score matching q[0..i] with q[i] at c[j]
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    best.push(new Float64Array(m).fill(NEG));
    from.push(new Int32Array(m).fill(-1));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (c[j] !== q[i]) continue;
      let charScore = 1;
      const ws = isWordStart(candidate, j);
      if (ws) charScore += 8;
      if (j === 0) charScore += 4;
      if (candidate[j] === query.replace(/\s+/g, '')[i]) charScore += 0.5; // exact case
      if (i === 0) {
        best[i][j] = charScore - Math.min(j, 20) * 0.3;
        continue;
      }
      let bestPrev = NEG;
      let bestK = -1;
      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === NEG) continue;
        let s = best[i - 1][k];
        if (k === j - 1) s += 10; // consecutive
        else s -= Math.min(j - k - 1, 10) * 0.6; // gap penalty
        if (s > bestPrev) {
          bestPrev = s;
          bestK = k;
        }
      }
      if (bestK >= 0) {
        best[i][j] = bestPrev + charScore;
        from[i][j] = bestK;
      }
    }
  }
  let endJ = -1;
  let top = NEG;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] > top) {
      top = best[n - 1][j];
      endJ = j;
    }
  }
  if (endJ < 0) return null;
  const positions: number[] = new Array(n);
  for (let i = n - 1, j = endJ; i >= 0; i--) {
    positions[i] = j;
    j = from[i][j];
  }
  // Prefer shorter candidates slightly.
  const score = top - m * 0.02;
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  match: FuzzyMatch;
}

/** Filter and sort items by fuzzy score; stable for equal scores. */
export function fuzzyFilter<T>(query: string, items: T[], text: (t: T) => string, limit = 200): Ranked<T>[] {
  const out: (Ranked<T> & { idx: number })[] = [];
  items.forEach((item, idx) => {
    const match = fuzzyMatch(query, text(item));
    if (match) out.push({ item, match, idx });
  });
  if (query.trim()) out.sort((a, b) => b.match.score - a.match.score || a.idx - b.idx);
  return out.slice(0, limit);
}

/** Split text into highlighted / plain segments for rendering. */
export function highlightSegments(text: string, positions: number[]): { text: string; hit: boolean }[] {
  const set = new Set(positions);
  const segs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = segs[segs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else segs.push({ text: text[i], hit });
  }
  return segs;
}
