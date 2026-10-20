// Display helpers for file history (kept versions of saved files).

export interface Version {
  t: number; // unix ms
  h: string; // content hash
  s: number; // size in bytes
  k: string; // original | outside | saved | restored
  n?: string; // for restores: the time (RFC 3339) of the version put back
}

const DAY = 86_400_000;

/** What a version is, in words. */
export function kindLabel(v: Version): string {
  switch (v.k) {
    case 'original':
      return 'Before the first save';
    case 'outside':
      return 'Changed by another program';
    case 'restored': {
      const t = v.n ? Date.parse(v.n) : NaN;
      return Number.isFinite(t) ? `Restored the version of ${formatWhen(t)}` : 'Restored';
    }
    default:
      return 'Saved';
  }
}

/** "14:03:21", or with the date when it isn't today. */
export function formatWhen(t: number, now = Date.now()): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return sameDay(t, now) ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Versions (newest first) grouped under "Today", "Yesterday" or a date. */
export function byDay(vs: Version[], now = Date.now()): { day: string; versions: Version[] }[] {
  const out: { day: string; versions: Version[] }[] = [];
  for (const v of vs) {
    const day = sameDay(v.t, now)
      ? 'Today'
      : sameDay(v.t, now - DAY)
        ? 'Yesterday'
        : new Date(v.t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const last = out[out.length - 1];
    if (last?.day === day) last.versions.push(v);
    else out.push({ day, versions: [v] });
  }
  return out;
}

/** Size change from the version before it ("+1.2 KB", "−300 B", ""). */
export function sizeDelta(vs: Version[], i: number, fmt: (n: number) => string): string {
  const older = vs[i + 1];
  if (!older) return '';
  const d = vs[i].s - older.s;
  if (d === 0) return 'same size';
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
}
