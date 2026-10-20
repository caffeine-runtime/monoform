// Log levels from a line of text: "level=warn" / "level":"error" (logfmt,
// JSON logs), [ERROR] / <WARN> brackets, upper-case words (ERROR, WARNING…),
// syslog-ish "E/" (Android) and Go/klog "E1020 …" prefixes. Lower-case
// words in a message ("no error") don't count. Pure; unit-tested.

export const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type Level = (typeof LEVELS)[number];
/** Index in LEVELS + 1 (0 = no level), for compact per-line arrays. */
export const levelCode = (l: Level | null) => (l ? LEVELS.indexOf(l) + 1 : 0);

const WORDS: Record<string, Level> = {
  FATAL: 'fatal',
  CRITICAL: 'fatal',
  CRIT: 'fatal',
  PANIC: 'fatal',
  EMERG: 'fatal',
  EMERGENCY: 'fatal',
  ALERT: 'fatal',
  ERROR: 'error',
  ERR: 'error',
  SEVERE: 'error',
  FAILURE: 'error',
  WARN: 'warn',
  WARNING: 'warn',
  INFO: 'info',
  INFORMATION: 'info',
  NOTICE: 'info',
  DEBUG: 'debug',
  DBG: 'debug',
  FINE: 'debug',
  TRACE: 'trace',
  VERBOSE: 'trace',
  FINER: 'trace',
  FINEST: 'trace',
};

const KV = /\b(?:level|lvl|severity|loglevel)["']?\s*[:=]\s*["']?([A-Za-z]+)/i;
const BRACKET = /[[<(|]\s*([A-Za-z]{3,11})\s*[\]>)|]/;
const UPPER = /\b(FATAL|CRITICAL|CRIT|PANIC|EMERG(?:ENCY)?|ALERT|ERROR|ERR|SEVERE|FAILURE|WARN(?:ING)?|INFO(?:RMATION)?|NOTICE|DEBUG|DBG|TRACE|VERBOSE|FINE(?:R|ST)?)\b/;
const ANDROID = /(?:^|\s)([VDIWEF])\/[\w.$-]+(?:\(\s*\d+\))?:/;
const KLOG = /^([IWEF])\d{4} \d{2}:\d{2}:\d{2}/;
const SHORT: Record<string, Level> = { V: 'trace', D: 'debug', I: 'info', W: 'warn', E: 'error', F: 'fatal' };

/** The level of a log line, or null. Only the first 300 characters are looked at. */
export function levelOf(line: string): Level | null {
  const s = line.length > 300 ? line.slice(0, 300) : line;
  let m = KV.exec(s);
  if (m) {
    const w = WORDS[m[1].toUpperCase()];
    if (w) return w;
  }
  m = BRACKET.exec(s);
  if (m) {
    const w = WORDS[m[1].toUpperCase()];
    if (w) return w;
  }
  m = UPPER.exec(s);
  if (m) return WORDS[m[1]];
  m = KLOG.exec(s) ?? ANDROID.exec(s);
  if (m) return SHORT[m[1]];
  return null;
}

/** Where the level token is in a line (for highlighting), or null. */
export function levelSpan(line: string): [number, number] | null {
  const s = line.length > 300 ? line.slice(0, 300) : line;
  for (const re of [KV, BRACKET]) {
    const m = re.exec(s);
    if (m && WORDS[m[1].toUpperCase()]) {
      const i = m.index + m[0].lastIndexOf(m[1]);
      return [i, i + m[1].length];
    }
  }
  const m = UPPER.exec(s);
  return m ? [m.index, m.index + m[1].length] : null;
}

/** A timestamp near the start of a line: ISO 8601, "Oct 20 12:00:01", or "12:00:01.123". */
export const TIMESTAMP = /^(?:\[)?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;
